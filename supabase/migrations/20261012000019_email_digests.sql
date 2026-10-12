-- Leave Desk: fewer emails — one daily summary per person, instant only when it matters,
-- and every instant email about a request in one conversation per person.
--
-- queue_email() now decides, for each email, whether to
--   * send it now (student outcomes and certificate steps, faculty concerns, anything about
--     a class in the next 24 hours, leave starting today or tomorrow),
--   * hold it for the person's morning summary (most notices to faculty, the Dean and the office), or
--   * skip it (the student's own receipt — they see it on screen; delegation copies).
-- compose_digests() runs each morning and turns held items into one email per person, leaving out
-- anything that no longer needs attention (a request already decided, withdrawn before the person
-- heard of it, a notice already answered). A faculty member's response window starts when the
-- summary reaches them, not when the request was made.

-- ---------------------------------------------------------------------------
-- Held items and email columns
-- ---------------------------------------------------------------------------
create table public.email_digest_items (
  id          bigint generated always as identity primary key,
  to_email    text not null,
  to_name     text,
  kind        text not null,
  leave_id    uuid references public.leave_requests (id) on delete cascade,
  subject     text not null,
  body        text not null,
  link        text,
  link_label  text,
  created_at  timestamptz not null default now(),
  digested_at timestamptz,
  outbox_id   bigint
);
create index email_digest_items_open_idx on public.email_digest_items (to_email, id) where digested_at is null;
create index email_digest_items_leave_idx on public.email_digest_items (leave_id);
alter table public.email_digest_items enable row level security;
revoke all on public.email_digest_items from anon, authenticated;

-- links: one-time links for a summary email (never readable by clients, cleared once sent).
-- thread_key / thread_subject: keep every email about one request in one conversation per person.
alter table public.email_outbox
  add column links          jsonb,
  add column thread_key     text,
  add column thread_subject text;

-- ---------------------------------------------------------------------------
-- Routing
-- ---------------------------------------------------------------------------
create or replace function public.queue_email(
  p_to text, p_name text, p_subject text, p_body text, p_leave uuid, p_kind text,
  p_link text default null, p_link_label text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_mode text;
begin
  if p_leave is not null then
    select lr.ref, lr.from_date, lr.filed_by, st.full_name, st.student_no, st.email as student_email
      into r
      from public.leave_requests lr join public.people st on st.id = lr.student_id
     where lr.id = p_leave;
  end if;

  v_mode := case
    -- The student sees the confirmation on screen; only an office-filed request needs telling.
    when p_kind = 'student_receipt' then case when r.filed_by is not null then 'instant' else 'skip' end
    -- A class in the next 24 hours cannot wait for tomorrow's summary.
    when p_kind = 'faculty_notice' then
      case when exists (
        select 1 from public.leave_sessions ls
          join public.class_sessions cs on cs.id = ls.session_id
          join public.people f on f.id = cs.faculty_id
         where ls.leave_id = p_leave and lower(f.email) = lower(p_to) and not cs.cancelled
           and cs.starts_at between now() and now() + interval '24 hours')
      then 'instant' else 'digest' end
    when p_kind = 'approver_new' then
      case when r.from_date <= public.local_date(now()) + 1 then 'instant' else 'digest' end
    when p_kind in ('approver_changed', 'escalation', 'withdrawn', 'cancelled_notice', 'faculty_released',
                    'faculty_timetable_change', 'office_certificate', 'office_cancelled') then 'digest'
    -- Only the person named gets the delegation email; the Dean and office copies are dropped.
    when p_kind = 'delegation_set' and p_link is null then 'skip'
    else 'instant'
  end;

  if v_mode = 'skip' then
    return;
  elsif v_mode = 'digest' then
    insert into public.email_digest_items (to_email, to_name, kind, leave_id, subject, body, link, link_label)
    values (p_to, p_name, p_kind, p_leave, p_subject, p_body, p_link, p_link_label);
    return;
  end if;

  insert into public.email_outbox (to_email, to_name, subject, body, leave_id, kind, link, link_label, thread_key, thread_subject)
  values (p_to, p_name, p_subject, p_body, p_leave, p_kind, p_link, p_link_label,
          case when p_leave is not null then 'lv-' || p_leave::text || '-' || left(md5(lower(p_to)), 12) end,
          case when p_leave is null then null
               when lower(p_to) = lower(r.student_email) then format('Your leave request %s', r.ref)
               else format('Leave %s · %s (%s)', r.ref, r.full_name, r.student_no) end);
end $$;

-- Sent emails lose their one-time links.
create or replace function public.mark_email(p_id bigint, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.email_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         link = case when p_ok then null else link end,
         links = case when p_ok then null else links end,
         last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- The morning summary
-- ---------------------------------------------------------------------------
create or replace function public.compose_digests() returns int
language plpgsql security definer set search_path = public as $$
declare
  s        public.settings%rowtype;
  rcpt     record;
  it       record;
  lv       record;
  v_max    bigint;
  v_act    text[];
  v_fyi    text[];
  v_links  jsonb;
  v_faculty_items int;
  v_decider boolean;
  v_others int;
  v_oldest timestamptz;
  v_body   text;
  v_id     bigint;
  v_sent   int := 0;
  v_seen   uuid[];
begin
  if not (public.is_sync_service() or public.has_role('office')) then
    raise exception 'Only the Dean HRM Office can send the summaries.' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;
  select coalesce(max(id), 0) into v_max from public.email_digest_items;

  for rcpt in
    select lower(to_email) as email, max(to_name) as name
      from public.email_digest_items
     where digested_at is null and id <= v_max
     group by lower(to_email)
  loop
    v_act := '{}'; v_fyi := '{}'; v_links := '[]'::jsonb; v_faculty_items := 0; v_seen := '{}';
    v_decider := exists (select 1 from public.decider_recipients() d where lower(d.email) = rcpt.email);

    -- Faculty notices still waiting for this person's answer (latest notice per request only:
    -- a changed request replaced the earlier link).
    for it in
      select distinct on (i.leave_id) i.*, lr.ref, lr.type, lr.reason, lr.from_date, lr.to_date,
             st.full_name as student_name, st.student_no, f.id as faculty_id
        from public.email_digest_items i
        join public.leave_requests lr on lr.id = i.leave_id
        join public.people st on st.id = lr.student_id
        join public.people f on lower(f.email) = rcpt.email
        join public.faculty_acks a on a.leave_id = lr.id and a.faculty_id = f.id and a.status = 'pending'
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind = 'faculty_notice' and lr.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
       order by i.leave_id, i.id desc
    loop
      v_links := v_links || jsonb_build_array(jsonb_build_object('path', it.link, 'label', 'Acknowledge, add a note or raise a concern'));
      v_act := v_act || (
        format('%s (%s) · %s leave · %s', it.student_name, it.student_no, public.type_label(it.type), public.fmt_range(it.from_date, it.to_date))
        || coalesce(E'\n' || (
             select string_agg('   ' || cs.course_code || ' · ' || public.fmt_time(cs.starts_at), E'\n' order by cs.starts_at)
               from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
              where ls.leave_id = it.leave_id and cs.faculty_id = it.faculty_id and not cs.cancelled), '')
        || case when it.type = 'medical' then E'\n   Medical leave, for information.' else E'\n   Reason: ' || it.reason end
        || format(E'\n[[%s]]', jsonb_array_length(v_links)));
      -- The response window starts now that the notice actually reaches them.
      update public.faculty_acks set notified_at = now()
       where leave_id = it.leave_id and faculty_id = it.faculty_id and status = 'pending';
      v_faculty_items := v_faculty_items + 1;
    end loop;

    -- Requests waiting for the Dean (new, changed or overdue), once each.
    for lv in
      select lr.id, lr.ref, lr.type, lr.from_date, lr.to_date, lr.submitted_at, st.full_name, st.student_no,
             bool_or(i.kind = 'approver_changed') as changed, bool_or(i.kind = 'escalation') as overdue,
             exists (select 1 from public.ack_concerns c where c.leave_id = lr.id) as concern
        from public.email_digest_items i
        join public.leave_requests lr on lr.id = i.leave_id
        join public.people st on st.id = lr.student_id
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind in ('approver_new', 'approver_changed', 'escalation') and lr.status = 'submitted'
       group by lr.id, lr.ref, lr.type, lr.from_date, lr.to_date, lr.submitted_at, st.full_name, st.student_no
       order by lr.submitted_at
    loop
      v_seen := v_seen || lv.id;
      v_links := v_links || jsonb_build_array(jsonb_build_object(
        'path', case when v_decider then '/approve/' else '/office/leave/' end || lv.ref, 'label', 'Open ' || lv.ref));
      v_act := v_act || (
        format('%s · %s (%s) · %s leave · %s', lv.ref, lv.full_name, lv.student_no, public.type_label(lv.type), public.fmt_range(lv.from_date, lv.to_date))
        || format(E'\n   %s%s%s%s',
                  case when now() - lv.submitted_at < interval '1 hour' then 'Just submitted'
                       else 'Waiting ' || floor(extract(epoch from now() - lv.submitted_at) / 3600)::int || ' h' end,
                  case when lv.overdue then ' · overdue' else '' end,
                  case when lv.changed then ' · changed by the student' else '' end,
                  case when lv.concern then ' · a faculty member raised a concern' else '' end)
        || format(E'\n[[%s]]', jsonb_array_length(v_links)));
    end loop;

    -- Certificates waiting to be checked.
    for lv in
      select distinct lr.id, lr.ref, lr.from_date, lr.to_date, st.full_name, st.student_no
        from public.email_digest_items i
        join public.leave_requests lr on lr.id = i.leave_id
        join public.people st on st.id = lr.student_id
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind = 'office_certificate' and lr.status = 'documents_in'
    loop
      v_links := v_links || jsonb_build_array(jsonb_build_object('path', '/office/leave/' || lv.ref, 'label', 'Check the certificate'));
      v_act := v_act || (format('Certificate to check: %s · %s (%s) · %s', lv.ref, lv.full_name, lv.student_no, public.fmt_range(lv.from_date, lv.to_date))
                         || format(E'\n[[%s]]', jsonb_array_length(v_links)));
    end loop;

    -- For information: only about requests this person had already heard of
    -- (an automatic cancellation is always worth telling the office).
    for it in
      select distinct on (i.leave_id, i.kind) i.*
        from public.email_digest_items i
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind in ('withdrawn', 'cancelled_notice', 'faculty_released', 'faculty_timetable_change', 'office_cancelled')
         and (i.kind = 'office_cancelled'
              or exists (select 1 from public.email_outbox o where o.leave_id = i.leave_id and lower(o.to_email) = rcpt.email)
              or exists (select 1 from public.email_digest_items p where p.leave_id = i.leave_id and lower(p.to_email) = rcpt.email
                           and p.digested_at is not null and p.kind in ('faculty_notice', 'approver_new', 'approver_changed', 'escalation')))
       order by i.leave_id, i.kind, i.id desc
    loop
      v_fyi := v_fyi || it.subject;
    end loop;

    -- For the Dean (and a delegate): anything else still waiting from earlier days.
    if v_decider then
      select count(*), min(submitted_at) into v_others, v_oldest
        from public.leave_requests where status = 'submitted' and not (id = any (v_seen));
    else
      v_others := 0;
    end if;

    if cardinality(v_act) > 0 or cardinality(v_fyi) > 0 or v_others > 0 then
      v_body := 'Here is your Leave Desk summary for today.';
      if cardinality(v_act) > 0 then
        v_body := v_body || E'\n\nTO ACT ON\n\n' || array_to_string(v_act, E'\n\n');
      end if;
      if v_faculty_items > 0 then
        v_body := v_body || format(E'\n\nNo reply by %s is recorded as acknowledged. Make-up of any evaluation stays at your discretion.',
                                   public.fmt_time(now() + make_interval(hours => s.ack_hours)));
      end if;
      if v_others > 0 then
        v_links := v_links || jsonb_build_array(jsonb_build_object('path', '/approve', 'label', 'Open the approval queue'));
        v_body := v_body || format(E'\n\nALSO WAITING FROM EARLIER\n\n%s request%s still waiting for a decision; the oldest for %s h.\n[[%s]]',
                                   v_others, case when v_others = 1 then ' is' else 's are' end,
                                   floor(extract(epoch from now() - v_oldest) / 3600)::int, jsonb_array_length(v_links));
      end if;
      if cardinality(v_fyi) > 0 then
        v_body := v_body || E'\n\nFOR YOUR INFORMATION\n\n' || array_to_string(array(select '• ' || x from unnest(v_fyi) x), E'\n');
      end if;
      v_body := v_body || E'\n\nYou get one summary a day. Anything about a class in the next 24 hours, or leave starting today or tomorrow, is sent straight away.';

      insert into public.email_outbox (to_email, to_name, subject, body, kind, links)
      values (rcpt.email, rcpt.name,
              format('Leave Desk · %s · %s', public.fmt_day(public.local_date(now())),
                     case when cardinality(v_act) + least(v_others, 1) > 0
                          then (cardinality(v_act) + v_others) || ' to act on'
                          else 'for your information' end),
              v_body, 'digest', v_links)
      returning id into v_id;
      v_sent := v_sent + 1;
    else
      v_id := null;
    end if;

    update public.email_digest_items set digested_at = now(), outbox_id = v_id
     where digested_at is null and id <= v_max and lower(to_email) = rcpt.email;
  end loop;
  return v_sent;
end $$;

-- How many held items are waiting for the next summary (for the Emails sent page).
create or replace function public.digest_pending() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_role('office') then
    jsonb_build_object('items', count(*), 'people', count(distinct lower(to_email)))
  end
    from public.email_digest_items where digested_at is null
$$;

revoke execute on function public.compose_digests(), public.digest_pending() from public, anon;
revoke execute on function public.queue_email(text, text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.compose_digests(), public.digest_pending() to authenticated, service_role;
