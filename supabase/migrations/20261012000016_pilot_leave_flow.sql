-- Leave Desk: pilot features, part 3 of 4 — leave workflow.
--
-- * Students can change a request (dates, sessions, reason, travel details) until it is decided.
-- * The Dean HRM Office can file a request for a student (including after the dates),
--   correct the dates and sessions of an open or approved request, and cancel a mistaken one,
--   always with a reason on record.
-- * A delegate can decide while the Dean is away; the record says "on behalf of the Dean".
-- * The Dean can approve several requests at once.

-- ---------------------------------------------------------------------------
-- Checks shared by applying, changing, filing and correcting.
--   p_timing        apply the notice and medical timing rules (students only)
--   p_max_days      longest leave allowed
--   p_student_voice word errors for the student ("You already have…") or for the office
--   p_existing      a request being changed: it is ignored for overlaps, and its current
--                   sessions may stay on it even if the timetable has since cancelled them
-- ---------------------------------------------------------------------------
create or replace function public._check_leave(
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
  p_timing        boolean,
  p_max_days      int,
  p_student_voice boolean,
  p_existing      uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s     public.settings%rowtype;
  st    public.people%rowtype;
  v_bad int;
begin
  select * into s from public.settings where id = 1;
  select * into st from public.people where id = p_student;

  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day of leave.' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The last day is before the first day.' using errcode = '22023';
  end if;
  if p_to - p_from + 1 > p_max_days then
    if p_student_voice then
      raise exception 'Leave longer than % days is handled by the Dean HRM Office directly.', p_max_days using errcode = '22023';
    else
      raise exception 'Leave can cover at most % days.', p_max_days using errcode = '22023';
    end if;
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Add a short reason.' using errcode = '22023';
  end if;
  if length(p_reason) > 1000 then
    raise exception 'Keep the reason under 1000 characters.' using errcode = '22023';
  end if;

  if p_timing then
    if p_type = 'medical' then
      if now() > public.day_start(p_from + 1) + make_interval(hours => s.medical_late_hours) then
        raise exception 'Medical leave must be applied within % hours of the first day of absence. Contact the Dean HRM Office.', s.medical_late_hours using errcode = '22023';
      end if;
      if p_from > public.local_date(now()) + s.medical_ahead_days then
        raise exception 'Medical leave can be applied at most % days ahead.', s.medical_ahead_days using errcode = '22023';
      end if;
    elsif public.day_start(p_from) - now() < make_interval(hours => s.notice_hours) then
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
     where r.student_id = p_student
       and r.id is distinct from p_existing
       and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
       and daterange(r.from_date, r.to_date, '[]') && daterange(p_from, p_to, '[]')
  ) then
    if p_student_voice then
      raise exception 'You already have leave covering some of these dates.' using errcode = '23P01';
    else
      raise exception 'This student already has leave covering some of these dates.' using errcode = '23P01';
    end if;
  end if;

  select count(*) into v_bad
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as sid
   where not exists (
     select 1 from public.class_sessions cs
      where cs.id = sid and cs.batch = st.batch and cs.section = st.section
        and public.local_date(cs.starts_at) between p_from and p_to
        and (not cs.cancelled
             or exists (select 1 from public.leave_sessions ls where ls.leave_id = p_existing and ls.session_id = cs.id)));
  if v_bad > 0 then
    if p_student_voice then
      raise exception 'Some selected sessions are not in your timetable for these dates.' using errcode = '22023';
    else
      raise exception 'Some selected sessions are not in this student''s timetable for these dates.' using errcode = '22023';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- One notice to one faculty member about one request, with a fresh one-time link.
-- Re-sending resets their response, so a changed request gets a fresh answer and window.
-- ---------------------------------------------------------------------------
create or replace function public._faculty_notice(p_leave uuid, p_faculty uuid, p_intro text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s       public.settings%rowtype;
  r       public.leave_requests%rowtype;
  st      public.people%rowtype;
  fac     public.people%rowtype;
  v_lines text;
  v_n     int;
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  select * into s from public.settings where id = 1;
  select * into r from public.leave_requests where id = p_leave;
  select * into st from public.people where id = r.student_id;
  select * into fac from public.people where id = p_faculty;
  select string_agg(cs.course_code || ' · ' || public.fmt_time(cs.starts_at), E'\n' order by cs.starts_at), count(*)
    into v_lines, v_n
    from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
   where ls.leave_id = p_leave and cs.faculty_id = p_faculty;

  insert into public.faculty_acks (leave_id, faculty_id, token_hash, notified_at)
  values (p_leave, p_faculty, encode(digest(v_token, 'sha256'), 'hex'), now())
  on conflict (leave_id, faculty_id) do update
    set status = 'pending', note = null, responded_at = null,
        token_hash = excluded.token_hash, notified_at = excluded.notified_at;

  perform public.queue_email(
    fac.email, fac.full_name,
    format('%s: %s (%s), %s', case when p_intro is null then 'Leave notice' else 'Updated leave notice' end,
           st.full_name, st.student_no, public.fmt_range(r.from_date, r.to_date)),
    format(E'%s%s leave%s. %s of your sessions will be missed:\n\n%s\n\n%s\n\nNo reply within %s hours is recorded as acknowledged. Make-up of any evaluation stays at your discretion.',
           coalesce(p_intro || E'\n\n', ''),
           public.type_label(r.type),
           case when r.type = 'medical' then ', for information' else '' end,
           v_n, v_lines,
           case when r.type = 'medical' then 'The reason and certificate are visible to the Dean only.' else 'Reason: ' || r.reason end,
           s.ack_hours),
    p_leave, 'faculty_notice', '/r/' || v_token, 'Respond to this notice');
end $$;

-- After a request's sessions change: notify faculty who are new or whose sessions changed,
-- and tell faculty who no longer have sessions on it. p_old is the session list before the change.
create or replace function public._sync_leave_faculty(p_leave uuid, p_old uuid[], p_intro text) returns int
language plpgsql security definer set search_path = public as $$
declare
  r    public.leave_requests%rowtype;
  st   public.people%rowtype;
  f    record;
  v_n  int := 0;
begin
  select * into r from public.leave_requests where id = p_leave;
  select * into st from public.people where id = r.student_id;

  for f in
    select cs.faculty_id,
           array_agg(cs.id order by cs.id) as now_ids,
           exists (select 1 from public.faculty_acks a where a.leave_id = p_leave and a.faculty_id = cs.faculty_id) as has_ack
      from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
     where ls.leave_id = p_leave
     group by cs.faculty_id
  loop
    if not f.has_ack or f.now_ids is distinct from array(
         select c.id from public.class_sessions c
          where c.id = any (coalesce(p_old, '{}'::uuid[])) and c.faculty_id = f.faculty_id order by c.id) then
      perform public._faculty_notice(p_leave, f.faculty_id, p_intro);
      v_n := v_n + 1;
    end if;
  end loop;

  for f in
    select a.faculty_id, p.full_name, p.email
      from public.faculty_acks a join public.people p on p.id = a.faculty_id
     where a.leave_id = p_leave
       and not exists (select 1 from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
                        where ls.leave_id = p_leave and cs.faculty_id = a.faculty_id)
  loop
    delete from public.faculty_acks where leave_id = p_leave and faculty_id = f.faculty_id;
    perform public.log_event(p_leave, null, 'faculty_removed', f.full_name || ' no longer has sessions on this leave');
    perform public.queue_email(f.email, f.full_name,
      format('Leave %s no longer affects your sessions', r.ref),
      format('%s (%s) is now on leave %s. None of your sessions fall in it any more, so no response is needed.',
             st.full_name, st.student_no, public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'faculty_released');
  end loop;
  return v_n;
end $$;

-- Replace the sessions on a request with a new list (used when a request is changed or corrected).
create or replace function public._replace_leave_sessions(p_leave uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.leave_sessions where leave_id = p_leave and session_id <> all (coalesce(p_ids, '{}'::uuid[]));
  insert into public.leave_sessions (leave_id, session_id)
  select p_leave, x from unnest(coalesce(p_ids, '{}'::uuid[])) x
  on conflict (leave_id, session_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Create a request (after checks). Used by students applying and by the office filing for them.
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
  v_intro text;
  f       record;
  a       record;
begin
  select * into s from public.settings where id = 1;
  select * into st from public.people where id = p_student;

  insert into public.leave_requests (student_id, type, reason, from_date, to_date, away_from_campus, return_date,
                                     contact_name, contact_phone, approver_level, consent_at, filed_by, office_note)
  values (st.id, p_type, btrim(p_reason), p_from, p_to, coalesce(p_away, false),
          case when p_away then p_return end,
          case when p_away then btrim(p_contact_name) end,
          case when p_away then btrim(p_contact_phone) end,
          v_level,
          case when p_type = 'medical' then now() end,
          p_filed_by,
          case when v_by_office then btrim(p_office_note) end)
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

  for a in select * from public.decider_recipients() loop
    perform public.queue_email(a.email, a.full_name,
      format('New leave request %s: %s', v_ref, st.full_name),
      format(E'%s (%s) %s %s leave, %s.\nOpen your approval queue to decide.',
             st.full_name, st.student_no,
             case when v_by_office then 'has a request filed by the Dean HRM Office for' else 'applied for' end,
             lower(public.type_label(p_type)), public.fmt_range(p_from, p_to)),
      v_id, 'approver_new', '/approve', 'Open approval queue');
  end loop;

  perform public.queue_email(st.email, st.full_name,
    case when v_by_office then format('Leave request %s filed for you', v_ref) else format('We received your leave request %s', v_ref) end,
    format(E'%s%s leave, %s.\nYour faculty have been notified. The %s will decide.%s',
           case when v_by_office then E'The Dean HRM Office filed this leave request for you.\n' else '' end,
           public.type_label(p_type), public.fmt_range(p_from, p_to), public.level_label(v_level),
           case when p_type = 'medical' then E'\nIf it is sanctioned, upload your medical certificate within ' || s.doc_days || ' days of resuming classes.' else '' end),
    v_id, 'student_receipt', '/student/leave/' || v_ref, 'View your leave');

  return v_ref;
end $$;

-- ---------------------------------------------------------------------------
-- Student: apply (same signature and rules as before)
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
language plpgsql security definer set search_path = public as $$
declare
  st public.people%rowtype;
  s  public.settings%rowtype;
begin
  select * into st from public.people where user_id = auth.uid() and active and 'student' = any (roles);
  if not found then
    raise exception 'Only registered students can apply for leave.' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;
  perform public._check_leave(st.id, p_type, p_reason, p_from, p_to, p_session_ids, p_away, p_return, p_contact_name, p_contact_phone,
                              true, s.max_leave_days, true, null);
  if p_type = 'medical' and not coalesce(p_consent, false) then
    raise exception 'Confirm the consent for storing your medical certificate.' using errcode = '22023';
  end if;
  return public._create_leave(st.id, p_type, p_reason, p_from, p_to, p_session_ids, p_away, p_return, p_contact_name, p_contact_phone, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Student: change a request that is still waiting for a decision
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

  update public.leave_requests
     set reason = btrim(p_reason), from_date = p_from, to_date = p_to,
         away_from_campus = coalesce(p_away, false),
         return_date = case when p_away then p_return end,
         contact_name = case when p_away then btrim(p_contact_name) end,
         contact_phone = case when p_away then btrim(p_contact_phone) end,
         edited_at = now()
   where id = r.id;
  perform public._replace_leave_sessions(r.id, v_new);

  perform public.log_event(r.id, st.id, 'edited', 'Changed by the student: ' || array_to_string(v_parts, '; '));
  perform public._sync_leave_faculty(r.id, v_old, format('%s changed this leave request.', st.full_name));

  for a in select * from public.decider_recipients() loop
    perform public.queue_email(a.email, a.full_name,
      format('Leave request %s changed: %s', r.ref, st.full_name),
      format(E'%s (%s) changed the request before a decision: %s.\nIt is now %s leave, %s.',
             st.full_name, st.student_no, array_to_string(v_parts, '; '), lower(public.type_label(r.type)), public.fmt_range(p_from, p_to)),
      r.id, 'approver_changed', '/approve/' || r.ref, 'Open the request');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Dean HRM Office: file a request for a student. Timing rules do not apply, so the office can
-- record leave for a student in hospital or after a family emergency, after the dates.
-- ---------------------------------------------------------------------------
create or replace function public.office_file_leave(
  p_student       uuid,
  p_type          public.leave_type,
  p_reason        text,
  p_from          date,
  p_to            date,
  p_session_ids   uuid[] default '{}',
  p_away          boolean default false,
  p_return        date default null,
  p_contact_name  text default null,
  p_contact_phone text default null,
  p_office_note   text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  st public.people%rowtype;
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can file leave for a student.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_office_note, ''))) < 3 then
    raise exception 'Say why the office is filing this request, for example "Student in hospital, called on Monday".' using errcode = '22023';
  end if;
  if length(p_office_note) > 1000 then
    raise exception 'Keep the office note under 1000 characters.' using errcode = '22023';
  end if;
  select * into st from public.people where id = p_student and active and 'student' = any (roles);
  if not found then
    raise exception 'Choose an active student.' using errcode = '22023';
  end if;
  perform public._check_leave(st.id, p_type, p_reason, p_from, p_to, p_session_ids, p_away, p_return, p_contact_name, p_contact_phone,
                              false, 120, false, null);
  return public._create_leave(st.id, p_type, p_reason, p_from, p_to, p_session_ids, p_away, p_return, p_contact_name, p_contact_phone,
                              public.me(), p_office_note);
end $$;

-- ---------------------------------------------------------------------------
-- Dean HRM Office: correct the dates and sessions of an open or approved request.
-- ---------------------------------------------------------------------------
create or replace function public.office_amend_leave(p_leave uuid, p_from date, p_to date, p_session_ids uuid[], p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r       public.leave_requests%rowtype;
  st      public.people%rowtype;
  s       public.settings%rowtype;
  v_me    uuid := public.me();
  v_old   uuid[];
  v_new   uuid[];
  v_parts text[] := '{}';
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can correct a request.' using errcode = '42501';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'Say why the request is being corrected.' using errcode = '22023';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters.' using errcode = '22023';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.status not in ('submitted', 'sanctioned', 'documents_in', 'approved') then
    raise exception 'This request is closed. File a new one instead.' using errcode = '22023';
  end if;
  select * into st from public.people where id = r.student_id;
  select * into s from public.settings where id = 1;

  perform public._check_leave(st.id, r.type, r.reason, p_from, p_to, p_session_ids, false, null, null, null,
                              false, 120, false, r.id);
  if r.away_from_campus and r.return_date is not null and r.return_date <= p_to then
    raise exception 'The student''s return date (%) is not after the new last day.', public.fmt_day(r.return_date) using errcode = '22023';
  end if;

  v_old := array(select session_id from public.leave_sessions where leave_id = r.id order by session_id);
  v_new := array(select distinct x from unnest(coalesce(p_session_ids, '{}'::uuid[])) x order by x);
  if p_from <> r.from_date or p_to <> r.to_date then
    v_parts := v_parts || format('dates %s → %s', public.fmt_range(r.from_date, r.to_date), public.fmt_range(p_from, p_to));
  end if;
  if v_old is distinct from v_new then
    v_parts := v_parts || format('sessions %s → %s', cardinality(v_old), cardinality(v_new));
  end if;
  if cardinality(v_parts) = 0 then
    raise exception 'Nothing has changed.' using errcode = '22023';
  end if;

  update public.leave_requests
     set from_date = p_from, to_date = p_to, edited_at = now(),
         doc_deadline = case when status = 'sanctioned' and doc_deadline is not null
                             then greatest(doc_deadline, public.day_start(p_to + s.doc_days + 1) - interval '1 minute')
                             else doc_deadline end
   where id = r.id;
  perform public._replace_leave_sessions(r.id, v_new);

  perform public.log_event(r.id, v_me, 'corrected',
    format('Corrected by the Dean HRM Office: %s. Reason: %s', array_to_string(v_parts, '; '), v_note));
  perform public._sync_leave_faculty(r.id, v_old, 'The Dean HRM Office corrected this leave.');
  perform public.queue_email(st.email, st.full_name,
    format('Leave %s corrected by the Dean HRM Office', r.ref),
    format(E'The Dean HRM Office corrected your leave: %s.\nReason: %s\n\nIt is now %s leave, %s.',
           array_to_string(v_parts, '; '), v_note, lower(public.type_label(r.type)), public.fmt_range(p_from, p_to)),
    r.id, 'student_corrected', '/student/leave/' || r.ref, 'View your leave');
end $$;

-- ---------------------------------------------------------------------------
-- Dean HRM Office: cancel a request filed by mistake (any status that is still in force).
-- ---------------------------------------------------------------------------
create or replace function public.office_cancel_leave(p_leave uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  st     public.people%rowtype;
  v_me   uuid := public.me();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  x      record;
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can cancel a request.' using errcode = '42501';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'Say why the request is being cancelled.' using errcode = '22023';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters.' using errcode = '22023';
  end if;
  select * into r from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Leave request not found.' using errcode = 'P0002'; end if;
  if r.status in ('withdrawn', 'rejected', 'cancelled') then
    raise exception 'This request is already closed.' using errcode = '22023';
  end if;
  select * into st from public.people where id = r.student_id;

  update public.leave_requests set status = 'cancelled', closed_at = now(), cancel_reason = v_note where id = r.id;
  perform public.log_event(r.id, v_me, 'cancelled', 'Cancelled by the Dean HRM Office: ' || v_note);
  perform public.queue_email(st.email, st.full_name, format('Leave %s cancelled by the Dean HRM Office', r.ref),
    format(E'Your %s leave for %s has been cancelled by the Dean HRM Office.\nReason: %s',
           lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), v_note),
    r.id, 'student_cancelled', '/student/leave/' || r.ref, 'View your leave');
  for x in
    select p.email, p.full_name from public.faculty_acks a join public.people p on p.id = a.faculty_id
     where a.leave_id = r.id and a.status = 'pending'
    union
    select d.email, d.full_name from public.decider_recipients() d where r.status = 'submitted'
  loop
    perform public.queue_email(x.email, x.full_name, format('Leave %s cancelled', r.ref),
      format('The Dean HRM Office cancelled the leave of %s (%s) for %s. No action is needed.',
             st.full_name, st.student_no, public.fmt_range(r.from_date, r.to_date)),
      r.id, 'cancelled_notice');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Decide: the Dean, or a delegate while the Dean is away
-- ---------------------------------------------------------------------------
create or replace function public.decide_leave(p_leave uuid, p_approve boolean, p_note text default null) returns public.leave_status
language plpgsql security definer set search_path = public as $$
declare
  r      public.leave_requests%rowtype;
  s      public.settings%rowtype;
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
  if not p_approve and v_note is null then
    raise exception 'Add a note explaining the rejection.' using errcode = '22023';
  end if;

  select * into s from public.settings where id = 1;
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
  elsif r.type = 'medical' then
    update public.leave_requests
       set status = 'sanctioned', decided_at = now(), decided_by = v_me, decided_by_delegate = v_del, decision_note = v_note,
           doc_deadline = greatest(public.day_start(r.to_date + s.doc_days + 1) - interval '1 minute', now() + interval '24 hours')
     where id = p_leave
     returning * into r;
    perform public.log_event(p_leave, v_me, 'sanctioned', 'Sanctioned (provisional) by ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s sanctioned: upload your certificate', r.ref),
      format(E'Your medical leave for %s is sanctioned provisionally.\nUpload your medical certificate by %s, or the leave will be cancelled automatically.%s%s',
             public.fmt_range(r.from_date, r.to_date), public.fmt_time(r.doc_deadline), coalesce(E'\n\nNote: ' || v_note, ''), v_sign),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'Upload certificate');
    return 'sanctioned';
  else
    update public.leave_requests
       set status = 'approved', decided_at = now(), decided_by = v_me, decided_by_delegate = v_del, decision_note = v_note, closed_at = now()
     where id = p_leave;
    perform public.log_event(p_leave, v_me, 'approved', 'Approved by ' || v_who);
    perform public.queue_email(stu.email, stu.full_name, format('Leave %s approved', r.ref),
      format(E'Your %s leave for %s is approved.%s%s', lower(public.type_label(r.type)), public.fmt_range(r.from_date, r.to_date), coalesce(E'\n\nNote: ' || v_note, ''), v_sign),
      p_leave, 'student_decision', '/student/leave/' || r.ref, 'View your leave');
    return 'approved';
  end if;
end $$;

-- Approve several requests at once. Requests with a faculty concern are skipped, so the Dean
-- reads each of those before deciding. Rejection is always one at a time, with a reason.
create or replace function public.decide_leaves_bulk(p_ids uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_ref     text;
  v_status  public.leave_status;
  v_ok      int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not public.can_decide() then
    raise exception 'Only the Dean can decide leave, or a colleague the Dean has named while away.' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Select at least one request.' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 100 then
    raise exception 'Approve at most 100 requests at a time.' using errcode = '22023';
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select ref into v_ref from public.leave_requests where id = v_id;
    if v_ref is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not found');
    elsif exists (select 1 from public.ack_concerns c where c.leave_id = v_id) then
      v_skipped := v_skipped || jsonb_build_object('ref', v_ref, 'reason', 'a faculty member raised a concern; open it to decide');
    else
      begin
        v_status := public.decide_leave(v_id, true, p_note);
        v_ok := v_ok + 1;
      exception when others then
        v_skipped := v_skipped || jsonb_build_object('ref', v_ref, 'reason', sqlerrm);
      end;
    end if;
  end loop;
  return jsonb_build_object('decided', v_ok, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._check_leave(uuid, public.leave_type, text, date, date, uuid[], boolean, date, text, text, boolean, int, boolean, uuid),
  public._faculty_notice(uuid, uuid, text),
  public._sync_leave_faculty(uuid, uuid[], text),
  public._replace_leave_sessions(uuid, uuid[]),
  public._create_leave(uuid, public.leave_type, text, date, date, uuid[], boolean, date, text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function
  public.edit_leave(uuid, text, date, date, uuid[], boolean, date, text, text),
  public.office_file_leave(uuid, public.leave_type, text, date, date, uuid[], boolean, date, text, text, text),
  public.office_amend_leave(uuid, date, date, uuid[], text),
  public.office_cancel_leave(uuid, text),
  public.decide_leaves_bulk(uuid[], text)
  from public, anon;
grant execute on function
  public.edit_leave(uuid, text, date, date, uuid[], boolean, date, text, text),
  public.office_file_leave(uuid, public.leave_type, text, date, date, uuid[], boolean, date, text, text, text),
  public.office_amend_leave(uuid, date, date, uuid[], text),
  public.office_cancel_leave(uuid, text),
  public.decide_leaves_bulk(uuid[], text)
  to authenticated;
