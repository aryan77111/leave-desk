-- Leave Desk: send the morning summaries at 08:00 college time (02:30 UTC) every day.
-- The send-emails job picks them up within a minute.
select cron.schedule('leave-desk-digest', '30 2 * * *', $$ select public.compose_digests() $$);
