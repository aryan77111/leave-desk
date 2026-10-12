-- Leave Desk: pilot features, part 1 of 4 — schema.
-- New settings, timestamps the pilot metrics need, Dean delegation, feedback and survey,
-- an error log for monitoring, and a record of scheduled-job runs.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.settings
  add column link_days            int     not null default 7  check (link_days between 1 and 30),
  add column survey_open          boolean not null default false,
  add column help_contact_name    text    check (help_contact_name is null or length(help_contact_name) <= 120),
  add column help_contact_email   text    check (help_contact_email is null or length(help_contact_email) <= 200),
  add column help_contact_phone   text    check (help_contact_phone is null or length(help_contact_phone) <= 40),
  add column target_decision_pct  int     not null default 90 check (target_decision_pct between 0 and 100),
  add column target_ack_pct       int     not null default 80 check (target_ack_pct between 0 and 100),
  add column target_cert_pct      int     not null default 90 check (target_cert_pct between 0 and 100),
  add column target_satisfaction  numeric(2,1) not null default 4.0 check (target_satisfaction between 1 and 5);

grant update (link_days, survey_open, help_contact_name, help_contact_email, help_contact_phone,
              target_decision_pct, target_ack_pct, target_cert_pct, target_satisfaction)
  on public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- Leave requests: who filed it, edits, delegate decisions, cancellation reason, certificate timing
-- ---------------------------------------------------------------------------
alter table public.leave_requests
  add column filed_by              uuid references public.people (id),
  add column office_note           text check (office_note is null or length(office_note) <= 1000),
  add column edited_at             timestamptz,
  add column decided_by_delegate   boolean not null default false,
  add column cancel_reason         text check (cancel_reason is null or length(cancel_reason) <= 1000),
  add column doc_first_uploaded_at timestamptz,
  add column doc_first_on_time     boolean;
create index if not exists leave_requests_filed_by_idx on public.leave_requests (filed_by);
create index if not exists leave_requests_submitted_idx on public.leave_requests (submitted_at);

-- The first certificate upload is what the pilot measures, even if the office later returns it.
create or replace function public.track_first_certificate() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.doc_uploaded_at is not null and new.doc_first_uploaded_at is null then
    new.doc_first_uploaded_at := new.doc_uploaded_at;
    new.doc_first_on_time := new.doc_deadline is null or new.doc_uploaded_at <= new.doc_deadline;
  end if;
  return new;
end $$;
create or replace trigger leave_first_certificate before update of doc_uploaded_at on public.leave_requests
  for each row execute function public.track_first_certificate();

-- ---------------------------------------------------------------------------
-- Faculty acknowledgments: the response window runs from when each faculty member was told,
-- so a notice sent later (after an edit or a timetable change) gets its own full window.
-- ---------------------------------------------------------------------------
alter table public.faculty_acks add column notified_at timestamptz not null default now();
update public.faculty_acks a set notified_at = r.submitted_at from public.leave_requests r where r.id = a.leave_id;
grant select (notified_at) on public.faculty_acks to authenticated;

-- Every one-time link expires after the configured number of days, whoever creates it.
create or replace function public.set_link_expiry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.token_hash is distinct from old.token_hash then
    new.token_expires_at := now() + make_interval(days => coalesce((select link_days from public.settings where id = 1), 7));
  end if;
  return new;
end $$;
create or replace trigger faculty_acks_link_expiry before insert or update of token_hash on public.faculty_acks
  for each row execute function public.set_link_expiry();

-- ---------------------------------------------------------------------------
-- Dean delegation: while the Dean is away, a named colleague decides requests.
-- ---------------------------------------------------------------------------
create table public.approval_delegations (
  id          uuid primary key default gen_random_uuid(),
  delegate_id uuid not null references public.people (id),
  starts_on   date not null,
  ends_on     date not null,
  reason      text check (reason is null or length(reason) <= 300),
  created_by  uuid references public.people (id),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  ended_by    uuid references public.people (id),
  constraint delegation_dates check (ends_on >= starts_on and ends_on - starts_on <= 90)
);
create index approval_delegations_delegate_idx on public.approval_delegations (delegate_id, starts_on, ends_on);
create index approval_delegations_created_by_idx on public.approval_delegations (created_by);
create index approval_delegations_ended_by_idx on public.approval_delegations (ended_by);

-- ---------------------------------------------------------------------------
-- Feedback ("report a problem / suggestion") and the end-of-pilot survey
-- ---------------------------------------------------------------------------
create table public.feedback (
  id          bigint generated always as identity primary key,
  person_id   uuid references public.people (id),
  kind        text not null check (kind in ('problem', 'suggestion')),
  message     text not null check (length(btrim(message)) between 3 and 2000),
  page        text check (page is null or length(page) <= 300),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  office_note text check (office_note is null or length(office_note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index feedback_person_idx on public.feedback (person_id);
create index feedback_status_idx on public.feedback (status, created_at desc);

create table public.survey_responses (
  person_id    uuid primary key references public.people (id),
  role         text not null check (role in ('student', 'faculty', 'approver', 'office')),
  satisfaction int  not null check (satisfaction between 1 and 5),
  ease         int  not null check (ease between 1 and 5),
  faster       boolean,
  comment      text check (comment is null or length(comment) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Monitoring: application errors and scheduled-job runs
-- ---------------------------------------------------------------------------
create table public.app_errors (
  id         bigint generated always as identity primary key,
  source     text not null check (source in ('server', 'client', 'edge')),
  message    text not null,
  path       text,
  digest     text,
  user_id    uuid,
  created_at timestamptz not null default now(),
  alerted_at timestamptz
);
create index app_errors_recent_idx on public.app_errors (created_at desc);

create table public.job_runs (
  name        text primary key,
  last_run_at timestamptz not null,
  last_result jsonb
);

-- ---------------------------------------------------------------------------
-- Row-level security and grants. New tables get Supabase's default grants; narrow them.
-- ---------------------------------------------------------------------------
alter table public.approval_delegations enable row level security;
alter table public.feedback             enable row level security;
alter table public.survey_responses     enable row level security;
alter table public.app_errors           enable row level security;
alter table public.job_runs             enable row level security;

revoke all on public.approval_delegations, public.feedback, public.survey_responses, public.app_errors, public.job_runs
  from anon, authenticated;
grant select on public.approval_delegations, public.feedback, public.survey_responses, public.app_errors, public.job_runs
  to authenticated;
