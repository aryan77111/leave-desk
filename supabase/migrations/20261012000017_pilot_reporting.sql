-- Leave Desk: pilot features, part 4 of 4 — delegation, feedback, survey, monitoring, metrics, help.

-- ---------------------------------------------------------------------------
-- Dean delegation
-- ---------------------------------------------------------------------------
create or replace function public.set_delegation(p_delegate uuid, p_from date, p_to date, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d      public.people%rowtype;
  v_me   uuid := public.me();
  v_name text;
  v_id   uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  x      record;
begin
  if not (public.has_role('approver') or public.has_role('office')) then
    raise exception 'Only the Dean or the Dean HRM Office can name someone to decide while the Dean is away.' using errcode = '42501';
  end if;
  select * into d from public.people where id = p_delegate and active;
  if not found or not (d.roles && array['faculty', 'office']::public.user_role[]) then
    raise exception 'Choose an active faculty member or Dean HRM Office colleague.' using errcode = '22023';
  end if;
  if 'approver' = any (d.roles) then
    raise exception '% already has Dean access.', d.full_name using errcode = '22023';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day.' using errcode = '22023';
  end if;
  if p_from < public.local_date(now()) then
    raise exception 'The first day cannot be in the past.' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The last day is before the first day.' using errcode = '22023';
  end if;
  if p_to - p_from > 90 then
    raise exception 'A delegation can last at most 90 days.' using errcode = '22023';
  end if;
  if length(coalesce(v_reason, '')) > 300 then
    raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.approval_delegations
              where delegate_id = p_delegate and ended_at is null
                and daterange(starts_on, ends_on, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception '% is already named for some of these dates.', d.full_name using errcode = '22023';
  end if;

  insert into public.approval_delegations (delegate_id, starts_on, ends_on, reason, created_by)
  values (p_delegate, p_from, p_to, v_reason, v_me)
  returning id into v_id;

  select full_name into v_name from public.people where id = v_me;
  perform public.queue_email(d.email, d.full_name,
    format('You will decide leave requests for the Dean, %s', public.fmt_range(p_from, p_to)),
    format(E'%s has named you to decide student leave requests on behalf of the Dean from %s to %s.%s\n\nDuring those days, requests appear in your approval queue in Leave Desk and you get the Dean''s emails. You will see what the Dean sees, including medical reasons, so please keep it confidential. Your decisions are recorded as made on behalf of the Dean.',
           v_name, public.fmt_day(p_from), public.fmt_day(p_to), coalesce(E'\nReason: ' || v_reason, '')),
    null, 'delegation_set', '/approve', 'Open the approval queue');
  for x in
    select email, full_name from public.people
     where active and id <> v_me and ('approver' = any (roles) or 'office' = any (roles))
  loop
    perform public.queue_email(x.email, x.full_name,
      format('%s will decide leave for the Dean, %s', d.full_name, public.fmt_range(p_from, p_to)),
      format('%s named %s to decide leave requests on behalf of the Dean from %s to %s.', v_name, d.full_name, public.fmt_day(p_from), public.fmt_day(p_to)),
      null, 'delegation_set');
  end loop;
  return v_id;
end $$;

create or replace function public.end_delegation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.approval_delegations%rowtype;
  d public.people%rowtype;
begin
  if not (public.has_role('approver') or public.has_role('office')) then
    raise exception 'Only the Dean or the Dean HRM Office can end a delegation.' using errcode = '42501';
  end if;
  select * into g from public.approval_delegations where id = p_id for update;
  if not found then raise exception 'Delegation not found.' using errcode = 'P0002'; end if;
  if g.ended_at is not null or g.ends_on < public.local_date(now()) then
    raise exception 'This delegation has already ended.' using errcode = '22023';
  end if;
  update public.approval_delegations set ended_at = now(), ended_by = public.me() where id = p_id;
  select * into d from public.people where id = g.delegate_id;
  perform public.queue_email(d.email, d.full_name, 'You no longer decide leave for the Dean',
    format('The delegation for %s has ended early. Leave requests go back to the Dean. Thank you.', public.fmt_range(g.starts_on, g.ends_on)),
    null, 'delegation_ended');
end $$;

-- ---------------------------------------------------------------------------
-- Feedback and the end-of-pilot survey
-- ---------------------------------------------------------------------------
create or replace function public.submit_feedback(p_kind text, p_message text, p_page text default null, p_agent text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := public.me();
  v_name text;
  v_msg  text := btrim(coalesce(p_message, ''));
  x      record;
begin
  if v_me is null then
    raise exception 'Sign in to send feedback.' using errcode = '42501';
  end if;
  if p_kind not in ('problem', 'suggestion') then
    raise exception 'Choose a problem or a suggestion.' using errcode = '22023';
  end if;
  if length(v_msg) < 3 then
    raise exception 'Write a few words first.' using errcode = '22023';
  end if;
  if length(v_msg) > 2000 then
    raise exception 'Keep it under 2000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.feedback where person_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of feedback today. Email the Dean HRM Office instead.' using errcode = '22023';
  end if;

  insert into public.feedback (person_id, kind, message, page, user_agent)
  values (v_me, p_kind, v_msg, left(nullif(btrim(coalesce(p_page, '')), ''), 300), left(nullif(btrim(coalesce(p_agent, '')), ''), 300));

  if p_kind = 'problem' then
    select full_name into v_name from public.people where id = v_me;
    for x in select email, full_name from public.people where active and 'office' = any (roles) and id <> v_me loop
      perform public.queue_email(x.email, x.full_name, format('Problem reported by %s', v_name),
        format(E'%s reported a problem%s:\n\n%s', v_name, coalesce(' on ' || nullif(btrim(coalesce(p_page, '')), ''), ''), v_msg),
        null, 'office_feedback', '/office/feedback', 'Open feedback');
    end loop;
  end if;
end $$;

create or replace function public.set_feedback_status(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can update feedback.' using errcode = '42501';
  end if;
  if p_status not in ('new', 'seen', 'done') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.feedback
     set status = p_status, office_note = coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 1000), office_note), updated_at = now()
   where id = p_id;
  if not found then raise exception 'Feedback not found.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.submit_survey(p_satisfaction int, p_ease int, p_faster boolean default null, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.people%rowtype;
begin
  select * into p from public.people where user_id = auth.uid() and active;
  if not found then
    raise exception 'Sign in to answer the survey.' using errcode = '42501';
  end if;
  if not (select survey_open from public.settings where id = 1) then
    raise exception 'The survey is not open.' using errcode = '22023';
  end if;
  if p_satisfaction is null or p_satisfaction not between 1 and 5 or p_ease is null or p_ease not between 1 and 5 then
    raise exception 'Choose a rating from 1 to 5 for both questions.' using errcode = '22023';
  end if;
  if length(coalesce(p_comment, '')) > 2000 then
    raise exception 'Keep the comment under 2000 characters.' using errcode = '22023';
  end if;
  insert into public.survey_responses (person_id, role, satisfaction, ease, faster, comment)
  values (p.id,
          case when 'approver' = any (p.roles) then 'approver' when 'faculty' = any (p.roles) then 'faculty'
               when 'office' = any (p.roles) then 'office' else 'student' end,
          p_satisfaction, p_ease, p_faster, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (person_id) do update
    set satisfaction = excluded.satisfaction, ease = excluded.ease, faster = excluded.faster,
        comment = excluded.comment, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Monitoring: the app records unexpected errors here (rate-limited).
-- ---------------------------------------------------------------------------
create or replace function public.log_app_error(p_source text, p_message text, p_path text default null, p_digest text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.app_errors where created_at > now() - interval '1 hour') >= 200 then
    return;
  end if;
  insert into public.app_errors (source, message, path, digest, user_id)
  values (case when p_source = 'server' then 'server' else 'client' end,
          left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 2000),
          left(p_path, 500), left(p_digest, 100), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Rules and contact for the public help page
-- ---------------------------------------------------------------------------
create or replace function public.public_help() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'programme_name', programme_name, 'notice_hours', notice_hours, 'medical_late_hours', medical_late_hours,
    'medical_ahead_days', medical_ahead_days, 'ack_hours', ack_hours, 'escalate_hours', escalate_hours,
    'doc_days', doc_days, 'max_leave_days', max_leave_days, 'link_days', link_days,
    'contact_name', help_contact_name, 'contact_email', help_contact_email, 'contact_phone', help_contact_phone)
  from public.settings where id = 1
$$;

-- ---------------------------------------------------------------------------
-- Pilot metrics. Requests are counted by the day they were submitted (college time).
-- ---------------------------------------------------------------------------
create or replace function public._pilot_requests(p_from date, p_to date, p_batch text) returns setof public.leave_requests
language sql stable security definer set search_path = public as $$
  select r.* from public.leave_requests r join public.people st on st.id = r.student_id
   where public.local_date(r.submitted_at) between p_from and p_to
     and (p_batch is null or st.batch = p_batch)
$$;

create or replace function public.pilot_metrics(p_from date, p_to date, p_batch text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s   public.settings%rowtype;
  v   jsonb;
  dec record;
  ack record;
  doc record;
  srv record;
  req record;
  pct_dec numeric;
  pct_ack numeric;
  pct_doc numeric;
  pct_online numeric;
begin
  if not (public.has_role('office') or public.has_role('approver')) then
    raise exception 'Only the Dean and the Dean HRM Office can see pilot results.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  select * into s from public.settings where id = 1;

  select count(*) as total,
         count(*) filter (where filed_by is not null) as by_office,
         count(*) filter (where edited_at is not null) as edited,
         count(*) filter (where status = 'withdrawn') as withdrawn,
         count(*) filter (where status = 'approved') as approved,
         count(*) filter (where status = 'rejected') as rejected,
         count(*) filter (where status = 'cancelled') as cancelled,
         count(*) filter (where status in ('submitted', 'sanctioned', 'documents_in')) as open,
         count(*) filter (where type = 'medical') as medical,
         count(*) filter (where type = 'family') as family,
         count(*) filter (where type = 'official') as official
    into req from public._pilot_requests(p_from, p_to, p_batch);

  select count(*) filter (where decided_at is not null) as decided,
         count(*) filter (where decided_at is not null and decided_at - submitted_at <= make_interval(hours => s.escalate_hours)) as in_time,
         count(*) filter (where decided_at is null and status = 'submitted' and now() - submitted_at > make_interval(hours => s.escalate_hours)) as open_late,
         count(*) filter (where decided_at is null and status = 'submitted' and now() - submitted_at <= make_interval(hours => s.escalate_hours)) as open_in_window,
         count(*) filter (where decided_by_delegate) as by_delegate,
         percentile_cont(0.5) within group (order by extract(epoch from decided_at - submitted_at) / 3600.0) as median_hours
    into dec from public._pilot_requests(p_from, p_to, p_batch);

  select count(*) as total,
         count(*) filter (where a.status in ('acknowledged', 'noted', 'flagged') and a.responded_at <= a.notified_at + make_interval(hours => s.ack_hours)) as in_time,
         count(*) filter (where a.status in ('acknowledged', 'noted', 'flagged') and a.responded_at > a.notified_at + make_interval(hours => s.ack_hours)) as late,
         count(*) filter (where a.status = 'deemed') as deemed,
         count(*) filter (where a.status = 'pending') as pending,
         count(*) filter (where a.status = 'flagged') as flagged
    into ack
    from public.faculty_acks a join public._pilot_requests(p_from, p_to, p_batch) r on r.id = a.leave_id;

  select count(*) filter (where doc_first_on_time is true) as on_time,
         count(*) filter (where doc_first_on_time is false) as late,
         count(*) filter (where doc_first_uploaded_at is null and doc_deadline < now()) as missed,
         count(*) filter (where doc_first_uploaded_at is null and doc_deadline >= now()) as waiting
    into doc
    from public._pilot_requests(p_from, p_to, p_batch) where type = 'medical' and decided_at is not null and status <> 'rejected';

  select count(*) as answered,
         round(avg(satisfaction)::numeric, 2) as satisfaction,
         round(avg(ease)::numeric, 2) as ease,
         count(*) filter (where faster is true) as faster_yes,
         count(*) filter (where faster is not null) as faster_answered,
         round(avg(satisfaction) filter (where role = 'student')::numeric, 2) as students,
         round(avg(satisfaction) filter (where role = 'faculty')::numeric, 2) as faculty,
         round(avg(satisfaction) filter (where role in ('approver', 'office'))::numeric, 2) as staff
    into srv from public.survey_responses;

  pct_dec := case when dec.decided + dec.open_late > 0 then round(100.0 * dec.in_time / (dec.decided + dec.open_late), 1) end;
  pct_ack := case when ack.total - ack.pending > 0 then round(100.0 * ack.in_time / (ack.total - ack.pending), 1) end;
  pct_doc := case when doc.on_time + doc.late + doc.missed > 0 then round(100.0 * doc.on_time / (doc.on_time + doc.late + doc.missed), 1) end;
  pct_online := case when req.total > 0 then round(100.0 * (req.total - req.by_office) / req.total, 1) end;

  v := jsonb_build_object(
    'from', p_from, 'to', p_to, 'batch', p_batch, 'generated_at', now(),
    'requests', to_jsonb(req),
    'online', jsonb_build_object('pct', pct_online, 'by_office', req.by_office, 'target', 100),
    'decision', jsonb_build_object('pct', pct_dec, 'in_time', dec.in_time, 'decided', dec.decided, 'open_late', dec.open_late,
                                   'open_in_window', dec.open_in_window, 'by_delegate', dec.by_delegate,
                                   'median_hours', round(dec.median_hours::numeric, 1),
                                   'window_hours', s.escalate_hours, 'target', s.target_decision_pct),
    'ack', jsonb_build_object('pct', pct_ack, 'in_time', ack.in_time, 'late', ack.late, 'deemed', ack.deemed, 'pending', ack.pending,
                              'flagged', ack.flagged, 'total', ack.total, 'window_hours', s.ack_hours, 'target', s.target_ack_pct),
    'certificates', jsonb_build_object('pct', pct_doc, 'on_time', doc.on_time, 'late', doc.late, 'missed', doc.missed,
                                       'waiting', doc.waiting, 'target', s.target_cert_pct),
    'survey', jsonb_build_object('answered', srv.answered, 'satisfaction', srv.satisfaction, 'ease', srv.ease,
                                 'faster_yes', srv.faster_yes, 'faster_answered', srv.faster_answered,
                                 'students', srv.students, 'faculty', srv.faculty, 'staff', srv.staff,
                                 'target', s.target_satisfaction, 'open', s.survey_open)
  );
  return v;
end $$;

-- One row per request with its timings, for the CSV the Week 11 report is built from.
create or replace function public.pilot_metrics_rows(p_from date, p_to date, p_batch text default null) returns table (
  request_ref text, student_no text, batch text, section text, leave_type text, status text,
  filed_by_office boolean, edited boolean, submitted_at text, decided_at text, hours_to_decision numeric,
  decided_by_delegate boolean, faculty_notified int, faculty_replied_in_window int, faculty_deemed int,
  certificate_due text, certificate_first_uploaded text, certificate_on_time boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_role('office') or public.has_role('approver')) then
    raise exception 'Only the Dean and the Dean HRM Office can see pilot results.' using errcode = '42501';
  end if;
  return query
  select r.ref, st.student_no, st.batch, st.section, public.type_label(r.type), r.status::text,
         r.filed_by is not null, r.edited_at is not null,
         to_char(r.submitted_at at time zone public.app_tz(), 'YYYY-MM-DD HH24:MI'),
         to_char(r.decided_at at time zone public.app_tz(), 'YYYY-MM-DD HH24:MI'),
         round((extract(epoch from r.decided_at - r.submitted_at) / 3600.0)::numeric, 1),
         r.decided_by_delegate,
         (select count(*)::int from public.faculty_acks a where a.leave_id = r.id),
         (select count(*)::int from public.faculty_acks a where a.leave_id = r.id and a.status in ('acknowledged', 'noted', 'flagged')
             and a.responded_at <= a.notified_at + make_interval(hours => (select ack_hours from public.settings where id = 1))),
         (select count(*)::int from public.faculty_acks a where a.leave_id = r.id and a.status = 'deemed'),
         to_char(r.doc_deadline at time zone public.app_tz(), 'YYYY-MM-DD HH24:MI'),
         to_char(r.doc_first_uploaded_at at time zone public.app_tz(), 'YYYY-MM-DD HH24:MI'),
         r.doc_first_on_time
    from public.leave_requests r join public.people st on st.id = r.student_id
   where public.local_date(r.submitted_at) between p_from and p_to
     and (p_batch is null or st.batch = p_batch)
   order by r.submitted_at;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._pilot_requests(date, date, text) from public, anon, authenticated;
revoke execute on function
  public.set_delegation(uuid, date, date, text), public.end_delegation(uuid),
  public.submit_feedback(text, text, text, text), public.set_feedback_status(bigint, text, text),
  public.submit_survey(int, int, boolean, text), public.log_app_error(text, text, text, text),
  public.public_help(), public.pilot_metrics(date, date, text), public.pilot_metrics_rows(date, date, text)
  from public, anon;
grant execute on function
  public.set_delegation(uuid, date, date, text), public.end_delegation(uuid),
  public.submit_feedback(text, text, text, text), public.set_feedback_status(bigint, text, text),
  public.submit_survey(int, int, boolean, text), public.log_app_error(text, text, text, text),
  public.public_help(), public.pilot_metrics(date, date, text), public.pilot_metrics_rows(date, date, text)
  to authenticated;
-- The help page and error reporting also work without signing in.
grant execute on function public.public_help(), public.log_app_error(text, text, text, text) to anon;
