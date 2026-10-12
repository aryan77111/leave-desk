-- Leave Desk: pilot features, part 2 of 4 — access helpers, policies and updated routines.
--
-- * A colleague the Dean names while away ("delegate") can see and decide what the Dean can.
-- * Dean emails (new requests, concerns, withdrawals, reminders) also reach an active delegate.
-- * Faculty response windows run from each faculty member's own notice (notified_at).
-- * Expired one-time links show nothing about the request.
-- * Scheduled jobs record cancellation reasons, alert the office about application errors,
--   and note when they last ran.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_active_delegate() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.approval_delegations d join public.people p on p.id = d.delegate_id
     where p.user_id = auth.uid() and p.active and d.ended_at is null
       and public.local_date(now()) between d.starts_on and d.ends_on)
$$;

create or replace function public.can_decide() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('approver') or public.is_active_delegate()
$$;

create or replace function public.is_staff_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('office') or public.has_role('approver') or public.is_active_delegate()
$$;

-- The signed-in person's current or next delegation, if any.
create or replace function public.my_delegation() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', d.id, 'starts_on', d.starts_on, 'ends_on', d.ends_on,
                            'active', public.local_date(now()) >= d.starts_on)
    from public.approval_delegations d join public.people p on p.id = d.delegate_id
   where p.user_id = auth.uid() and p.active and d.ended_at is null and d.ends_on >= public.local_date(now())
   order by d.starts_on
   limit 1
$$;

-- Everyone who should get the Dean's emails today: the Dean and any active delegate.
create or replace function public.decider_recipients() returns table (email text, full_name text)
language sql stable security definer set search_path = public as $$
  select email, full_name from public.people where active and 'approver' = any (roles)
  union
  select p.email, p.full_name
    from public.approval_delegations d join public.people p on p.id = d.delegate_id
   where p.active and d.ended_at is null and public.local_date(now()) between d.starts_on and d.ends_on
$$;

-- ---------------------------------------------------------------------------
-- Policies for the new tables
-- ---------------------------------------------------------------------------
create policy delegations_read on public.approval_delegations for select to authenticated using (
  (select public.has_role('approver')) or (select public.has_role('office')) or delegate_id = (select public.me())
);
create policy feedback_read on public.feedback for select to authenticated using (
  (select public.has_role('office')) or person_id = (select public.me())
);
create policy survey_read on public.survey_responses for select to authenticated using (
  (select public.has_role('office')) or person_id = (select public.me())
);
create policy app_errors_read on public.app_errors for select to authenticated using ((select public.has_role('office')));
create policy job_runs_read on public.job_runs for select to authenticated using ((select public.has_role('office')));

-- ---------------------------------------------------------------------------
-- Faculty views: the response window runs from each notice
-- ---------------------------------------------------------------------------
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
      'respond_by', a.notified_at + make_interval(hours => (select ack_hours from public.settings where id = 1)),
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

-- What the one-time link page shows. An expired link shows nothing about the request,
-- and a closed request shows only that it is closed.
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
  if a.token_expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  select * into r from public.leave_requests where id = a.leave_id;
  select * into s from public.settings where id = 1;
  if r.status in ('withdrawn', 'rejected', 'cancelled') then
    return jsonb_build_object('state', 'closed', 'ref', r.ref, 'leave_status', r.status, 'programme_name', s.programme_name);
  end if;
  select * into stu from public.people where id = r.student_id;
  select * into fac from public.people where id = a.faculty_id;

  v_state := case when a.status <> 'pending' then 'answered' else 'open' end;

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
    'respond_by', a.notified_at + make_interval(hours => s.ack_hours),
    'link_expires_at', a.token_expires_at,
    'programme_name', s.programme_name,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('course_code', cs.course_code, 'course_name', cs.course_name, 'starts_at', cs.starts_at) order by cs.starts_at)
        from public.leave_sessions ls join public.class_sessions cs on cs.id = ls.session_id
       where ls.leave_id = r.id and cs.faculty_id = a.faculty_id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Faculty responses: concerns also reach an active delegate
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
    perform public.log_event(p_leave, p_faculty, 'flagged', fac.full_name || ' raised a concern with the Dean');
    for a in select * from public.decider_recipients() loop
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

-- ---------------------------------------------------------------------------
-- Student withdraws: tell pending faculty, the Dean and any delegate
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
    select d.email, d.full_name from public.decider_recipients() d
  loop
    perform public.queue_email(x.email, x.full_name, format('Leave %s withdrawn', r.ref),
      format('%s (%s) withdrew the request for %s. No action is needed.', stu.full_name, stu.student_no, public.fmt_range(r.from_date, r.to_date)),
      p_leave, 'withdrawn');
  end loop;
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

  -- Requests waiting too long for a decision: remind the Dean, any delegate and the office, once.
  for r in
    select lr.*, stu.full_name as student_name, stu.student_no
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'submitted' and lr.escalated_at is null
       and now() >= lr.submitted_at + make_interval(hours => s.escalate_hours)
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

  -- Certificate due within 24 hours: one reminder.
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

  -- Certificate deadline passed: cancel.
  for r in
    select lr.*, stu.full_name as student_name, stu.email as student_email
      from public.leave_requests lr join public.people stu on stu.id = lr.student_id
     where lr.status = 'sanctioned' and lr.type = 'medical' and now() > lr.doc_deadline
     for update of lr
  loop
    update public.leave_requests
       set status = 'cancelled', closed_at = now(), cancel_reason = 'The medical certificate was not uploaded by the deadline.'
     where id = r.id;
    perform public.log_event(r.id, null, 'cancelled', 'Cancelled automatically: certificate not uploaded by the deadline');
    perform public.queue_email(r.student_email, r.student_name, format('Leave %s cancelled', r.ref),
      format(E'Your medical certificate was not uploaded by %s, so the leave for %s is cancelled. The absence counts as unapproved.\nContact the Dean HRM Office if this is wrong.',
             public.fmt_time(r.doc_deadline), public.fmt_range(r.from_date, r.to_date)),
      r.id, 'student_cancelled', '/student/leave/' || r.ref, 'View your leave');
    for x in select email, full_name from public.people where active and 'office' = any (roles) loop
      perform public.queue_email(x.email, x.full_name, format('%s cancelled automatically (%s)', r.ref, r.student_name),
        'The certificate deadline passed without an upload. The absence stays unapproved.', r.id, 'office_cancelled', '/office/leave/' || r.ref, 'Open the request');
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
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.is_active_delegate(), public.can_decide(), public.my_delegation(), public.decider_recipients(),
  public.track_first_certificate(), public.set_link_expiry() from public, anon;
revoke execute on function public.decider_recipients(), public.track_first_certificate(), public.set_link_expiry() from authenticated;
grant execute on function public.is_active_delegate(), public.can_decide(), public.my_delegation() to authenticated;
