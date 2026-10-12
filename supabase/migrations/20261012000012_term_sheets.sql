-- Leave Desk: one timetable sheet per batch per term.
--
-- Each term's class-schedule sheet is its own entry with its own course codes (courses do not carry
-- over between terms). A class belongs to the sheet that created it, and a sheet only ever adds,
-- updates or cancels its own classes, so next term's sheet can be connected while the current term
-- is still running. When a term is over its sheet is archived and its classes are never touched again.
--
-- Replaces the one-sheet-per-batch tables from 0010 (timetable_sources, course_codes), which are
-- no longer read and kept only so nothing is lost.

create table public.timetable_sheets (
  id              uuid primary key default gen_random_uuid(),
  batch           text not null check (length(btrim(batch)) > 0),
  term            text not null check (length(btrim(term)) between 1 and 40),
  file_id         text not null check (file_id ~ '^[A-Za-z0-9_-]{20,}$'),
  enabled         boolean not null default true,
  archived_at     timestamptz,
  last_checked_at timestamptz,
  last_synced_at  timestamptz,
  last_hash       text,
  last_status     text check (last_status in ('ok', 'error', 'blocked')),
  last_message    text,
  last_report     jsonb,
  created_at      timestamptz not null default now(),
  unique (batch, term)
);

create table public.sheet_course_codes (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references public.timetable_sheets (id) on delete cascade,
  course_code text not null check (course_code ~ '^[A-Z][A-Z0-9]{1,9}$'),
  variant     text not null default '' check (variant ~ '^[A-Z0-9]{0,6}$'),
  course_name text not null check (length(btrim(course_name)) > 0),
  faculty_id  uuid not null references public.people (id),
  sections    text[] not null check (cardinality(sections) > 0),
  elective    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (sheet_id, course_code, variant)
);
create index sheet_course_codes_faculty_idx on public.sheet_course_codes (faculty_id);

alter table public.class_sessions add column sheet_id uuid references public.timetable_sheets (id);
create index class_sessions_sheet_idx on public.class_sessions (sheet_id, starts_at);

alter table public.timetable_sheets   enable row level security;
alter table public.sheet_course_codes enable row level security;

-- New tables get Supabase's default grants; narrow them to what the app needs.
revoke all on public.timetable_sheets, public.sheet_course_codes from anon, authenticated;
grant select, insert on public.timetable_sheets to authenticated;
grant update (term, file_id, enabled, archived_at) on public.timetable_sheets to authenticated;
grant select, insert, update, delete on public.sheet_course_codes to authenticated;

create policy sheets_office on public.timetable_sheets for all to authenticated
  using ((select public.has_role('office'))) with check ((select public.has_role('office')));
create policy sheet_codes_office on public.sheet_course_codes for all to authenticated
  using ((select public.has_role('office'))) with check ((select public.has_role('office')));

-- Move the current sheets, their codes and their classes over.
insert into public.timetable_sheets (batch, term, file_id, enabled, last_checked_at, last_synced_at, last_hash, last_status, last_message, last_report)
select batch, coalesce(nullif(btrim(last_report ->> 'sheet_name'), ''), nullif(btrim(label), ''), 'Current term'),
       file_id, enabled, last_checked_at, last_synced_at, last_hash, last_status, last_message, last_report
  from public.timetable_sources;

insert into public.sheet_course_codes (sheet_id, course_code, variant, course_name, faculty_id, sections, elective)
select s.id, c.course_code, c.variant, c.course_name, c.faculty_id, c.sections, c.elective
  from public.course_codes c join public.timetable_sheets s on s.batch = c.batch;

update public.class_sessions c set sheet_id = s.id
  from public.timetable_sheets s
 where c.source = 'sheet' and c.batch = s.batch and c.sheet_id is null;

-- From here on the sync reads timetable_sheets only; timetable_sources and course_codes are retired.

-- ---------------------------------------------------------------------------
-- Sync steps for one term sheet. They reuse the scratch tables and the change-log and leave
-- steps from 0010; only staging and writing differ, because a sheet owns its own classes.
-- ---------------------------------------------------------------------------
create or replace function public.timetable_sheet_stage(p_sheet uuid, p_rows jsonb, p_protected jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tz    text := public.app_tz();
  v_batch text;
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;
  select batch into v_batch from public.timetable_sheets where id = p_sheet and archived_at is null;
  if v_batch is null then
    raise exception 'This sheet is archived or no longer exists.' using errcode = '22023';
  end if;
  perform public.timetable_scratch();
  create temp table if not exists _tt_owned (section text, code text, name text, faculty_id uuid, starts_at timestamptz, ends_at timestamptz, elective boolean,
    existing_id uuid, was_cancelled boolean, old_faculty uuid, old_ends timestamptz, old_name text, old_sheet uuid, claimable boolean) on commit delete rows;

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

  -- Only this sheet's own upcoming classes can be cancelled by it.
  insert into _tt_cancel
  select c.id from public.class_sessions c
   where c.sheet_id = p_sheet and not c.cancelled and c.starts_at >= now()
     and not exists (select 1 from _tt_in i where i.section = c.section and i.code = c.course_code and i.starts_at = c.starts_at)
     and not exists (select 1 from _tt_slots t where t.starts_at = c.starts_at);

  return v_batch;
end $$;

create or replace function public.timetable_sheet_write(p_sheet uuid, p_batch text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sync_service() then
    raise exception 'permission denied: only the timetable sync can do this' using errcode = '42501';
  end if;

  -- A class already owned by another active sheet stays with that sheet.
  insert into _tt_owned
  select i.*, c.id, c.cancelled, c.faculty_id, c.ends_at, c.course_name, c.sheet_id,
         c.id is null or c.sheet_id is null or c.sheet_id = p_sheet or c.cancelled
           or not exists (select 1 from public.timetable_sheets o where o.id = c.sheet_id and o.enabled and o.archived_at is null)
    from _tt_in i
    left join public.class_sessions c
      on c.batch = p_batch and c.section = i.section and c.course_code = i.code and c.starts_at = i.starts_at;

  with ins as (
    insert into public.class_sessions (course_code, course_name, faculty_id, batch, section, starts_at, ends_at, source, sheet_id, updated_at)
    select d.code, d.name, d.faculty_id, p_batch, d.section, d.starts_at, d.ends_at, 'sheet', p_sheet, now()
      from _tt_owned d where d.existing_id is null
    returning id
  )
  insert into _tt_touched (id, kind) select id, 'added' from ins;

  insert into _tt_touched (id, kind, old_faculty)
  select d.existing_id,
         case when d.was_cancelled then 'restored'
              when d.old_faculty is distinct from d.faculty_id or d.old_ends is distinct from d.ends_at then 'changed'
              else 'quiet' end,
         case when not d.was_cancelled and d.old_faculty is distinct from d.faculty_id then d.old_faculty end
    from _tt_owned d
   where d.existing_id is not null and d.claimable
     and (d.was_cancelled or d.old_faculty is distinct from d.faculty_id or d.old_ends is distinct from d.ends_at
          or d.old_name is distinct from d.name or d.old_sheet is distinct from p_sheet);

  update public.class_sessions c
     set course_name = d.name, faculty_id = d.faculty_id, ends_at = d.ends_at, cancelled = false,
         source = 'sheet', sheet_id = p_sheet, updated_at = now()
    from _tt_owned d
   where c.id = d.existing_id and exists (select 1 from _tt_touched t where t.id = c.id);
end $$;

create or replace function public.apply_timetable_sheet(
  p_sheet     uuid,
  p_rows      jsonb,
  p_protected jsonb default '[]'::jsonb,
  p_force     boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch  text;
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
  -- One sync per sheet at a time (the 10-minute run and "Sync now" can overlap).
  perform pg_advisory_xact_lock(hashtext('apply_timetable_sheet:' || p_sheet::text));

  v_batch := public.timetable_sheet_stage(p_sheet, p_rows, p_protected);

  -- Safety stop: a broken or half-edited sheet should not wipe out the term.
  select count(*) into v_cancel from _tt_cancel;
  select count(*) into v_future from public.class_sessions
   where sheet_id = p_sheet and not cancelled and starts_at >= now();
  if not p_force and v_cancel > greatest(20, ceil(v_future * 0.3)) then
    return jsonb_build_object('status', 'blocked', 'would_cancel', v_cancel, 'upcoming', v_future);
  end if;

  perform public.timetable_sheet_write(p_sheet, v_batch);
  perform public.timetable_mark_removed();
  perform public.timetable_log_changes();
  v_leaves := public.timetable_leave_effects();

  return public.timetable_counts() || jsonb_build_object('status', 'ok', 'cancelled', v_cancel, 'leaves_affected', v_leaves);
end $$;
