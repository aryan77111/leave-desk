-- Leave Desk: manual edits to people and graduating a whole batch.

-- Edit one person. Roles are given as text ("faculty;dean"). Changing the email unlinks the old
-- Google sign-in so the person signs in again with the new address.
create or replace function public.update_person(
  p_person     uuid,
  p_full_name  text,
  p_email      text,
  p_roles      text,
  p_student_no text default null,
  p_programme  text default null,
  p_batch      text default null,
  p_section    text default null,
  p_active     boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur public.people%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_roles public.user_role[];
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can edit people.' using errcode = '42501';
  end if;
  select * into cur from public.people where id = p_person for update;
  if not found then raise exception 'Person not found.' using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Add the name.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if exists (select 1 from public.people where email = v_email and id <> p_person) then
    raise exception 'Someone else on the roster already uses this email.' using errcode = '22023';
  end if;

  begin
    select coalesce(array_agg(distinct (case when lower(btrim(x)) = 'dean' then 'approver' else lower(btrim(x)) end)::public.user_role), '{}')
      into v_roles
      from regexp_split_to_table(coalesce(p_roles, ''), '[;,|/ ]+') as x
     where btrim(x) <> '';
  exception when others then
    raise exception 'Roles must be student, faculty, dean or office.' using errcode = '22023';
  end;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  if 'student' = any (v_roles) and (nullif(btrim(coalesce(p_student_no, '')), '') is null
                                    or nullif(btrim(coalesce(p_batch, '')), '') is null
                                    or nullif(btrim(coalesce(p_section, '')), '') is null) then
    raise exception 'Students need a student ID, batch and section.' using errcode = '22023';
  end if;
  if exists (select 1 from public.people where student_no = nullif(btrim(coalesce(p_student_no, '')), '') and id <> p_person) then
    raise exception 'Another student already has this student ID.' using errcode = '22023';
  end if;
  if p_person = public.me() and (not coalesce(p_active, true) or not ('office' = any (v_roles))) then
    raise exception 'You cannot remove your own Dean HRM Office access.' using errcode = '22023';
  end if;

  update public.people
     set full_name      = btrim(p_full_name),
         email          = v_email,
         roles          = v_roles,
         student_no     = nullif(btrim(coalesce(p_student_no, '')), ''),
         programme      = nullif(btrim(coalesce(p_programme, '')), ''),
         batch          = nullif(btrim(coalesce(p_batch, '')), ''),
         section        = nullif(btrim(coalesce(p_section, '')), ''),
         approver_level = case when 'approver' = any (v_roles) then 'dean'::public.approver_level end,
         active         = coalesce(p_active, true),
         user_id        = case when v_email = cur.email then cur.user_id
                               else (select id from auth.users u where lower(u.email) = v_email limit 1) end
   where id = p_person;
end $$;

-- Graduate (deactivate) or restore every student in a batch, optionally one section.
-- Refuses to graduate while any of those students has a request still open.
create or replace function public.set_batch_active(p_batch text, p_section text, p_active boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_open int;
  v_n int;
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can change a batch.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_batch, '')), '') is null then
    raise exception 'Choose a batch.' using errcode = '22023';
  end if;

  if not p_active then
    select count(*) into v_open
      from public.leave_requests r join public.people p on p.id = r.student_id
     where p.batch = p_batch and (p_section is null or p.section = p_section)
       and r.status in ('submitted', 'sanctioned', 'documents_in');
    if v_open > 0 then
      raise exception '% leave request% in this batch % still open. Decide or close them first.',
        v_open, case when v_open = 1 then '' else 's' end, case when v_open = 1 then 'is' else 'are' end
        using errcode = '22023';
    end if;
  end if;

  update public.people
     set active = p_active
   where 'student' = any (roles)
     and roles <@ array['student']::public.user_role[]
     and batch = p_batch and (p_section is null or section = p_section)
     and active is distinct from p_active;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.update_person(uuid, text, text, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.set_batch_active(text, text, boolean) from public, anon;
grant execute on function public.update_person(uuid, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_batch_active(text, text, boolean) to authenticated;
