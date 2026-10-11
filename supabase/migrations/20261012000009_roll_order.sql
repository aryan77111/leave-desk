-- Leave Desk: list students in roll-number order in the faculty "students away" view.
create or replace function public.faculty_absences(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_code', cs.course_code, 'starts_at', cs.starts_at, 'batch', cs.batch, 'section', cs.section,
           'student_name', stu.full_name, 'student_no', stu.student_no, 'ref', r.ref, 'status', r.status)
         order by cs.starts_at, stu.student_no, stu.full_name), '[]'::jsonb)
    from public.class_sessions cs
    join public.leave_sessions ls on ls.session_id = cs.id
    join public.leave_requests r on r.id = ls.leave_id
    join public.people stu on stu.id = r.student_id
   where public.has_role('faculty')
     and cs.faculty_id = public.me()
     and public.local_date(cs.starts_at) between p_from and p_to
     and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
$$;
