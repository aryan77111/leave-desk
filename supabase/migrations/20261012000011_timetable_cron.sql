-- Leave Desk: check the live timetable sheets every 10 minutes.
-- The edge function skips a sheet whose contents have not changed since the last sync.
-- Replace the project URL below if you deploy to a different Supabase project.
select cron.schedule('leave-desk-sync-timetable', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://ljqozmznjasgfjeshrfq.supabase.co/functions/v1/sync-timetable',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from private.app_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.timetable_sources where enabled)
$$);
