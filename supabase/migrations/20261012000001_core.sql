-- Leave Desk: core schema
-- Tables, types, helper functions and row-level security.
-- All writes to workflow tables go through SECURITY DEFINER functions (see 0002_workflow).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('student', 'faculty', 'approver', 'office');
create type public.leave_type as enum ('medical', 'family', 'official');
create type public.leave_status as enum ('submitted', 'sanctioned', 'documents_in', 'approved', 'rejected', 'cancelled', 'withdrawn');
create type public.ack_status as enum ('pending', 'acknowledged', 'noted', 'flagged', 'deemed');
create type public.approver_level as enum ('chair', 'dean');

-- ---------------------------------------------------------------------------
-- Settings (single row). Every time limit in the workflow is read from here.
-- ---------------------------------------------------------------------------
create table public.settings (
  id                 int primary key default 1 check (id = 1),
  programme_name     text not null default 'MBA-HRM',
  timezone           text not null default 'Asia/Kolkata',
  notice_hours       int  not null default 48 check (notice_hours between 0 and 720),
  medical_late_hours int  not null default 24 check (medical_late_hours between 0 and 720),
  medical_ahead_days int  not null default 7  check (medical_ahead_days between 0 and 60),
  ack_hours          int  not null default 48 check (ack_hours between 1 and 720),
  escalate_hours     int  not null default 48 check (escalate_hours between 1 and 720),
  doc_days           int  not null default 2  check (doc_days between 0 and 30),
  chair_max_days     int  not null default 3  check (chair_max_days between 0 and 60),
  max_leave_days     int  not null default 15 check (max_leave_days between 1 and 120),
  allowed_domains    text[] not null default '{}',
  app_url            text,
  email_from         text,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------------
-- People: the roster the programme office imports. Only people on the roster
-- can use the app; a Google sign-in is linked to a roster row by email.
-- ---------------------------------------------------------------------------
create table public.people (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  full_name      text not null check (length(btrim(full_name)) > 0),
  roles          public.user_role[] not null check (cardinality(roles) > 0),
  student_no     text unique,
  programme      text,
  batch          text,
  section        text,
  approver_level public.approver_level,
  user_id        uuid unique references auth.users (id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint people_student_fields check (not ('student' = any (roles)) or (student_no is not null and batch is not null and section is not null)),
  constraint people_approver_fields check (not ('approver' = any (roles)) or approver_level is not null)
);
create index people_roles_idx on public.people using gin (roles);
create index people_batch_idx on public.people (batch, section);

-- ---------------------------------------------------------------------------
-- Timetable
-- ---------------------------------------------------------------------------
create table public.class_sessions (
  id          uuid primary key default gen_random_uuid(),
  course_code text not null check (length(btrim(course_code)) > 0),
  course_name text,
  faculty_id  uuid not null references public.people (id),
  batch       text not null,
  section     text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  cancelled   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (batch, section, course_code, starts_at)
);
create index class_sessions_batch_idx on public.class_sessions (batch, section, starts_at);
create index class_sessions_faculty_idx on public.class_sessions (faculty_id, starts_at);

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
create sequence public.leave_ref_seq start 1001;

create table public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('LV-' || nextval('public.leave_ref_seq')::text),
  student_id       uuid not null references public.people (id),
  type             public.leave_type not null,
  reason           text not null check (length(btrim(reason)) between 3 and 1000),
  from_date        date not null,
  to_date          date not null,
  away_from_campus boolean not null default false,
  return_date      date,
  contact_name     text,
  contact_phone    text,
  status           public.leave_status not null default 'submitted',
  approver_level   public.approver_level not null,
  submitted_at     timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references public.people (id),
  decision_note    text,
  doc_deadline     timestamptz,
  doc_path         text,
  doc_uploaded_at  timestamptz,
  doc_checked_at   timestamptz,
  doc_checked_by   uuid references public.people (id),
  doc_reminded_at  timestamptz,
  escalated_at     timestamptz,
  closed_at        timestamptz,
  consent_at       timestamptz,
  updated_at       timestamptz not null default now(),
  constraint leave_dates check (to_date >= from_date),
  constraint leave_away_fields check (not away_from_campus or (return_date is not null and contact_name is not null and contact_phone is not null))
);
create index leave_requests_student_idx on public.leave_requests (student_id, from_date desc);
create index leave_requests_status_idx on public.leave_requests (status, submitted_at);

create table public.leave_sessions (
  leave_id   uuid not null references public.leave_requests (id) on delete cascade,
  session_id uuid not null references public.class_sessions (id),
  primary key (leave_id, session_id)
);
create index leave_sessions_session_idx on public.leave_sessions (session_id);

create table public.faculty_acks (
  leave_id         uuid not null references public.leave_requests (id) on delete cascade,
  faculty_id       uuid not null references public.people (id),
  status           public.ack_status not null default 'pending',
  note             text check (note is null or length(note) <= 1000),
  responded_at     timestamptz,
  token_hash       text unique,
  token_expires_at timestamptz,
  primary key (leave_id, faculty_id)
);
create index faculty_acks_faculty_idx on public.faculty_acks (faculty_id, status);

-- Concerns raised by faculty go to the approver, not the student.
create table public.ack_concerns (
  id         bigint generated always as identity primary key,
  leave_id   uuid not null references public.leave_requests (id) on delete cascade,
  faculty_id uuid not null references public.people (id),
  concern    text not null check (length(btrim(concern)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index ack_concerns_leave_idx on public.ack_concerns (leave_id);

-- Audit trail: every state change and response.
create table public.leave_events (
  id                 bigint generated always as identity primary key,
  leave_id           uuid not null references public.leave_requests (id) on delete cascade,
  actor_id           uuid references public.people (id),
  kind               text not null,
  message            text not null,
  visible_to_student boolean not null default true,
  created_at         timestamptz not null default now()
);
create index leave_events_leave_idx on public.leave_events (leave_id, created_at);

-- Outgoing email. The send-emails edge function drains this table.
-- `link` holds the one-time path for faculty responses and is cleared once sent.
create table public.email_outbox (
  id         bigint generated always as identity primary key,
  to_email   text not null,
  to_name    text,
  subject    text not null,
  body       text not null,
  link       text,
  link_label text,
  leave_id   uuid references public.leave_requests (id) on delete set null,
  kind       text not null,
  status     text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index email_outbox_status_idx on public.email_outbox (status, id);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.app_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.settings where id = 1), 'Asia/Kolkata')
$$;

create or replace function public.day_start(d date) returns timestamptz
language sql stable set search_path = public as $$
  select (d::timestamp at time zone public.app_tz())
$$;

create or replace function public.local_date(t timestamptz) returns date
language sql stable set search_path = public as $$
  select (t at time zone public.app_tz())::date
$$;

create or replace function public.me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() and active
$$;

create or replace function public.has_role(r public.user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people where user_id = auth.uid() and active and r = any (roles))
$$;

create or replace function public.my_approver_level() returns public.approver_level
language sql stable security definer set search_path = public as $$
  select approver_level from public.people where user_id = auth.uid() and active and 'approver' = any (roles)
$$;

create or replace function public.is_staff_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('office') or public.has_role('approver')
$$;

create or replace function public.can_view_leave(p_leave uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff_viewer()
      or exists (select 1 from public.leave_requests r where r.id = p_leave and r.student_id = public.me())
$$;

create or replace function public.is_leave_owner(p_leave uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leave_requests r where r.id = p_leave and r.student_id = public.me())
$$;

create or replace function public.route_level(p_type public.leave_type, p_from date, p_to date) returns public.approver_level
language sql stable security definer set search_path = public as $$
  select case
    when p_type = 'family' or (p_to - p_from + 1) > (select chair_max_days from public.settings where id = 1) then 'dean'::public.approver_level
    else 'chair'::public.approver_level
  end
$$;

create or replace function public.fmt_day(d date) returns text
language sql immutable as $$ select to_char(d, 'Dy DD Mon') $$;

create or replace function public.fmt_range(a date, b date) returns text
language sql immutable as $$ select case when a = b then public.fmt_day(a) else public.fmt_day(a) || ' – ' || public.fmt_day(b) end $$;

create or replace function public.fmt_time(t timestamptz) returns text
language sql stable set search_path = public as $$ select to_char(t at time zone public.app_tz(), 'Dy DD Mon, HH24:MI') $$;

create or replace function public.type_label(t public.leave_type) returns text
language sql immutable as $$
  select case t when 'medical' then 'Medical' when 'family' then 'Family reasons' else 'University official' end
$$;

create or replace function public.level_label(l public.approver_level) returns text
language sql immutable as $$
  select case l when 'chair' then 'Programme Chair' else 'Dean' end
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

create trigger people_touch before update on public.people for each row execute function public.touch_updated_at();
create trigger leave_touch before update on public.leave_requests for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- Link a Google sign-in to the roster row with the same email.
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    update public.people set user_id = new.id
     where email = lower(new.email) and (user_id is null or user_id = new.id);
  end if;
  return new;
end $$;

create trigger on_auth_user_linked
  after insert or update of email on auth.users
  for each row execute function public.link_auth_user();

-- Called by the app after sign-in, in case the roster row was imported later.
create or replace function public.claim_profile() returns public.people
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  p public.people;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.people set user_id = auth.uid()
   where email = v_email and user_id is null and active;
  select * into p from public.people where user_id = auth.uid() and active;
  return p;
end $$;

-- Writes to the outbox; never called by clients directly.
create or replace function public.queue_email(
  p_to text, p_name text, p_subject text, p_body text, p_leave uuid, p_kind text,
  p_link text default null, p_link_label text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.email_outbox (to_email, to_name, subject, body, leave_id, kind, link, link_label)
  values (p_to, p_name, p_subject, p_body, p_leave, p_kind, p_link, p_link_label)
$$;

create or replace function public.log_event(p_leave uuid, p_actor uuid, p_kind text, p_message text, p_visible boolean default true) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_events (leave_id, actor_id, kind, message, visible_to_student)
  values (p_leave, p_actor, p_kind, p_message, p_visible)
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.settings       enable row level security;
alter table public.people         enable row level security;
alter table public.class_sessions enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_sessions enable row level security;
alter table public.faculty_acks   enable row level security;
alter table public.ack_concerns   enable row level security;
alter table public.leave_events   enable row level security;
alter table public.email_outbox   enable row level security;

-- Clients get only the privileges granted below.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- settings
grant select on public.settings to authenticated;
grant update (programme_name, notice_hours, medical_late_hours, medical_ahead_days, ack_hours, escalate_hours, doc_days,
              chair_max_days, max_leave_days, allowed_domains, app_url, email_from, updated_by)
  on public.settings to authenticated;
create policy settings_read on public.settings for select to authenticated using (public.me() is not null);
create policy settings_office_update on public.settings for update to authenticated
  using (public.has_role('office')) with check (public.has_role('office'));

-- people: own row; staff rows for everyone registered; students visible to office and approvers
grant select on public.people to authenticated;
create policy people_read on public.people for select to authenticated using (
  user_id = auth.uid()
  or public.is_staff_viewer()
  or (public.me() is not null and roles && array['faculty', 'approver', 'office']::public.user_role[])
);

-- class_sessions
grant select on public.class_sessions to authenticated;
create policy sessions_read on public.class_sessions for select to authenticated using (
  public.is_staff_viewer()
  or faculty_id = public.me()
  or exists (select 1 from public.people p where p.user_id = auth.uid() and p.active
             and p.batch = class_sessions.batch and p.section = class_sessions.section)
);

-- leave_requests: student owner, approvers, office. Faculty use the faculty_* functions.
grant select on public.leave_requests to authenticated;
create policy leave_read on public.leave_requests for select to authenticated using (
  student_id = public.me() or public.is_staff_viewer()
);

grant select on public.leave_sessions to authenticated;
create policy leave_sessions_read on public.leave_sessions for select to authenticated using (public.can_view_leave(leave_id));

-- faculty_acks: token columns are never readable by clients
grant select (leave_id, faculty_id, status, note, responded_at) on public.faculty_acks to authenticated;
create policy acks_read on public.faculty_acks for select to authenticated using (
  public.can_view_leave(leave_id) or faculty_id = public.me()
);

grant select on public.ack_concerns to authenticated;
create policy concerns_read on public.ack_concerns for select to authenticated using (
  public.is_staff_viewer() or faculty_id = public.me()
);

grant select on public.leave_events to authenticated;
create policy events_read on public.leave_events for select to authenticated using (
  public.is_staff_viewer()
  or (visible_to_student and public.is_leave_owner(leave_id))
);

grant select (id, to_email, to_name, subject, body, link_label, leave_id, kind, status, attempts, last_error, created_at, sent_at)
  on public.email_outbox to authenticated;
create policy outbox_office_read on public.email_outbox for select to authenticated using (public.has_role('office'));
