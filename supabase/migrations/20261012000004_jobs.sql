-- Leave Desk: scheduled jobs and email dispatch.
-- run_scheduled_jobs() every 10 minutes; the send-emails edge function every minute while mail is queued.
-- Replace the project URL below if you deploy to a different Supabase project.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (
  name  text primary key,
  value text not null
);
insert into private.app_secrets (name, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- The edge function calls this (as service role) to check the caller.
create or replace function public.cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.app_secrets where name = 'cron_secret' and value = p_secret)
$$;
revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- First Dean HRM Office account. Run once from the SQL editor:
--   select public.bootstrap_office('you@college.edu', 'Your Name');
create or replace function public.bootstrap_office(p_email text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.people as p (email, full_name, roles, user_id)
  values (lower(btrim(p_email)), btrim(p_name), array['office']::public.user_role[],
          (select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1))
  on conflict (email) do update
    set roles = (select array_agg(distinct x) from unnest(p.roles || array['office']::public.user_role[]) x),
        active = true
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.bootstrap_office(text, text) from public, anon, authenticated;

-- Pin search_path on the pure helpers too.
alter function public.fmt_day(date) set search_path = public;
alter function public.fmt_range(date, date) set search_path = public;
alter function public.type_label(public.leave_type) set search_path = public;
alter function public.level_label(public.approver_level) set search_path = public;

select cron.schedule('leave-desk-jobs', '*/10 * * * *', $$ select public.run_scheduled_jobs() $$);

select cron.schedule('leave-desk-send-emails', '* * * * *', $$
  select net.http_post(
    url     := 'https://ljqozmznjasgfjeshrfq.supabase.co/functions/v1/send-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from private.app_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000)
  where exists (select 1 from public.email_outbox where status = 'queued')
$$);
