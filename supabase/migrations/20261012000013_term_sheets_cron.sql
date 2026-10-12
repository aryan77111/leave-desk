-- Leave Desk: the 10-minute timetable check now runs while any term sheet is active.
-- Replace the project URL below if you deploy to a different Supabase project.
select cron.schedule('leave-desk-sync-timetable', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://ljqozmznjasgfjeshrfq.supabase.co/functions/v1/sync-timetable',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from private.app_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.timetable_sheets where enabled and archived_at is null)
$$);
