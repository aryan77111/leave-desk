-- Leave Desk: workflow functions
-- Every state change happens here, so the rules hold no matter which client calls them.

-- ---------------------------------------------------------------------------
-- Student: submit
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave(
  p_type          public.leave_type,
  p_reason        text,
  p_from          date,
  p_to            date,
  p_session_ids   uuid[] default '{}',
  p_away          boolean default false,
  p_return        date default null,
  p_contact_name  text default null,
  p_contact_phone text default null,
  p_consent       boolean default false
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  s        public.settings%rowtype;
  st       public.people%rowtype;
  v_id     uuid;
  v_ref    text;
  v_level  public.approver_level;
  v_today  date;
  v_bad    int;
  v_token  text;
  f        record;
  a        record;
  v_n      int;
begin
  select * into st from public.people where user_id = auth.uid() and active and 'student' = any (roles);
  if not found then
    raise exception 'Only registered students can apply for leave.' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;
  v_today := public.local_date(now());

  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day of leave.' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The last day is before the first day.' using errcode = '22023';
  end if;
  if p_to - p_from + 1 > s.max_leave_days then
    raise exception 'Leave longer than % days is handled by the programme office directly.', s.max_leave_days using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Add a short reason.' using errcode = '22023';
  end if;
  if length(p_reason) > 1000 then
    raise exception 'Keep the reason under 1000 characters.' using errcode = '22023';
  end if;

  if p_type = 'medical' then
    if now() > public.day_start(p_from + 1) + make_interval(hours => s.medical_late_hours) then
      raise exception 'Medical leave must be applied within % hours of the first day of absence. Contact the programme office.', s.medical_late_hours using errcode = '22023';
    end if;
    if p_from > v_today + s.medical_ahead_days then
      raise exception 'Medical leave can be applied at most % days ahead.', s.medical_ahead_days using errcode = '22023';
    end if;
    if not coalesce(p_consent, false) then
      raise exception 'Confirm the consent for storing your medical certificate.' using errcode = '22023';
    end if;
  else
    if public.day_start(p_from) - now() < make_interval(hours => s.notice_hours) then
      raise exception '% leave needs % hours'' notice.', public.type_label(p_type), s.notice_hours using errcode = '22023';
    end if;
  end if;

  if coalesce(p_away, false) then
    if p_return is null or nullif(btrim(p_contact_name), '') is null or nullif(btrim(p_contact_phone), '') is null then
      raise exception 'For leave away from campus, add your return date and a contact person with a phone number.' using errcode = '22023';
    end if;
    if p_return <= p_to then
      raise exception 'The return date should be after the last day of leave.' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.leave_requests r
     where r.student_id = st.id
       and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
       and daterange(r.from_date, r.to_date, '[]') && daterange(p_from, p_to, '[]')
  ) then
    raise exception 'You already have leave covering some of these dates.' using errcode = '23P01';
  end if;

  select count(*) into v_bad
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as sid
   where not exists (
     select 1 from public.class_sessions cs
      where cs.id = sid and cs.batch = st.batch and cs.section = st.section and not cs.cancelled
        and public.local_date(cs.starts_at) between p_from and p_to);
  if v_bad > 0 then
    raise exception 'Some selected sessions are not in your timetable for these dates.' using errcode = '22023';
  end if;

  v_level := public.route_level(p_type, p_from, p_to);

  insert into public.leave_requests (student_id, type, reason, from_date, to_date, away_from_campus, return_date,
                                     contact_name, contact_phone, approver_level, consent_at)
  values (st.id, p_type, btrim(p_reason), p_from, p_to, coalesce(p_away, false),
          case when p_away then p_return end,
          case when p_away then btrim(p_contact_name) end,
          case when p_away then btrim(p_contact_phone) end,
          v_level,
          case when p_type = 'medical' then now() end)
  returning id, ref into v_id, v_ref;

  insert into public.leave_sessions (leave_id, session_id)
  select distinct v_id, sid from unnest(coalesce(p_session_ids, '{}'::uuid[])) as sid;

  select count(*) into v_n from public.leave_sessions where leave_id = v_id;
  perform public.log_event(v_id, st.id, 'submitted',
    format('Request submitted: %s leave, %s, %s session%s', lower(public.type_label(p_type)), public.fmt_range(p_from, p_to), v_n, case when v_n = 1 then '' else 's' end));

  -- One grouped notice per faculty member, each with a one-time response link.
  for f in
    select cs.faculty_id, p.full_name, p.email,
           string_agg(cs.course_code || ' · ' || public.fmt_time(cs.starts_at), E'\n' order by cs.starts_at) as lines,
           count(*) as n
      from public.leave_sessions ls
      join public.class_sessions cs on cs.id = ls.session_id
      join public.people p on p.id = cs.faculty_id
     where ls.leave_id = v_id
     group by cs.faculty_id, p.full_name, p.email
  loop
    v_token := encode(gen_random_bytes(24), 'hex');
    insert into public.faculty_acks (leave_id, faculty_id, token_hash, token_expires_at)
    values (v_id, f.faculty_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
    perform public.queue_email(
      f.email, f.full_name,
      format('Leave notice: %s (%s), %s', st.full_name, st.student_no, public.fmt_range(p_from, p_to)),
      format(E'%s leave%s. %s of your sessions will be missed:\n\n%s\n\n%s\n\nNo reply within %s hours is recorded as acknowledged. Make-up of any evaluation stays at your discretion.',
             public.type_label(p_type),
             case when p_type = 'medical' then ', for information' else '' end,
             f.n, f.lines,
             case when p_type = 'medical' then 'The reason and certificate are visible to the approver only.' else 'Reason: ' || btrim(p_reason) end,
             s.ack_hours),
      v_id, 'faculty_notice', '/r/' || v_token, 'Respond to this notice');
  end loop;

  for a in
    select email, full_name from public.people
     where active and 'approver' = any (roles) and approver_level = v_level
  loop
    perform public.queue_email(a.email, a.full_name,
      format('New leave request %s: %s', v_ref, st.full_name),
      format(E'%s (%s) applied for %s leave, %s.\nOpen your approval queue to decide.', st.full_name, st.student_no, lower(public.type_label(p_type)), public.fmt_range(p_from, p_to)),
      v_id, 'approver_new', '/approve', 'Open approval queue');
  end loop;

  perform public.queue_email(st.email, st.full_name,
    format('We received your leave request %s', v_ref),
    format(E'%s leave, %s.\nYour faculty have been notified. The %s will decide.%s',
           public.type_label(p_type), public.fmt_range(p_from, p_to), public.level_label(v_level),
           case when p_type = 'medical' then E'\nIf it is sanctioned, upload your medical certificate within ' || s.doc_days || ' days of resuming classes.' else '' end),
    v_id, 'student_receipt', '/student', 'View your leave');

  return v_ref;
end $$;

-- ---------------------------------------------------------------------------
-- Faculty responses (signed in, or through the one-time email link)
-- ---------------------------------------------------------------------------
create or replace function public._record_response(p_leave uuid, p_faculty uuid, p_kind text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r   public.leave_requests%rowtype;
  fac public.people%rowtype;
  stu public.people%rowtype;
  a   record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_kind not in ('acknowledge', 'note', 'flag') then
    raise exception 'Unknown response.' using errcode = '22023';
  end if;
  if p_kind in ('note', 'flag') and v_note is null then
    raise exception 'Write the note first.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note under 1000 characters.' using errcode = '22023';
  end if;

  select * into r from public.leave_requests where id = p_leave;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.status in ('withdrawn', 'rejected', 'cancelled') then
    raise exception 'This request is closed. No response is needed.' using errcode = '22023';
  end if;

  update public.faculty_acks
     set status = case p_kind when 'acknowledge' then 'acknowledged'::public.ack_status
                              when 'note' then 'noted'::public.ack_status
                              else 'flagged'::public.ack_status end,
         note = case when p_kind = 'note' then v_note end,
         responded_at = now()
   where leave_id = p_leave and faculty_id = p_faculty and status = 'pending';
  if not found then
    raise exception 'You have already responded to this request.' using errcode = '22023';
  end if;

  select * into fac from public.people where id = p_faculty;
  select * into stu from public.people where id = r.student_id;

  if p_kind = 'flag' then
    insert into public.ack_concerns (leave_id, faculty_id, concern) values (p_leave, p_faculty, v_note);
    perform public.log_event(p_leave, p_faculty, 'flagged', fac.full_name || ' raised a concern with the approver');
    for a in select email, full_name from public.people
              where active and 'approver' = any (roles) and approver_level = r.approver_level
    loop
      perform public.queue_email(a.email, a.full_name,
        format('Concern raised on %s (%s)', r.ref, stu.full_name),
        format(E'%s wrote:\n\n%s', fac.full_name, v_note),
        p_leave, 'approver_concern', '/approve/' || r.ref, 'Open the request');
    end loop;
  elsif p_kind = 'note' then
    perform public.log_event(p_leave, p_faculty, 'noted', fac.full_name || ' acknowledged with a note');
    perform public.queue_email(stu.email, stu.full_name,
      format('Note from %s on %s', fac.full_name, r.ref), v_note, p_leave, 'student_note', '/student/leave/' || r.ref, 'View your leave');
  else
    perform public.log_event(p_leave, p_faculty, 'acknowledged', fac.full_name || ' acknowledged');
  end if;
end $$;

create or replace function public.respond_to_leave(p_leave uuid, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('faculty') then
    raise exception 'Only faculty can respond to leave notices.' using errcode = '42501';
  end if;
  perform public._record_response(p_leave, public.me(), p_kind, p_note);
end $$;

-- What the one-time link page shows. Never includes medical reasons or contact details.
create or replace function public.token_context(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  a public.faculty_acks%rowtype;
  r public.leave_requests%rowtype;
  stu public.people%rowtype;
  fac public.people%rowtype;
  s public.settings%rowtype;
  v_state text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into a from public.faculty_acks where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  select * into r from public.leave_requests where id = a.leave_id;
  select * into stu from public.people where id = r.student_id;
  select * into fac from public.people where id = a.faculty_id;
  select * into s from public.settings where id = 1;

  v_state := case
    when a.status <> 'pending' then 'answered'
    when r.status in ('withdrawn', 'rejected', 'cancelled') then 'closed'
    when a.token_expires_at < now() then 'expired'
    else 'open' end;

  return jsonb_build_object(
    'state', v_state,
    'ack_status', a.status,
    'responded_at', a.responded_at,
    'faculty_name', fac.full_name,
    'student_name', stu.full_name,
    'student_no', stu.student_no,
    'ref', r.ref,
    'type', r.type,
    'leave_status', r.status,
    'from_date', r.from_date,
    'to_date', r.to_date,
    'reason', case when r.type = 'medical' then null else r.reason end,
    'respond_by', r.submitted_at + make_interval(hours => s.ack_hours),
    'programme_name', s.programme_name,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('course_code', cs.course_code, 'course_name', cs.course_name, 'starts_at', cs.starts_at) order by cs.starts_at)
        from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
       where ls.leave_id = r.id and cs.faculty_id = a.faculty_id), '[]'::jsonb)
  );
end $$;

create or replace function public.respond_by_token(p_token text, p_kind text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.faculty_acks%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'This link is not valid.' using errcode = '22023';
  end if;
  select * into a from public.faculty_acks
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if not found then raise exception 'This link is not valid.' using errcode = '22023'; end if;
  if a.token_expires_at < now() then raise exception 'This link has expired. Sign in to Leave Desk to respond.' using errcode = '22023'; end if;
  perform public._record_response(a.leave_id, a.faculty_id, p_kind, p_note);
  return public.token_context(p_token);
end $$;

-- Faculty inbox: requests touching the signed-in faculty member's sessions.
create or replace function public.faculty_inbox(p_include_answered boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x ->> 'submitted_at')), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'leave_id', r.id, 'ref', r.ref, 'type', r.type, 'status', r.status,
      'from_date', r.from_date, 'to_date', r.to_date, 'submitted_at', r.submitted_at,
      'reason', case when r.type = 'medical' then null else r.reason end,
      'student_name', stu.full_name, 'student_no', stu.student_no,
      'ack_status', a.status, 'note', a.note, 'responded_at', a.responded_at,
      'respond_by', r.submitted_at + make_interval(hours => (select ack_hours from public.settings where id = 1)),
      'sessions', (select jsonb_agg(jsonb_build_object('course_code', cs.course_code, 'starts_at', cs.starts_at) order by cs.starts_at)
                     from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
                    where ls.leave_id = r.id and cs.faculty_id = a.faculty_id)
    ) as x
    from public.faculty_acks a
    join public.leave_requests r on r.id = a.leave_id
    join public.people stu on stu.id = r.student_id
    where public.has_role('faculty')
      and a.faculty_id = public.me()
      and (case when p_include_answered then a.status <> 'pending'
                else a.status = 'pending' and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved') end)
    order by r.submitted_at desc
    limit 200
  ) q
$$;

-- Students away from the signed-in faculty member's sessions in a date window.
create or replace function public.faculty_absences(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_code', cs.course_code, 'starts_at', cs.starts_at, 'batch', cs.batch, 'section', cs.section,
           'student_name', stu.full_name, 'student_no', stu.student_no, 'ref', r.ref, 'status', r.status)
         order by cs.starts_at, stu.full_name), '[]'::jsonb)
    from public.class_sessions cs
    join public.leave_sessions ls on ls.session_id = cs.id
    join public.leave_requests r on r.id = ls.leave_id
    join public.people stu on stu.id = r.student_id
   where public.has_role('faculty')
     and cs.faculty_id = public.me()
     and public.local_date(cs.starts_at) between p_from and p_to
     and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
$$;

-- ---------------------------------------------------------------------------
-- Approver: decide
-- ---------------------------------------------------------------------------
create or replace function public.decide_leave(p_leave uuid, p_approve boolean, p_note text default null) returns public.leave_status
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  s      public.settings%rowtype;
  stu    public.people%rowtype;
  v_me   uuid := public.me();
  v_lvl  public.approver_level := public.my_approver_level();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who  text;
begin
  if v_lvl is null then
    raise exception 'Only approvers can decide leave.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.approver_level <> v_lvl and v_lvl <> 'dean' then
    raise exception 'This request is routed to the %.', public.level_label(r.approver_level) using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'This request has already been decided.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Add a note explaining the rejection.' using errcode = '22023';
  end if;

  select * into s from public.settings where id = 1;
  select * into stu from public.people where id = r.student_id;
  v_who := public.level_label(v_lvl);

  if not p_approve then
    update public.leave_requests set status = 'rejected', decided_at = now(), decided_by = v_me, decision_note = v_note, closed_at = now() where id = p_leave;
    perform public.log_event(p_leave, v_me, 'rejected', 'Rejected by the ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s not approved', r.ref),
      format(E'Your %s leave for %s was not approved.\n\nReason: %s', lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), v_note),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
    return 'rejected';
  elsif r.type = 'medical' then
    update public.leave_requests
       set status = 'sanctioned', decided_at = now(), decided_by = v_me, decision_note = v_note,
           doc_deadline = greatest(public.day_start(r.to_date + s.doc_days + 1) - interval '1 minute', now() + interval '24 hours')
     where id = p_leave
     returning * into r;
    perform public.log_event(p_leave, v_me, 'sanctioned', 'Sanctioned (provisional) by the ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s sanctioned: upload your certificate', r.ref),
      format(E'Your medical leave for %s is sanctioned provisionally.\nUpload your medical certificate by %s, or the leave will be cancelled automatically.%s',
             public.fmt_range(r.from_date, r.to_date), public.fmt_time(r.doc_deadline), coalesce(E'\n\nNote: ' || v_note, '')),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'Upload certificate');
    return 'sanctioned';
  else
    update public.leave_requests set status = 'approved', decided_at = now(), decided_by = v_me, decision_note = v_note, closed_at = now() where id = p_leave;
    perform public.log_event(p_leave, v_me, 'approved', 'Approved by the ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s approved', r.ref),
      format(E'Your %s leave for %s is approved.%s', lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), coalesce(E'\n\nNote: ' || v_note, '')),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
    return 'approved';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Student: withdraw, attach certificate
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_leave(p_leave uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r   public.leave_requests%rowtype;
  stu public.people%rowtype;
  x   record;
begin
  select * into r from public.leave_requests where id = p_leave for update;
  if not found or r.student_id is distinct from public.me() then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'submitted' then
    raise exception 'Only requests awaiting a decision can be withdrawn.' using errcode = '22023';
  end if;
  select * into stu from public.people where id = r.student_id;
  update public.leave_requests set status = 'withdrawn', closed_at = now() where id = p_leave;
  perform public.log_event(p_leave, stu.id, 'withdrawn', 'Withdrawn by the student');
  for x in
    select p.email, p.full_name from public.faculty_acks a join public.people p on p.id = a.faculty_id
     where a.leave_id = p_leave and a.status = 'pending'
    union
    select email, full_name from public.people where active and 'approver' = any (roles) and approver_level = r.approver_level
  loop
    perform public.queue_email(x.email, x.full_name, format('Leave %s withdrawn', r.ref),
      format('%s (%s) withdrew the request for %s. No action is needed.', stu.full_name, stu.student_no, public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'withdrawn');
  end loop;
end $$;

create or replace function public.attach_certificate(p_leave uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.leave_requests%rowtype;
  stu public.people%rowtype;
  o record;
begin
  select * into r from public.leave_requests where id = p_leave for update;
  if not found or r.student_id is distinct from public.me() then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'sanctioned' then
    raise exception 'A certificate can be added only after the leave is sanctioned.' using errcode = '22023';
  end if;
  if now() > r.doc_deadline then
    raise exception 'The deadline for this certificate has passed. Contact the programme office.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like (auth.uid()::text || '/' || p_leave::text || '/%') then
    raise exception 'The uploaded file does not belong to this request.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'certificates' and name = p_path) then
    raise exception 'Upload the file first.' using errcode = '22023';
  end if;

  select * into stu from public.people where id = r.student_id;
  update public.leave_requests set status = 'documents_in', doc_path = p_path, doc_uploaded_at = now() where id = p_leave;
  perform public.log_event(p_leave, stu.id, 'certificate', 'Medical certificate uploaded');
  for o in select email, full_name from public.people where active and 'office' = any (roles) loop
    perform public.queue_email(o.email, o.full_name, format('Certificate to check: %s (%s)', r.ref, stu.full_name),
      format('%s uploaded a medical certificate for %s.', stu.full_name, public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'office_certificate', '/office/leave/' || r.ref, 'Check the certificate');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Office: check the certificate
-- ---------------------------------------------------------------------------
create or replace function public.review_certificate(p_leave uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.leave_requests%rowtype;
  stu public.people%rowtype;
  v_me uuid := public.me();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  n int;
begin
  if not public.has_role('office') then
    raise exception 'Only the programme office can check certificates.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'documents_in' then
    raise exception 'There is no certificate waiting to be checked on this request.' using errcode = '22023';
  end if;
  select * into stu from public.people where id = r.student_id;

  if p_accept then
    select count(*) into n from public.leave_sessions where leave_id = p_leave;
    update public.leave_requests set status = 'approved', doc_checked_at = now(), doc_checked_by = v_me, closed_at = now() where id = p_leave;
    perform public.log_event(p_leave, v_me, 'approved', format('Certificate checked; leave approved (%s session%s marked as approved leave)', n, case when n = 1 then '' else 's' end));
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s approved', r.ref),
      format('Your certificate was checked. Your medical leave for %s is approved.', public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
  else
    if v_note is null then
      raise exception 'Say what is wrong with the certificate so the student can fix it.' using errcode = '22023';
    end if;
    update public.leave_requests
       set status = 'sanctioned', doc_path = null, doc_uploaded_at = null, doc_reminded_at = null,
           doc_deadline = greatest(doc_deadline, now() + interval '48 hours')
     where id = p_leave
     returning * into r;
    perform public.log_event(p_leave, v_me, 'certificate_returned', 'Certificate returned by the programme office: ' || v_note);
    perform public.queue_email(stu.email, stu.full_name, format('Please upload a new certificate for %s', r.ref),
      format(E'The programme office could not accept your certificate.\n\n%s\n\nUpload a new one by %s.', v_note, public.fmt_time(r.doc_deadline)),
      p_leave, 'student_certificate', '/student/leave/' || r.ref, 'Upload certificate');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs: deemed acknowledgment, reminders, auto-cancellation
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
begin
  select * into s from public.settings where id = 1;

  for r in
    update public.faculty_acks a
       set status = 'deemed', responded_at = lr.submitted_at + make_interval(hours => s.ack_hours)
      from public.leave_requests lr
     where a.leave_id = lr.id and a.status = 'pending'
       and lr.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
       and now() >= lr.submitted_at + make_interval(hours => s.ack_hours)
    returning a.leave_id, a.faculty_id
  loop
    perform public.log_event(r.leave_id, null, 'deemed',
      (select full_name from public.people where id = r.faculty_id) || format(': no reply in %s hours, recorded as acknowledged', s.ack_hours));
    v_deemed := v_deemed + 1;
  end loop;

  for r in
    select lr.*, stu.full_name as student_name, stu.student_no
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.escalated_at is null
       and now() >= lr.submitted_at + make_interval(hours => s.escalate_hours)
     for update of lr
  loop
    update public.leave_requests set escalated_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'escalated', format('No decision in %s hours: reminder sent to the approver and the programme office', s.escalate_hours), false);
    for x in
      select email, full_name from public.people where active and (('approver' = any (roles) and approver_level = r.approver_level) or 'office' = any (roles))
    loop
      perform public.queue_email(x.email, x.full_name, format('Reminder: %s is waiting for a decision', r.ref),
        format('%s (%s) applied for %s leave, %s. The request has had no decision for %s hours.',
               r.student_name, r.student_no, lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), s.escalate_hours),
        r.id, 'escalation', '/approve/' || r.ref, 'Open the request');
    end loop;
    v_escalated := v_escalated + 1;
  end loop;

  for r in
    select lr.*, stu.full_name as student_name, stu.email as student_email
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'sanctioned' and lr.type = 'medical' and lr.doc_reminded_at is null
       and now() <= lr.doc_deadline and lr.doc_deadline - now() <= interval '24 hours'
     for update of lr
  loop
    update public.leave_requests set doc_reminded_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'reminder', 'Reminder sent: certificate due within 24 hours');
    perform public.queue_email(r.student_email, r.student_name, format('Reminder: upload your certificate for %s', r.ref),
      format('Your medical certificate is due by %s. If it is not uploaded, the leave will be cancelled automatically.', public.fmt_time(r.doc_deadline)),
      r.id, 'student_reminder', '/student/leave/' || r.ref, 'Upload certificate');
    v_reminded := v_reminded + 1;
  end loop;

  for r in
    select lr.*, stu.full_name as student_name, stu.email as student_email
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'sanctioned' and lr.type = 'medical' and now() > lr.doc_deadline
     for update of lr
  loop
    update public.leave_requests set status = 'cancelled', closed_at = now() where id = r.id;
    perform public.log_event(r.id, null, 'cancelled', 'Cancelled automatically: certificate not uploaded by the deadline');
    perform public.queue_email(r.student_email, r.student_name, format('Leave %s cancelled', r.ref),
      format(E'Your medical certificate was not uploaded by %s, so the leave for %s is cancelled. The absence counts as unapproved.\nContact the programme office if this is wrong.',
             public.fmt_time(r.doc_deadline), public.fmt_range(r.from_date, r.to_date)),
      r.id, 'student_cancelled', '/student/leave/' || r.ref, 'View your leave');
    for x in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(x.email, x.full_name, format('%s cancelled automatically (%s)', r.ref, r.student_name),
        'The certificate deadline passed without an upload. The absence stays unapproved.', r.id, 'office_cancelled', '/office/leave/' || r.ref, 'Open the request');
    end loop;
    v_cancelled := v_cancelled + 1;
  end loop;

  return jsonb_build_object('deemed', v_deemed, 'escalated', v_escalated, 'reminded', v_reminded, 'cancelled', v_cancelled);
end $$;

-- ---------------------------------------------------------------------------
-- Office: roster and timetable import, people management, export
-- ---------------------------------------------------------------------------
create or replace function public.import_people(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  row jsonb;
  i int := 0;
  v_ins int := 0;
  v_upd int := 0;
  v_err jsonb := '[]'::jsonb;
  v_email text;
  v_roles public.user_role[];
  v_level public.approver_level;
  v_existed boolean;
begin
  if not public.has_role('office') then
    raise exception 'Only the programme office can import people.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5000 rows at a time.' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_email := lower(btrim(row ->> 'email'));
      if v_email is null or v_email = '' then raise exception 'Email is missing'; end if;
      select coalesce(array_agg(distinct btrim(lower(x))::public.user_role), '{}')
        into v_roles
        from regexp_split_to_table(coalesce(row ->> 'roles', ''), '[;,|/ ]+') as x
       where btrim(x) <> '';
      if cardinality(v_roles) = 0 then raise exception 'Roles are missing (use student, faculty, approver or office)'; end if;
      v_level := nullif(lower(btrim(coalesce(row ->> 'approver_level', ''))), '')::public.approver_level;
      select exists (select 1 from public.people where email = v_email) into v_existed;

      insert into public.people as p (email, full_name, roles, student_no, programme, batch, section, approver_level, active, user_id)
      values (v_email, btrim(row ->> 'full_name'), v_roles,
              nullif(btrim(coalesce(row ->> 'student_no', '')), ''),
              nullif(btrim(coalesce(row ->> 'programme', '')), ''),
              nullif(btrim(coalesce(row ->> 'batch', '')), ''),
              nullif(btrim(coalesce(row ->> 'section', '')), ''),
              v_level, true,
              (select id from auth.users u where lower(u.email) = v_email limit 1))
      on conflict (email) do update
        set full_name = excluded.full_name, roles = excluded.roles, student_no = excluded.student_no,
            programme = excluded.programme, batch = excluded.batch, section = excluded.section,
            approver_level = excluded.approver_level, active = true,
            user_id = coalesce(p.user_id, excluded.user_id);
      if v_existed then v_upd := v_upd + 1; else v_ins := v_ins + 1; end if;
    exception when others then
      v_err := v_err || jsonb_build_object('row', i, 'email', row ->> 'email', 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_err);
end $$;

create or replace function public.set_person_active(p_person uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('office') then
    raise exception 'Only the programme office can change people.' using errcode = '42501';
  end if;
  if p_person = public.me() and not p_active then
    raise exception 'You cannot deactivate your own account.' using errcode = '22023';
  end if;
  update public.people set active = p_active where id = p_person;
end $$;

create or replace function public.import_sessions(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  row jsonb;
  i int := 0;
  v_ins int := 0;
  v_upd int := 0;
  v_err jsonb := '[]'::jsonb;
  v_fac uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_tz text := public.app_tz();
  v_new boolean;
begin
  if not public.has_role('office') then
    raise exception 'Only the programme office can import the timetable.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 10000 then
    raise exception 'Import at most 10000 rows at a time.' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      select id into v_fac from public.people
       where email = lower(btrim(row ->> 'faculty_email')) and 'faculty' = any (roles) and active;
      if v_fac is null then raise exception 'No active faculty member with email %', row ->> 'faculty_email'; end if;
      if nullif(btrim(coalesce(row ->> 'course_code', '')), '') is null then raise exception 'Course code is missing'; end if;
      if nullif(btrim(coalesce(row ->> 'batch', '')), '') is null or nullif(btrim(coalesce(row ->> 'section', '')), '') is null then
        raise exception 'Batch and section are required';
      end if;
      v_start := (((row ->> 'date')::date) + ((row ->> 'start_time')::time)) at time zone v_tz;
      v_end := case when nullif(btrim(coalesce(row ->> 'end_time', '')), '') is null then null
                    else (((row ->> 'date')::date) + ((row ->> 'end_time')::time)) at time zone v_tz end;
      if v_end is not null and v_end <= v_start then raise exception 'End time is before start time'; end if;

      insert into public.class_sessions as c (course_code, course_name, faculty_id, batch, section, starts_at, ends_at, cancelled)
      values (upper(btrim(row ->> 'course_code')), nullif(btrim(coalesce(row ->> 'course_name', '')), ''), v_fac,
              btrim(row ->> 'batch'), btrim(row ->> 'section'), v_start, v_end,
              coalesce(lower(row ->> 'cancelled') in ('true', 'yes', '1'), false))
      on conflict (batch, section, course_code, starts_at) do update
        set course_name = excluded.course_name, faculty_id = excluded.faculty_id, ends_at = excluded.ends_at, cancelled = excluded.cancelled
      returning (xmax = 0) into v_new;
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_err := v_err || jsonb_build_object('row', i, 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_err);
end $$;

-- Sessions on sanctioned or approved leave, for the attendance system.
create or replace function public.attendance_export(p_from date, p_to date) returns table (
  request_ref text, student_no text, student_name text, batch text, section text,
  course_code text, session_start text, faculty_name text, leave_type text, leave_status text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('office') then
    raise exception 'Only the programme office can export attendance.' using errcode = '42501';
  end if;
  return query
  select r.ref, stu.student_no, stu.full_name, cs.batch, cs.section, cs.course_code,
         to_char(cs.starts_at at time zone public.app_tz(), 'YYYY-MM-DD HH24:MI'),
         fac.full_name, public.type_label(r.type),
         case r.status when 'approved' then 'Approved' when 'documents_in' then 'Provisional (certificate in)' else 'Provisional' end
    from public.leave_requests r
    join public.people stu on stu.id = r.student_id
    join public.leave_sessions ls on ls.leave_id = r.id
    join public.class_sessions cs on cs.id = ls.session_id
    join public.people fac on fac.id = cs.faculty_id
   where r.status in ('sanctioned', 'documents_in', 'approved')
     and public.local_date(cs.starts_at) between p_from and p_to
   order by cs.starts_at, stu.student_no;
end $$;

-- ---------------------------------------------------------------------------
-- Email sending support (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.claim_emails(p_limit int default 25) returns setof public.email_outbox
language sql security definer set search_path = public as $$
  update public.email_outbox o
     set status = 'sending', attempts = attempts + 1
   where o.id in (
     select id from public.email_outbox
      where status = 'queued' or (status = 'sending' and created_at < now() - interval '15 minutes' and attempts < 5)
      order by id
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning o.*
$$;

create or replace function public.mark_email(p_id bigint, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.email_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         link = case when p_ok then null else link end,
         last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.me(), public.has_role(public.user_role), public.my_approver_level(), public.is_staff_viewer(),
  public.can_view_leave(uuid), public.is_leave_owner(uuid), public.app_tz(), public.day_start(date), public.local_date(timestamptz),
  public.route_level(public.leave_type, date, date), public.fmt_day(date), public.fmt_range(date, date),
  public.fmt_time(timestamptz), public.type_label(public.leave_type), public.level_label(public.approver_level),
  public.claim_profile(),
  public.submit_leave(public.leave_type, text, date, date, uuid[], boolean, date, text, text, boolean),
  public.respond_to_leave(uuid, text, text),
  public.faculty_inbox(boolean), public.faculty_absences(date, date),
  public.decide_leave(uuid, boolean, text),
  public.withdraw_leave(uuid), public.attach_certificate(uuid, text),
  public.review_certificate(uuid, boolean, text),
  public.import_people(jsonb), public.set_person_active(uuid, boolean), public.import_sessions(jsonb),
  public.attendance_export(date, date)
to authenticated;

-- The one-time link page works without signing in.
grant execute on function public.token_context(text), public.respond_by_token(text, text, text) to anon, authenticated;
grant execute on function public.app_tz(), public.fmt_day(date), public.fmt_range(date, date), public.fmt_time(timestamptz),
  public.type_label(public.leave_type), public.level_label(public.approver_level) to anon;

grant execute on function public.run_scheduled_jobs(), public.claim_emails(int), public.mark_email(bigint, boolean, text) to service_role;
