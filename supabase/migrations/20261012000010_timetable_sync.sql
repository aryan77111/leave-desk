-- Leave Desk: keep the timetable in step with the Dean HRM Office's live Google Sheets.
--
-- The sync-timetable edge function downloads each sheet (every 10 minutes, or on "Sync now"),
-- reads it with the course codes below, and hands the sessions to apply_timetable(), which:
--   * adds new sessions and updates moved/changed ones (upcoming sessions only; the past is frozen),
--   * marks upcoming sheet sessions that disappeared as cancelled (never deletes them),
--   * refuses to cancel a large share of the term in one go unless the office confirms,
--   * tells students on leave, and their faculty, what changed for them.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.class_sessions
  add column source text not null default 'import' check (source in ('import', 'sheet')),
  add column updated_at timestamptz;

create table public.timetable_sources (
  batch           text primary key check (length(btrim(batch)) > 0),
  file_id         text not null check (file_id ~ '^[A-Za-z0-9_-]{20,}$'),
  label           text,
  enabled         boolean not null default true,
  last_checked_at timestamptz,
  last_synced_at  timestamptz,
  last_hash       text,
  last_status     text check (last_status in ('ok', 'error', 'blocked')),
  last_message    text,
  last_report     jsonb,
  created_at      timestamptz not null default now()
);

create table public.course_codes (
  id          uuid primary key default gen_random_uuid(),
  batch       text not null references public.timetable_sources (batch) on update cascade on delete cascade,
  course_code text not null check (course_code ~ '^[A-Z][A-Z0-9]{1,9}$'),
  variant     text not null default '' check (variant ~ '^[A-Z0-9]{0,6}$'),
  course_name text not null check (length(btrim(course_name)) > 0),
  faculty_id  uuid not null references public.people (id),
  sections    text[] not null check (cardinality(sections) > 0),
  elective    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (batch, course_code, variant)
);
create index course_codes_faculty_idx on public.course_codes (faculty_id);

create table public.timetable_changes (
  id          bigint generated always as identity primary key,
  batch       text not null,
  section     text not null,
  course_code text not null,
  starts_at   timestamptz not null,
  kind        text not null check (kind in ('added', 'cancelled', 'restored', 'changed')),
  detail      text,
  created_at  timestamptz not null default now()
);
create index timetable_changes_recent_idx on public.timetable_changes (created_at desc);

alter table public.timetable_sources enable row level security;
alter table public.course_codes      enable row level security;
alter table public.timetable_changes enable row level security;

-- New tables get Supabase's default grants; narrow them to what the app needs.
revoke all on public.timetable_sources, public.course_codes, public.timetable_changes from anon, authenticated;
grant select, insert on public.timetable_sources to authenticated;
-- Office edits through the app may only touch the settings columns, not the sync bookkeeping.
grant update (file_id, label, enabled) on public.timetable_sources to authenticated;
grant select, insert, update on public.course_codes to authenticated;
grant select on public.timetable_changes to authenticated;

create policy sources_office on public.timetable_sources for all to authenticated
  using ((select public.has_role('office'))) with check ((select public.has_role('office')));
create policy course_codes_office on public.course_codes for all to authenticated
  using ((select public.has_role('office'))) with check ((select public.has_role('office')));
create policy changes_office_read on public.timetable_changes for select to authenticated
  using ((select public.has_role('office')));

-- Only the sync service (service role) or a database administrator may apply a timetable.
create or replace function public.is_sync_service() returns boolean
language sql stable set search_path = public as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    else session_user in ('postgres', 'supabase_admin')
  end
$$;

-- ---------------------------------------------------------------------------
-- apply_timetable(batch, rows, protected, force) is the entry point; the steps below share
-- per-connection scratch tables that are emptied at commit.
-- p_rows:      [{date, start, end, code, name, faculty_id, section, elective}]
-- p_protected: [{date, start}] slots holding a cell that could not be read; sessions there are left alone.
-- The sync service records the outcome on timetable_sources itself.
-- ---------------------------------------------------------------------------
create or replace function public.timetable_scratch() returns void
language plpgsql security definer set search_path = public as $$
begin
  create temp table if not exists _tt_in (section text, code text, name text, faculty_id uuid, starts_at timestamptz, ends_at timestamptz, elective boolean) on commit delete rows;
  create temp table if not exists _tt_slots (starts_at timestamptz) on commit delete rows;
  create temp table if not exists _tt_cancel (id uuid) on commit delete rows;
  create temp table if not exists _tt_diff (section text, code text, name text, faculty_id uuid, starts_at timestamptz, ends_at timestamptz, elective boolean,
    existing_id uuid, was_cancelled boolean, old_faculty uuid, old_ends timestamptz, old_name text, old_source text) on commit delete rows;
  create temp table if not exists _tt_touched (id uuid primary key, kind text, old_faculty uuid) on commit delete rows;
  create temp table if not exists _tt_removed (leave_id uuid, session_id uuid, course_code text, starts_at timestamptz) on commit delete rows;
  create temp table if not exists _tt_attach (leave_id uuid, session_id uuid, faculty_id uuid, course_code text, starts_at timestamptz) on commit delete rows;
  create temp table if not exists _tt_unlisted (leave_id uuid, course_code text, starts_at timestamptz) on commit delete rows;
end $$;

-- Incoming upcoming sessions, protected slots, and the sheet sessions that disappeared.
create or replace function public.timetable_stage(p_batch text, p_rows jsonb, p_protected jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.app_tz();
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  perform public.timetable_scratch();

  insert into _tt_in
  select distinct on (x.section, upper(btrim(x.code)), (x.date + x.start) at time zone v_tz)
         btrim(x.section), upper(btrim(x.code)), nullif(btrim(coalesce(x.name, '')), ''),
         x.faculty_id, (x.date + x.start) at time zone v_tz,
         case when x."end" is null then null else (x.date + x."end") at time zone v_tz end,
         coalesce(x.elective, false)
    from jsonb_to_recordset(p_rows) as x(date date, start time, "end" time, code text, name text, faculty_id uuid, section text, elective boolean)
   where x.date is not null and x.start is not null and (x.date + x.start) at time zone v_tz >= now()
   order by x.section, upper(btrim(x.code)), (x.date + x.start) at time zone v_tz;

  if exists (select 1 from _tt_in i where i.faculty_id is null or not exists (select 1 from public.people p where p.id = i.faculty_id)) then
    raise exception 'A session refers to a faculty member who is not on the roster.' using errcode = '22023';
  end if;

  insert into _tt_slots
  select distinct (x.date + x.start) at time zone v_tz
    from jsonb_to_recordset(coalesce(p_protected, '[]'::jsonb)) as x(date date, start time)
   where x.date is not null and x.start is not null;

  insert into _tt_cancel
  select c.id from public.class_sessions c
   where c.batch = p_batch and c.source = 'sheet' and not c.cancelled and c.starts_at >= now()
     and not exists (select 1 from _tt_in i where i.section = c.section and i.code = c.course_code and i.starts_at = c.starts_at)
     and not exists (select 1 from _tt_slots t where t.starts_at = c.starts_at);
end $$;

-- Add new sessions; update moved, restored or reassigned ones.
create or replace function public.timetable_write_sessions(p_batch text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;

  insert into _tt_diff
  select i.*, c.id, c.cancelled, c.faculty_id, c.ends_at, c.course_name, c.source
    from _tt_in i
    left join public.class_sessions c
      on c.batch = p_batch and c.section = i.section and c.course_code = i.code and c.starts_at = i.starts_at;

  with ins as (
    insert into public.class_sessions (course_code, course_name, faculty_id, batch, section, starts_at, ends_at, source, updated_at)
    select d.code, d.name, d.faculty_id, p_batch, d.section, d.starts_at, d.ends_at, 'sheet', now()
      from _tt_diff d where d.existing_id is null
    returning id
  )
  insert into _tt_touched (id, kind) select id, 'added' from ins;

  insert into _tt_touched (id, kind, old_faculty)
  select d.existing_id,
         case when d.was_cancelled then 'restored'
              when d.old_faculty is distinct from d.faculty_id or d.old_ends is distinct from d.ends_at then 'changed'
              else 'quiet' end,
         case when not d.was_cancelled and d.old_faculty is distinct from d.faculty_id then d.old_faculty end
    from _tt_diff d
   where d.existing_id is not null
     and (d.was_cancelled or d.old_faculty is distinct from d.faculty_id or d.old_ends is distinct from d.ends_at
          or d.old_name is distinct from d.name or d.old_source <> 'sheet');

  update public.class_sessions c
     set course_name = d.name, faculty_id = d.faculty_id, ends_at = d.ends_at, cancelled = false, source = 'sheet', updated_at = now()
    from _tt_diff d
   where c.id = d.existing_id and exists (select 1 from _tt_touched t where t.id = c.id);
end $$;

-- Sessions no longer in the sheet are marked cancelled, never deleted.
create or replace function public.timetable_mark_removed() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  update public.class_sessions c set cancelled = true, updated_at = now()
   where c.id in (select id from _tt_cancel);
end $$;

-- Change log for the office.
create or replace function public.timetable_log_changes() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  insert into public.timetable_changes (batch, section, course_code, starts_at, kind, detail)
  select c.batch, c.section, c.course_code, c.starts_at, t.kind,
         case when t.kind = 'changed' and t.old_faculty is not null
              then 'Faculty: ' || coalesce((select full_name from public.people where id = t.old_faculty), '?') || ' to ' || p.full_name
              when t.kind = 'changed' then 'Time: now ' || public.fmt_time(c.starts_at) || coalesce(' to ' || to_char(c.ends_at at time zone public.app_tz(), 'HH24:MI'), '')
              else p.full_name end
    from _tt_touched t
    join public.class_sessions c on c.id = t.id
    join public.people p on p.id = c.faculty_id
   where t.kind <> 'quiet'
  union all
  select c.batch, c.section, c.course_code, c.starts_at, 'cancelled', null
    from _tt_cancel x join public.class_sessions c on c.id = x.id;
end $$;

-- Effect on open leave requests: sessions removed from a leave, sessions added to it
-- (core courses, and electives the student already listed), and new electives only mentioned.
create or replace function public.timetable_leave_effects() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_leaves int := 0;
  l        record;
  v_body   text;
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;

  insert into _tt_removed
  select ls.leave_id, c.id as session_id, c.course_code, c.starts_at
    from _tt_cancel x
    join public.class_sessions c on c.id = x.id
    join public.leave_sessions ls on ls.session_id = c.id
    join public.leave_requests r on r.id = ls.leave_id
   where r.status in ('submitted', 'sanctioned', 'documents_in', 'approved');

  -- New or restored sessions that fall inside an open leave of a student in that section.
  -- Core courses, and electives the student already listed on this leave, are added automatically.

  insert into _tt_attach
  select r.id, c.id, c.faculty_id, c.course_code, c.starts_at
    from _tt_touched t
    join public.class_sessions c on c.id = t.id
    join _tt_in i on i.section = c.section and i.code = c.course_code and i.starts_at = c.starts_at
    join public.people st on st.batch = c.batch and st.section = c.section and 'student' = any (st.roles)
    join public.leave_requests r on r.student_id = st.id
   where t.kind in ('added', 'restored')
     and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
     and public.local_date(c.starts_at) between r.from_date and r.to_date
     and (not i.elective or exists (
            select 1 from public.leave_sessions ls2 join public.class_sessions c2 on c2.id = ls2.session_id
             where ls2.leave_id = r.id and c2.course_code = c.course_code))
     and not exists (select 1 from public.leave_sessions ls where ls.leave_id = r.id and ls.session_id = c.id);

  insert into _tt_unlisted
  select r.id, c.course_code, c.starts_at
    from _tt_touched t
    join public.class_sessions c on c.id = t.id
    join _tt_in i on i.section = c.section and i.code = c.course_code and i.starts_at = c.starts_at
    join public.people st on st.batch = c.batch and st.section = c.section and 'student' = any (st.roles)
    join public.leave_requests r on r.student_id = st.id
   where t.kind in ('added', 'restored')
     and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
     and public.local_date(c.starts_at) between r.from_date and r.to_date
     and i.elective
     and not exists (select 1 from _tt_attach a where a.leave_id = r.id and a.session_id = c.id)
     and not exists (select 1 from public.leave_sessions ls where ls.leave_id = r.id and ls.session_id = c.id);

  insert into public.leave_sessions (leave_id, session_id)
  select leave_id, session_id from _tt_attach on conflict do nothing;

  -- A session on a leave whose faculty changed: the new faculty needs to know too.
  insert into _tt_attach
  select ls.leave_id, c.id, c.faculty_id, c.course_code, c.starts_at
    from _tt_touched t
    join public.class_sessions c on c.id = t.id
    join public.leave_sessions ls on ls.session_id = c.id
    join public.leave_requests r on r.id = ls.leave_id
   where t.kind = 'changed' and t.old_faculty is not null
     and r.status in ('submitted', 'sanctioned', 'documents_in', 'approved')
     and not exists (select 1 from _tt_attach a where a.leave_id = ls.leave_id and a.session_id = c.id);

  -- One timeline entry and one email per affected leave.
  for l in
    select r.id, r.ref, r.type, r.from_date, r.to_date, st.full_name, st.email,
           (select string_agg(x.course_code || ' · ' || public.fmt_time(x.starts_at), E'\n' order by x.starts_at) from _tt_removed x where x.leave_id = r.id) as removed,
           (select string_agg(x.course_code || ' · ' || public.fmt_time(x.starts_at), E'\n' order by x.starts_at) from _tt_attach x where x.leave_id = r.id) as added,
           (select string_agg(x.course_code || ' · ' || public.fmt_time(x.starts_at), E'\n' order by x.starts_at) from _tt_unlisted x where x.leave_id = r.id) as unlisted
      from public.leave_requests r
      join public.people st on st.id = r.student_id
     where r.id in (select leave_id from _tt_removed union select leave_id from _tt_attach union select leave_id from _tt_unlisted)
  loop
    v_leaves := v_leaves + 1;
    v_body := concat_ws(E'\n\n',
      case when l.removed is not null then E'Removed from the timetable (no longer counted as missed):\n' || l.removed end,
      case when l.added is not null then E'Added to your leave (your faculty have been told):\n' || l.added end,
      case when l.unlisted is not null then E'New elective classes during your leave, not added:\n' || l.unlisted
        || E'\nIf you take one of these, tell the Dean HRM Office so it can be added.' end);
    perform public.log_event(l.id, null, 'timetable_changed', 'Timetable changed during this leave. ' || replace(v_body, E'\n', ' '));
    perform public.queue_email(l.email, l.full_name,
      format('Timetable change during your leave %s', l.ref),
      format(E'The class schedule changed on dates covered by your leave (%s).\n\n%s', public.fmt_range(l.from_date, l.to_date), v_body),
      l.id, 'student_timetable_change', '/student/leave/' || l.ref, 'View your leave');
  end loop;

  perform public.timetable_faculty_notices();
  return v_leaves;
end $$;

-- Faculty who now have sessions on a leave: a full notice with a response link if they are new
-- to the leave, otherwise a short update.
create or replace function public.timetable_faculty_notices() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s       public.settings%rowtype;
  f       record;
  v_token text;
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;

  for f in
    select a.leave_id, a.faculty_id, p.full_name, p.email, r.type, r.reason, r.from_date, r.to_date, r.ref,
           st.full_name as student_name, st.student_no,
           string_agg(a.course_code || ' · ' || public.fmt_time(a.starts_at), E'\n' order by a.starts_at) as lines,
           count(*) as n,
           exists (select 1 from public.faculty_acks k where k.leave_id = a.leave_id and k.faculty_id = a.faculty_id) as has_ack
      from _tt_attach a
      join public.people p on p.id = a.faculty_id
      join public.leave_requests r on r.id = a.leave_id
      join public.people st on st.id = r.student_id
     group by a.leave_id, a.faculty_id, p.full_name, p.email, r.type, r.reason, r.from_date, r.to_date, r.ref, st.full_name, st.student_no
  loop
    if f.has_ack then
      perform public.queue_email(f.email, f.full_name,
        format('Timetable change: %s (%s) on leave', f.student_name, f.student_no),
        format(E'After a timetable change, %s will also miss:\n\n%s\n\nThis is part of the leave you were already notified about (%s). No action is needed.',
               f.student_name, f.lines, public.fmt_range(f.from_date, f.to_date)),
        f.leave_id, 'faculty_timetable_change');
    else
      v_token := encode(gen_random_bytes(24), 'hex');
      insert into public.faculty_acks (leave_id, faculty_id, token_hash, token_expires_at)
      values (f.leave_id, f.faculty_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
      perform public.queue_email(
        f.email, f.full_name,
        format('Leave notice: %s (%s), %s', f.student_name, f.student_no, public.fmt_range(f.from_date, f.to_date)),
        format(E'%s leave%s. After a timetable change, %s of your sessions fall in this leave:\n\n%s\n\n%s\n\nNo reply within %s hours is recorded as acknowledged. Make-up of any evaluation stays at your discretion.',
               public.type_label(f.type),
               case when f.type = 'medical' then ', for information' else '' end,
               f.n, f.lines,
               case when f.type = 'medical' then 'The reason and certificate are visible to the approver only.' else 'Reason: ' || btrim(f.reason) end,
               s.ack_hours),
        f.leave_id, 'faculty_notice', '/r/' || v_token, 'Respond to this notice');
    end if;
  end loop;
end $$;

create or replace function public.timetable_counts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_added    int;
  v_restored int;
  v_changed  int;
begin
  select count(*) filter (where kind = 'added'), count(*) filter (where kind = 'restored'), count(*) filter (where kind = 'changed')
    into v_added, v_restored, v_changed from _tt_touched;
  return jsonb_build_object('added', v_added, 'restored', v_restored, 'changed', v_changed, 'upcoming', (select count(*) from _tt_in));
end $$;

create or replace function public.apply_timetable(
  p_batch     text,
  p_rows      jsonb,
  p_protected jsonb default '[]'::jsonb,
  p_force     boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_future int;
  v_cancel int;
  v_leaves int;
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Expected a list of sessions.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.timetable_sources where batch = p_batch) then
    raise exception 'No timetable sheet is set up for batch %.', p_batch using errcode = '22023';
  end if;
  -- One sync per batch at a time (the 10-minute run and "Sync now" can overlap).
  perform pg_advisory_xact_lock(hashtext('apply_timetable:' || p_batch));

  perform public.timetable_stage(p_batch, p_rows, p_protected);

  -- Safety stop: a broken or half-edited sheet should not wipe out the term.
  select count(*) into v_cancel from _tt_cancel;
  select count(*) into v_future from public.class_sessions
   where batch = p_batch and source = 'sheet' and not cancelled and starts_at >= now();
  if not p_force and v_cancel > greatest(20, ceil(v_future * 0.3)) then
    return jsonb_build_object('status', 'blocked', 'would_cancel', v_cancel, 'upcoming', v_future);
  end if;

  perform public.timetable_write_sessions(p_batch);
  perform public.timetable_mark_removed();
  perform public.timetable_log_changes();
  v_leaves := public.timetable_leave_effects();

  return public.timetable_counts() || jsonb_build_object('status', 'ok', 'cancelled', v_cancel, 'leaves_affected', v_leaves);
end $$;

-- Bookkeeping for a check that could not run (download or parse failure, or an unchanged sheet).
create or replace function public.note_timetable_check(p_batch text, p_status text, p_message text, p_report jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can record checks' using errcode = '42501';
  end if;
  update public.timetable_sources
     set last_checked_at = now(),
         last_status = coalesce(p_status, last_status),
         last_message = coalesce(p_message, last_message),
         last_report = coalesce(p_report, last_report)
   where batch = p_batch;
end $$;
