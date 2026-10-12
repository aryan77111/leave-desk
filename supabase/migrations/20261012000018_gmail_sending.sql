-- Leave Desk: send email through a Google (Gmail) account of the college.
--
-- The Dean HRM Office clicks "Connect Gmail" in Rules and settings and signs in with the account
-- emails should come from (for the pilot, deanhrm_office@xim.edu.in). Because XIM's email already
-- runs on Google, mail sent this way comes from the real college address and needs no DNS changes.
--
-- The long-lived Google token is kept in the private schema, which no client can read. Only the
-- edge functions (service role) can store or read it. When Gmail is connected, send-emails uses it;
-- otherwise it falls back to Resend.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_secrets (
  name  text primary key,
  value text not null
);

-- One-time "state" values that tie a Google sign-in back to the office user who started it.
create table if not exists private.oauth_states (
  state      text primary key,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- Shown in Settings and System health. Not secret.
alter table public.settings
  add column gmail_sender       text,
  add column gmail_connected_at timestamptz,
  add column gmail_connected_by uuid references public.people (id);

-- Office: start connecting. Returns the state to pass to the gmail-connect function.
create or replace function public.gmail_connect_start() returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_state text := encode(gen_random_bytes(24), 'hex');
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can connect the email account.' using errcode = '42501';
  end if;
  insert into private.oauth_states (state, created_by) values (v_state, public.me());
  return v_state;
end $$;

-- Edge function: store the token after Google sign-in. The state must be fresh and unused.
create or replace function public.gmail_store_connection(p_state text, p_refresh_token text, p_email text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  st private.oauth_states%rowtype;
begin
  if not public.is_sync_service() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into st from private.oauth_states where state = p_state for update;
  if not found or st.used_at is not null or st.created_at < now() - interval '30 minutes' then
    return false;
  end if;
  if nullif(btrim(coalesce(p_refresh_token, '')), '') is null or position('@' in coalesce(p_email, '')) < 2 then
    return false;
  end if;
  update private.oauth_states set used_at = now() where state = p_state;
  insert into private.app_secrets (name, value) values ('gmail_refresh_token', p_refresh_token)
  on conflict (name) do update set value = excluded.value;
  update public.settings
     set gmail_sender = lower(btrim(p_email)), gmail_connected_at = now(), gmail_connected_by = st.created_by
   where id = 1;
  return true;
end $$;

-- Edge function: read the token and sender to send mail.
create or replace function public.gmail_credentials() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when public.is_sync_service() then
    jsonb_build_object(
      'refresh_token', (select value from private.app_secrets where name = 'gmail_refresh_token'),
      'sender', (select gmail_sender from public.settings where id = 1))
  end
$$;

-- Office: stop sending through Gmail (falls back to Resend).
create or replace function public.gmail_disconnect() returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can disconnect the email account.' using errcode = '42501';
  end if;
  update private.app_secrets set value = '' where name = 'gmail_refresh_token';
  update public.settings set gmail_sender = null, gmail_connected_at = null, gmail_connected_by = null where id = 1;
end $$;

revoke execute on function public.gmail_connect_start(), public.gmail_store_connection(text, text, text),
  public.gmail_credentials(), public.gmail_disconnect() from public, anon, authenticated;
grant execute on function public.gmail_connect_start(), public.gmail_disconnect() to authenticated;
grant execute on function public.gmail_store_connection(text, text, text), public.gmail_credentials() to service_role;
