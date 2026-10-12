-- Leave Desk: medical leave — the certificate comes first.
--
-- The student attaches the medical certificate when applying. The Dean HRM Office checks it,
-- and only then does the request reach the Dean, whose approval is final. There is no longer a
-- provisional sanction followed by a later upload.
--
-- A medical request waiting for a decision (status 'submitted') is at one of three steps:
--   no certificate             the upload did not go through, or the office returned it;
--                              the student uploads one by doc_deadline or the request is cancelled
--   certificate, not checked   with the Dean HRM Office
--   checked (doc_checked_at)   with the Dean
-- A request the office files for a student counts as checked.
-- The statuses 'sanctioned' and 'documents_in' stay in the type for old rows but are no longer used.

alter table public.leave_requests add column doc_return_note text;

-- A colleague deciding for the Dean needs to see the certificate too.
create policy "Delegates read certificates"
  on storage.objects for select to authenticated
  using (bucket_id = 'certificates' and public.is_active_delegate());

-- ---------------------------------------------------------------------------
-- Email routing: a certificate to check is as urgent as a new request for the Dean.
-- (Also fixes emails that belong to no request failing on a fresh database connection.)
-- ---------------------------------------------------------------------------
create or replace function public.queue_email(
  p_to text, p_name text, p_subject text, p_body text, p_leave uuid, p_kind text,
  p_link text default null, p_link_label text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  -- Plain variables, not a record: an email with no request (feedback, error alerts) must not
  -- read fields of an unassigned record.
  v_ref      text;
  v_from     date;
  v_filed_by uuid;
  v_name     text;
  v_no       text;
  v_stu_mail text;
  v_mode     text;
begin
  if p_leave is not null then
    select lr.ref, lr.from_date, lr.filed_by, st.full_name, st.student_no, st.email
      into v_ref, v_from, v_filed_by, v_name, v_no, v_stu_mail
      from public.leave_requests lr join public.people st on st.id = lr.student_id
     where lr.id = p_leave;
  end if;

  v_mode := case
    -- The student sees the confirmation on screen; only an office-filed request needs telling.
    when p_kind = 'student_receipt' then case when v_filed_by is not null then 'instant' else 'skip' end
    -- A class in the next 24 hours cannot wait for tomorrow's summary.
    when p_kind = 'faculty_notice' then
      case when exists (
        select 1 from public.leave_sessions ls
          join public.class_sessions cs on cs.id = ls.session_id
          join public.people f on f.id = cs.faculty_id
         where ls.leave_id = p_leave and lower(f.email) = lower(p_to) and not cs.cancelled
           and cs.starts_at between now() and now() + interval '24 hours')
      then 'instant' else 'digest' end
    when p_kind in ('approver_new', 'office_certificate') then
      case when v_from <= public.local_date(now()) + 1 then 'instant' else 'digest' end
    when p_kind in ('approver_changed', 'escalation', 'withdrawn', 'cancelled_notice', 'faculty_released',
                    'faculty_timetable_change', 'office_cancelled') then 'digest'
    -- Only the person named gets the delegation email; the Dean and office copies are not sent.
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
               when lower(p_to) = lower(v_stu_mail) then format('Your leave request %s', v_ref)
               else format('Leave %s · %s (%s)', v_ref, v_name, v_no) end);
end $$;

-- ---------------------------------------------------------------------------
-- Create a request. Medical requests from students go to the office first, not the Dean.
-- ---------------------------------------------------------------------------
create or replace function public._create_leave(
  p_student       uuid,
  p_type          public.leave_type,
  p_reason        text,
  p_from          date,
  p_to            date,
  p_session_ids   uuid[],
  p_away          boolean,
  p_return        date,
  p_contact_name  text,
  p_contact_phone text,
  p_filed_by      uuid,
  p_office_note   text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  s       public.settings%rowtype;
  st      public.people%rowtype;
  v_id    uuid;
  v_ref   text;
  v_level public.approver_level := public.route_level(p_type, p_from, p_to);
  v_n     int;
  v_by_office boolean := p_filed_by is not null;
  v_office_first boolean := p_type = 'medical' and p_filed_by is null;
  v_intro text;
  f       record;
  a       record;
begin
  select * into s from public.settings where id = 1;
  select * into st from public.people where id = p_student;

  insert into public.leave_requests (student_id, type, reason, from_date, to_date, away_from_campus, return_date,
                                     contact_name, contact_phone, approver_level, consent_at, filed_by, office_note,
                                     doc_deadline, doc_checked_at, doc_checked_by)
  values (st.id, p_type, btrim(p_reason), p_from, p_to, coalesce(p_away, false),
          case when p_away then p_return end,
          case when p_away then btrim(p_contact_name) end,
          case when p_away then btrim(p_contact_phone) end,
          v_level,
          case when p_type = 'medical' then now() end,
          p_filed_by,
          case when v_by_office then btrim(p_office_note) end,
          -- Only matters if the certificate is missing: the latest it can arrive.
          case when v_office_first then greatest(public.day_start(p_to + s.doc_days + 1) - interval '1 minute', now() + interval '24 hours') end,
          case when p_type = 'medical' and v_by_office then now() end,
          case when p_type = 'medical' and v_by_office then p_filed_by end)
  returning id, ref into v_id, v_ref;

  insert into public.leave_sessions (leave_id, session_id)
  select distinct v_id, sid from unnest(coalesce(p_session_ids, '{}'::uuid[])) as sid;
  select count(*) into v_n from public.leave_sessions where leave_id = v_id;

  if v_by_office then
    perform public.log_event(v_id, p_filed_by, 'submitted',
      format('Filed by the Dean HRM Office for the student: %s leave, %s, %s session%s',
             lower(public.type_label(p_type)), public.fmt_range(p_from, p_to), v_n, case when v_n = 1 then '' else 's' end));
    perform public.log_event(v_id, p_filed_by, 'office_note', 'Dean HRM Office note: ' || btrim(p_office_note), false);
    v_intro := 'The Dean HRM Office recorded this leave for the student'
            || case when p_to < public.local_date(now()) then ' after the dates' else '' end || '.';
  else
    perform public.log_event(v_id, st.id, 'submitted',
      format('Request submitted: %s leave, %s, %s session%s',
             lower(public.type_label(p_type)), public.fmt_range(p_from, p_to), v_n, case when v_n = 1 then '' else 's' end));
  end if;

  for f in
    select distinct cs.faculty_id from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
     where ls.leave_id = v_id
  loop
    perform public._faculty_notice(v_id, f.faculty_id, v_intro);
  end loop;

  -- A student's medical request reaches the Dean once the office has checked the certificate.
  if not v_office_first then
    for a in select * from public.decider_recipients() loop
      perform public.queue_email(a.email, a.full_name,
        format('New leave request %s: %s', v_ref, st.full_name),
        format(E'%s (%s) %s %s leave, %s.\nOpen your approval queue to decide.',
               st.full_name, st.student_no,
               case when v_by_office then 'has a request filed by the Dean HRM Office for' else 'applied for' end,
               lower(public.type_label(p_type)), public.fmt_range(p_from, p_to)),
        v_id, 'approver_new', '/approve', 'Open approval queue');
    end loop;
  end if;

  perform public.queue_email(st.email, st.full_name,
    case when v_by_office then format('Leave request %s filed for you', v_ref) else format('We received your leave request %s', v_ref) end,
    format(E'%s%s leave, %s.\nYour faculty have been notified. %s',
           case when v_by_office then E'The Dean HRM Office filed this leave request for you.\n' else '' end,
           public.type_label(p_type), public.fmt_range(p_from, p_to),
           case when v_office_first then 'The Dean HRM Office checks your medical certificate, then the Dean decides.'
                else 'The ' || public.level_label(v_level) || ' will decide.' end),
    v_id, 'student_receipt', '/student/leave/' || v_ref, 'View your leave');

  return v_ref;
end $$;

-- ---------------------------------------------------------------------------
-- Student: attach the certificate (when applying, or again after the office returned it)
-- ---------------------------------------------------------------------------
create or replace function public.attach_certificate(p_leave uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  stu    public.people%rowtype;
  x      record;
  v_again boolean;
begin
  select * into r from public.leave_requests where id = p_leave for update;
  if not found or r.student_id is distinct from public.me() then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if r.type <> 'medical' then
    raise exception 'A certificate is needed only for medical leave.' using errcode = '22023';
  end if;
  if r.status <> 'submitted' or r.doc_checked_at is not null then
    raise exception 'The certificate on this request can no longer be changed. Contact the Dean HRM Office.' using errcode = '22023';
  end if;
  if r.doc_path is null and r.doc_deadline is not null and now() > r.doc_deadline then
    raise exception 'The deadline for this certificate has passed. Contact the Dean HRM Office.' using errcode = '22023';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects where bucket_id = 'certificates' and name = p_path) then
    raise exception 'Upload the file first.' using errcode = '22023';
  end if;
  select * into stu from public.people where id = r.student_id;
  v_again := r.doc_path is not null or r.doc_return_note is not null;

  update public.leave_requests
     set doc_path = p_path, doc_uploaded_at = now(), doc_return_note = null
   where id = p_leave;
  perform public.log_event(p_leave, stu.id, 'certificate',
    case when v_again then 'New medical certificate uploaded' else 'Medical certificate attached' end);
  for x in select email, full_name from public.people where active and 'office' = any (roles) loop
    perform public.queue_email(x.email, x.full_name,
      format('Certificate to check: %s (%s)', r.ref, stu.full_name),
      format(E'%s (%s) %s for medical leave, %s.\nCheck it so the request can go to the Dean.',
             stu.full_name, stu.student_no,
             case when v_again then 'uploaded a new certificate' else 'applied with a certificate' end,
             public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'office_certificate', '/office/leave/' || r.ref, 'Check the certificate');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Dean HRM Office: check the certificate. Accepting sends the request to the Dean;
-- returning asks the student for a new one.
-- ---------------------------------------------------------------------------
create or replace function public.review_certificate(p_leave uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  stu    public.people%rowtype;
  v_me   uuid := public.me();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  a      record;
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can check certificates.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if not (r.status = 'submitted' and r.type = 'medical' and r.doc_path is not null and r.doc_checked_at is null) then
    raise exception 'There is no certificate waiting to be checked on this request.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note under 1000 characters.' using errcode = '22023';
  end if;
  select * into stu from public.people where id = r.student_id;

  if p_accept then
    update public.leave_requests
       set doc_checked_at = now(), doc_checked_by = v_me, escalated_at = null
     where id = p_leave;
    perform public.log_event(p_leave, v_me, 'certificate_checked', 'Certificate checked by the Dean HRM Office; sent to the Dean');
    if v_note is not null then
      perform public.log_event(p_leave, v_me, 'office_note', 'Dean HRM Office note: ' || v_note, false);
    end if;
    for a in select * from public.decider_recipients() loop
      perform public.queue_email(a.email, a.full_name,
        format('Medical leave %s ready for your decision: %s', r.ref, stu.full_name),
        format(E'%s (%s) applied for medical leave, %s. The Dean HRM Office has checked the certificate.%s\nOpen the request to decide.',
               stu.full_name, stu.student_no, public.fmt_range(r.from_date, r.to_date), coalesce(E'\nOffice note: ' || v_note, '')),
        p_leave, 'approver_new', '/approve/' || r.ref, 'Open the request');
    end loop;
  else
    if v_note is null then
      raise exception 'Say what is wrong with the certificate so the student can fix it.' using errcode = '22023';
    end if;
    update public.leave_requests
       set doc_path = null, doc_uploaded_at = null, doc_return_note = v_note, doc_reminded_at = null,
           doc_deadline = greatest(coalesce(doc_deadline, now()), now() + interval '48 hours')
     where id = p_leave
     returning * into r;
    perform public.log_event(p_leave, v_me, 'certificate_returned', 'Certificate returned by the Dean HRM Office: ' || v_note);
    perform public.queue_email(stu.email, stu.full_name, format('Please upload a new certificate for %s', r.ref),
      format(E'The Dean HRM Office could not accept your medical certificate.\n\n%s\n\nUpload a new one by %s. Your request goes to the Dean once the certificate is accepted.',
             v_note, public.fmt_time(r.doc_deadline)),
      p_leave, 'student_certificate', '/student/leave/' || r.ref, 'Upload a new certificate');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Decide: the Dean, or a delegate while the Dean is away. Approval is always final now;
-- a medical request can be decided only after the office has checked the certificate.
-- ---------------------------------------------------------------------------
create or replace function public.decide_leave(p_leave uuid, p_approve boolean, p_note text default null) returns public.leave_status
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  stu    public.people%rowtype;
  v_me   uuid := public.me();
  v_dean boolean := public.has_role('approver');
  v_del  boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who  text;
  v_sign text := '';
begin
  v_del := not v_dean and public.is_active_delegate();
  if not (v_dean or v_del) then
    raise exception 'Only the Dean can decide leave, or a colleague the Dean has named while away.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then
    raise exception 'This request has already been decided.' using errcode = '22023';
  end if;
  if r.type = 'medical' and r.doc_checked_at is null then
    raise exception 'The Dean HRM Office has not checked the medical certificate yet.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Add a note explaining the rejection.' using errcode = '22023';
  end if;

  select * into stu from public.people where id = r.student_id;
  if v_del then
    v_who := (select full_name from public.people where id = v_me) || ' on behalf of the Dean';
    v_sign := E'\n\nDecided by ' || v_who || '.';
  else
    v_who := 'the Dean';
  end if;

  if not p_approve then
    update public.leave_requests
       set status = 'rejected', decided_at = now(), decided_by = v_me, decided_by_delegate = v_del, decision_note = v_note, closed_at = now()
     where id = p_leave;
    perform public.log_event(p_leave, v_me, 'rejected', 'Rejected by ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s not approved', r.ref),
      format(E'Your %s leave for %s was not approved.\n\nReason: %s%s', lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), v_note, v_sign),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
    return 'rejected';
  end if;

  update public.leave_requests
     set status = 'approved', decided_at = now(), decided_by = v_me, decided_by_delegate = v_del, decision_note = v_note, closed_at = now()
   where id = p_leave;
  perform public.log_event(p_leave, v_me, 'approved', 'Approved by ' || v_who);
  perform public.queue_email(stu.email, stu.full_name, format('Leave %s approved', r.ref),
    format(E'Your %s leave for %s is approved.%s%s', lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), coalesce(E'\n\nNote: ' || v_note, ''), v_sign),
    p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
  return 'approved';
end $$;

-- ---------------------------------------------------------------------------
-- Student: change a request that is still waiting for a decision. If the dates of a checked
-- medical request change, the office checks the certificate again before the Dean sees it.
-- ---------------------------------------------------------------------------
create or replace function public.edit_leave(
  p_leave         uuid,
  p_reason        text,
  p_from          date,
  p_to            date,
  p_session_ids   uuid[] default '{}',
  p_away          boolean default false,
  p_return        date default null,
  p_contact_name  text default null,
  p_contact_phone text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r       public.leave_requests%rowtype;
  st      public.people%rowtype;
  s       public.settings%rowtype;
  v_old   uuid[];
  v_new   uuid[];
  v_parts text[] := '{}';
  v_recheck boolean;
  v_dean_knows boolean;
  a       record;
begin
  select * into r from public.leave_requests where id = p_leave for update;
  if not found or r.student_id is distinct from public.me() then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'submitted' then
    raise exception 'Only requests waiting for a decision can be changed. Contact the Dean HRM Office.' using errcode = '22023';
  end if;
  select * into st from public.people where id = r.student_id;
  select * into s from public.settings where id = 1;

  -- The timing rules depend on the first day, so they are checked again only if it moves.
  perform public._check_leave(st.id, r.type, p_reason, p_from, p_to, p_session_ids, p_away, p_return, p_contact_name, p_contact_phone,
                              p_from is distinct from r.from_date, s.max_leave_days, true, r.id);

  v_old := array(select session_id from public.leave_sessions where leave_id = r.id order by session_id);
  v_new := array(select distinct x from unnest(coalesce(p_session_ids, '{}'::uuid[])) x order by x);

  if p_from <> r.from_date or p_to <> r.to_date then
    v_parts := v_parts || format('dates %s → %s', public.fmt_range(r.from_date, r.to_date), public.fmt_range(p_from, p_to));
  end if;
  if v_old is distinct from v_new then
    v_parts := v_parts || format('sessions %s → %s', cardinality(v_old), cardinality(v_new));
  end if;
  if btrim(p_reason) <> r.reason then
    v_parts := v_parts || 'reason updated'::text;
  end if;
  if coalesce(p_away, false) <> r.away_from_campus
     or (coalesce(p_away, false) and (p_return is distinct from r.return_date
         or btrim(p_contact_name) is distinct from r.contact_name or btrim(p_contact_phone) is distinct from r.contact_phone)) then
    v_parts := v_parts || 'travel details updated'::text;
  end if;
  if cardinality(v_parts) = 0 then
    raise exception 'Nothing has changed.' using errcode = '22023';
  end if;

  v_recheck := r.type = 'medical' and r.filed_by is null and r.doc_checked_at is not null
               and (p_from <> r.from_date or p_to <> r.to_date);
  v_dean_knows := r.type <> 'medical' or (r.doc_checked_at is not null and not v_recheck);

  update public.leave_requests
     set reason = btrim(p_reason), from_date = p_from, to_date = p_to,
         away_from_campus = coalesce(p_away, false),
         return_date = case when p_away then p_return end,
         contact_name = case when p_away then btrim(p_contact_name) end,
         contact_phone = case when p_away then btrim(p_contact_phone) end,
         doc_checked_at = case when v_recheck then null else doc_checked_at end,
         doc_checked_by = case when v_recheck then null else doc_checked_by end,
         doc_deadline = case when r.type = 'medical' and r.filed_by is null
                             then greatest(coalesce(doc_deadline, now()), public.day_start(p_to + s.doc_days + 1) - interval '1 minute')
                             else doc_deadline end,
         edited_at = now()
   where id = r.id;
  perform public._replace_leave_sessions(r.id, v_new);

  perform public.log_event(r.id, st.id, 'edited', 'Changed by the student: ' || array_to_string(v_parts, '; '));
  perform public._sync_leave_faculty(r.id, v_old, format('%s changed this leave request.', st.full_name));

  if v_recheck then
    perform public.log_event(r.id, null, 'certificate_recheck', 'The dates changed, so the Dean HRM Office will check the certificate again');
    for a in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(a.email, a.full_name,
        format('Certificate to check again: %s (%s)', r.ref, st.full_name),
        format(E'%s (%s) changed the dates of a medical leave you had checked: %s.\nCheck that the certificate still covers it before it goes back to the Dean.',
               st.full_name, st.student_no, array_to_string(v_parts, '; ')),
        r.id, 'office_certificate', '/office/leave/' || r.ref, 'Check the certificate');
    end loop;
  end if;

  if v_dean_knows then
    for a in select * from public.decider_recipients() loop
      perform public.queue_email(a.email, a.full_name,
        format('Leave request %s changed: %s', r.ref, st.full_name),
        format(E'%s (%s) changed the request before a decision: %s.\nIt is now %s leave, %s.',
               st.full_name, st.student_no, array_to_string(v_parts, '; '), lower(public.type_label(r.type)), public.fmt_range(p_from, p_to)),
        r.id, 'approver_changed', '/approve/' || r.ref, 'Open the request');
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  r record;
  x record;
  v_deemed int := 0;
  v_escalated int := 0;
  v_reminded int := 0;
  v_cancelled int := 0;
  v_alerts int := 0;
  v_errs int;
  v_lines text;
  v_result jsonb;
begin
  select * into s from public.settings where id = 1;

  -- Faculty who did not reply within their window are recorded as acknowledged.
  for r in
    update public.faculty_acks a
       set status = 'deemed', responded_at = a.notified_at + make_interval(hours => s.ack_hours)
      from public.leave_requests lr
     where a.leave_id = lr.id and a.status = 'pending'
       and lr.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
       and now() >= a.notified_at + make_interval(hours => s.ack_hours)
    returning a.leave_id, a.faculty_id
  loop
    perform public.log_event(r.leave_id, null, 'deemed',
      (select full_name from public.people where id = r.faculty_id) || format(': no reply in %s hours, recorded as acknowledged', s.ack_hours));
    v_deemed := v_deemed + 1;
  end loop;

  -- Requests with the Dean too long: remind the Dean, any delegate and the office, once.
  -- A medical request reaches the Dean when its certificate is checked, so the clock starts then.
  for r in
    select lr.*, stu.full_name as student_name, stu.student_no
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.escalated_at is null
       and (lr.type <> 'medical' or lr.doc_checked_at is not null)
       and now() >= coalesce(lr.doc_checked_at, lr.submitted_at) + make_interval(hours => s.escalate_hours)
     for update of lr
  loop
    update public.leave_requests set escalated_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'escalated', format('No decision in %s hours: reminder sent to the Dean and the Dean HRM Office', s.escalate_hours), false);
    for x in
      select d.email, d.full_name from public.decider_recipients() d
      union
      select email, full_name from public.people where active and 'office' = any (roles)
    loop
      perform public.queue_email(x.email, x.full_name, format('Reminder: %s is waiting for a decision', r.ref),
        format('%s (%s) applied for %s leave, %s. The request has had no decision for %s hours.',
               r.student_name, r.student_no, lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), s.escalate_hours),
        r.id, 'escalation', '/approve/' || r.ref, 'Open the request');
    end loop;
    v_escalated := v_escalated + 1;
  end loop;

  -- Certificates waiting too long for the office: remind the office, once.
  for r in
    select lr.*, stu.full_name as student_name, stu.student_no
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.type = 'medical' and lr.escalated_at is null
       and lr.doc_path is not null and lr.doc_checked_at is null
       and now() >= lr.doc_uploaded_at + make_interval(hours => s.escalate_hours)
     for update of lr
  loop
    update public.leave_requests set escalated_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'escalated', format('Certificate not checked in %s hours: reminder sent to the Dean HRM Office', s.escalate_hours), false);
    for x in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(x.email, x.full_name, format('Reminder: certificate for %s is waiting to be checked', r.ref),
        format('%s (%s) applied for medical leave, %s. The certificate has waited %s hours, and the Dean cannot decide until it is checked.',
               r.student_name, r.student_no, public.fmt_range(r.from_date, r.to_date), s.escalate_hours),
        r.id, 'escalation', '/office/leave/' || r.ref, 'Check the certificate');
    end loop;
    v_escalated := v_escalated + 1;
  end loop;

  -- Certificate still missing within 24 hours of its deadline: one reminder.
  for r in
    select lr.*, stu.full_name as student_name, stu.email as student_email
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.type = 'medical' and lr.doc_path is null and lr.doc_reminded_at is null
       and now() <= lr.doc_deadline and lr.doc_deadline - now() <= interval '24 hours'
     for update of lr
  loop
    update public.leave_requests set doc_reminded_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'reminder', 'Reminder sent: certificate needed within 24 hours');
    perform public.queue_email(r.student_email, r.student_name, format('Reminder: upload your certificate for %s', r.ref),
      format('Your medical leave request has no certificate yet. Upload it by %s, or the request will be cancelled automatically.', public.fmt_time(r.doc_deadline)),
      r.id, 'student_reminder', '/student/leave/' || r.ref, 'Upload certificate');
    v_reminded := v_reminded + 1;
  end loop;

  -- Certificate deadline passed with no certificate: cancel.
  for r in
    select lr.*, stu.full_name as student_name, stu.student_no, stu.email as student_email
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.type = 'medical' and lr.doc_path is null and now() > lr.doc_deadline
     for update of lr
  loop
    update public.leave_requests
       set status = 'cancelled', closed_at = now(), cancel_reason = 'The medical certificate was not uploaded by the deadline.'
     where id = r.id;
    perform public.log_event(r.id, null, 'cancelled', 'Cancelled automatically: certificate not uploaded by the deadline');
    perform public.queue_email(r.student_email, r.student_name, format('Leave %s cancelled', r.ref),
      format(E'Your medical certificate was not uploaded by %s, so the request for %s is cancelled. The absence counts as unapproved.\nContact the Dean HRM Office if this is wrong.',
             public.fmt_time(r.doc_deadline), public.fmt_range(r.from_date, r.to_date)),
      r.id, 'student_cancelled', '/student/leave/' || r.ref, 'View your leave');
    for x in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(x.email, x.full_name, format('%s cancelled automatically (%s)', r.ref, r.student_name),
        'The certificate deadline passed without an upload. The absence stays unapproved.', r.id, 'office_cancelled', '/office/leave/' || r.ref, 'Open the request');
    end loop;
    for x in
      select p.email, p.full_name from public.faculty_acks a join public.people p on p.id = a.faculty_id
       where a.leave_id = r.id and a.status = 'pending'
    loop
      perform public.queue_email(x.email, x.full_name, format('Leave %s cancelled', r.ref),
        format('The leave of %s (%s) for %s was cancelled. No action is needed.', r.student_name, r.student_no, public.fmt_range(r.from_date, r.to_date)),
        r.id, 'cancelled_notice');
    end loop;
    v_cancelled := v_cancelled + 1;
  end loop;

  -- Application errors: at most one alert email to the office per hour.
  select count(*) into v_errs from public.app_errors where alerted_at is null;
  if v_errs > 0 and not exists (select 1 from public.app_errors where alerted_at > now() - interval '1 hour') then
    select string_agg('• ' || left(message, 160) || coalesce(' (' || path || ')', ''), E'\n')
      into v_lines
      from (select message, path from public.app_errors where alerted_at is null order by id desc limit 5) e;
    for x in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(x.email, x.full_name,
        format('Leave Desk: %s new error%s', v_errs, case when v_errs = 1 then '' else 's' end),
        format(E'Leave Desk recorded %s error%s since the last alert. The latest:\n\n%s\n\nOpen System health for details. If students or faculty are affected, pass this on to whoever maintains Leave Desk.',
               v_errs, case when v_errs = 1 then '' else 's' end, v_lines),
        null, 'office_errors', '/office/health', 'Open System health');
    end loop;
    update public.app_errors set alerted_at = now() where alerted_at is null;
    v_alerts := 1;
  end if;

  v_result := jsonb_build_object('deemed', v_deemed, 'escalated', v_escalated, 'reminded', v_reminded,
                                 'cancelled', v_cancelled, 'error_alerts', v_alerts);
  insert into public.job_runs (name, last_run_at, last_result) values ('scheduled_jobs', now(), v_result)
  on conflict (name) do update set last_run_at = excluded.last_run_at, last_result = excluded.last_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- The morning summary: the Dean sees medical requests only once checked; the office sees
-- certificates waiting to be checked.
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
      select lr.id, lr.ref, lr.type, lr.from_date, lr.to_date, coalesce(lr.doc_checked_at, lr.submitted_at) as reached,
             st.full_name, st.student_no,
             bool_or(i.kind = 'approver_changed') as changed, bool_or(i.kind = 'escalation') as overdue,
             exists (select 1 from public.ack_concerns c where c.leave_id = lr.id) as concern
        from public.email_digest_items i
        join public.leave_requests lr on lr.id = i.leave_id
        join public.people st on st.id = lr.student_id
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind in ('approver_new', 'approver_changed', 'escalation') and lr.status = 'submitted'
         and (lr.type <> 'medical' or lr.doc_checked_at is not null)
       group by lr.id, lr.ref, lr.type, lr.from_date, lr.to_date, lr.doc_checked_at, lr.submitted_at, st.full_name, st.student_no
       order by 6
    loop
      v_seen := v_seen || lv.id;
      v_links := v_links || jsonb_build_array(jsonb_build_object(
        'path', case when v_decider then '/approve/' else '/office/leave/' end || lv.ref, 'label', 'Open ' || lv.ref));
      v_act := v_act || (
        format('%s · %s (%s) · %s leave · %s', lv.ref, lv.full_name, lv.student_no, public.type_label(lv.type), public.fmt_range(lv.from_date, lv.to_date))
        || format(E'\n   %s%s%s%s%s',
                  case when now() - lv.reached < interval '1 hour' then 'Just arrived'
                       else 'Waiting ' || floor(extract(epoch from now() - lv.reached) / 3600)::int || ' h' end,
                  case when lv.type = 'medical' then ' · certificate checked by the office' else '' end,
                  case when lv.overdue then ' · overdue' else '' end,
                  case when lv.changed then ' · changed by the student' else '' end,
                  case when lv.concern then ' · a faculty member raised a concern' else '' end)
        || format(E'\n[[%s]]', jsonb_array_length(v_links)));
    end loop;

    -- Certificates waiting to be checked.
    for lv in
      select lr.id, lr.ref, lr.from_date, lr.to_date, lr.doc_uploaded_at, st.full_name, st.student_no,
             bool_or(i.kind = 'escalation') as overdue
        from public.email_digest_items i
        join public.leave_requests lr on lr.id = i.leave_id
        join public.people st on st.id = lr.student_id
       where i.digested_at is null and i.id <= v_max and lower(i.to_email) = rcpt.email
         and i.kind in ('office_certificate', 'escalation')
         and lr.status = 'submitted' and lr.type = 'medical' and lr.doc_path is not null and lr.doc_checked_at is null
       group by lr.id, lr.ref, lr.from_date, lr.to_date, lr.doc_uploaded_at, st.full_name, st.student_no
       order by lr.doc_uploaded_at
    loop
      v_links := v_links || jsonb_build_array(jsonb_build_object('path', '/office/leave/' || lv.ref, 'label', 'Check the certificate'));
      v_act := v_act || (format('Certificate to check: %s · %s (%s) · %s%s', lv.ref, lv.full_name, lv.student_no,
                                public.fmt_range(lv.from_date, lv.to_date), case when lv.overdue then ' · overdue' else '' end)
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
      select count(*), min(coalesce(doc_checked_at, submitted_at)) into v_others, v_oldest
        from public.leave_requests
       where status = 'submitted' and (type <> 'medical' or doc_checked_at is not null) and not (id = any (v_seen));
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

-- ---------------------------------------------------------------------------
-- Pilot results: the certificate measure is now how quickly the office checks certificates.
-- ---------------------------------------------------------------------------
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

  -- Students' medical requests: was the certificate checked within the reminder time of its upload?
  select count(*) filter (where doc_checked_at is not null) as checked,
         count(*) filter (where doc_checked_at is not null and doc_checked_at - doc_uploaded_at <= make_interval(hours => s.escalate_hours)) as in_time,
         count(*) filter (where doc_checked_at is null and doc_path is not null and status = 'submitted'
                            and now() - doc_uploaded_at > make_interval(hours => s.escalate_hours)) as open_late,
         count(*) filter (where doc_checked_at is null and doc_path is not null and status = 'submitted'
                            and now() - doc_uploaded_at <= make_interval(hours => s.escalate_hours)) as waiting,
         count(*) filter (where exists (select 1 from public.leave_events e where e.leave_id = r.id and e.kind = 'certificate_returned')) as returned,
         count(*) filter (where status = 'cancelled' and cancel_reason like 'The medical certificate was not uploaded%') as missed
    into doc
    from public._pilot_requests(p_from, p_to, p_batch) r where type = 'medical' and filed_by is null;

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
  pct_doc := case when doc.checked + doc.open_late > 0 then round(100.0 * doc.in_time / (doc.checked + doc.open_late), 1) end;
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
    'certificates', jsonb_build_object('pct', pct_doc, 'in_time', doc.in_time, 'checked', doc.checked, 'open_late', doc.open_late,
                                       'waiting', doc.waiting, 'returned', doc.returned, 'missed', doc.missed,
                                       'window_hours', s.escalate_hours, 'target', s.target_cert_pct),
    'survey', jsonb_build_object('answered', srv.answered, 'satisfaction', srv.satisfaction, 'ease', srv.ease,
                                 'faster_yes', srv.faster_yes, 'faster_answered', srv.faster_answered,
                                 'students', srv.students, 'faculty', srv.faculty, 'staff', srv.staff,
                                 'target', s.target_satisfaction, 'open', s.survey_open)
  );
  return v;
end $$;
