-- Leave Desk: grants and performance tuning from the Supabase advisors.

revoke execute on function public.app_tz(), public.fmt_day(date), public.fmt_range(date, date), public.fmt_time(timestamptz),
  public.type_label(public.leave_type), public.level_label(public.approver_level) from anon;

create index if not exists ack_concerns_faculty_idx on public.ack_concerns (faculty_id);
create index if not exists email_outbox_leave_idx on public.email_outbox (leave_id);
create index if not exists leave_events_actor_idx on public.leave_events (actor_id);
create index if not exists leave_requests_decided_by_idx on public.leave_requests (decided_by);
create index if not exists leave_requests_checked_by_idx on public.leave_requests (doc_checked_by);

alter policy people_read on public.people using (
  user_id = (select auth.uid())
  or (select public.is_staff_viewer())
  or ((select public.me()) is not null and roles && array['faculty', 'approver', 'office']::public.user_role[])
);

alter policy sessions_read on public.class_sessions using (
  (select public.is_staff_viewer())
  or faculty_id = (select public.me())
  or exists (select 1 from public.people p where p.user_id = (select auth.uid()) and p.active
             and p.batch = class_sessions.batch and p.section = class_sessions.section)
);
