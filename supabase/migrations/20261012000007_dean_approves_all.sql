-- Leave Desk: the Dean approves every request. The Programme Chair level is retired.
-- The approver_level column stays for history, but every approver and every new request is 'dean'.

-- Every request is routed to the Dean.
create or replace function public.route_level(p_type public.leave_type, p_from date, p_to date) returns public.approver_level
language sql stable security definer set search_path = public as $$
  select 'dean'::public.approver_level
$$;

-- Existing approvers and open requests move to the Dean.
update public.people set approver_level = 'dean' where approver_level = 'chair';
update public.leave_requests set approver_level = 'dean' where approver_level = 'chair' and status = 'submitted';

-- Roster import: "dean" is accepted as a role name, and every approver is a Dean.
create or replace function public.import_people(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  row jsonb;
  i int := 0;
  v_ins int := 0;
  v_upd int := 0;
  v_err jsonb := '[]'::jsonb;
  v_email text;
  v_roles public.user_role[];
  v_existed boolean;
begin
  if not public.has_role('office') then
    raise exception 'Only the Dean HRM Office can import people.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5000 rows at a time.' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_email := lower(btrim(row ->> 'email'));
      if v_email is null or v_email = '' then raise exception 'Email is missing'; end if;
      select coalesce(array_agg(distinct (case when lower(btrim(x)) = 'dean' then 'approver' else lower(btrim(x)) end)::public.user_role), '{}')
        into v_roles
        from regexp_split_to_table(coalesce(row ->> 'roles', ''), '[;,|/ ]+') as x
       where btrim(x) <> '';
      if cardinality(v_roles) = 0 then raise exception 'Roles are missing (use student, faculty, dean or office)'; end if;
      select exists (select 1 from public.people where email = v_email) into v_existed;

      insert into public.people as p (email, full_name, roles, student_no, programme, batch, section, approver_level, active, user_id)
      values (v_email, btrim(row ->> 'full_name'), v_roles,
              nullif(btrim(coalesce(row ->> 'student_no', '')), ''),
              nullif(btrim(coalesce(row ->> 'programme', '')), ''),
              nullif(btrim(coalesce(row ->> 'batch', '')), ''),
              nullif(btrim(coalesce(row ->> 'section', '')), ''),
              case when 'approver' = any (v_roles) then 'dean'::public.approver_level end,
              true,
              (select id from auth.users u where lower(u.email) = v_email limit 1))
      on conflict (email) do update
        set full_name = excluded.full_name, roles = excluded.roles, student_no = excluded.student_no,
            programme = excluded.programme, batch = excluded.batch, section = excluded.section,
            approver_level = excluded.approver_level, active = true,
            user_id = coalesce(p.user_id, excluded.user_id);
      if v_existed then v_upd := v_upd + 1; else v_ins := v_ins + 1; end if;
    exception when others then
      v_err := v_err || jsonb_build_object('row', i, 'email', row ->> 'email', 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_err);
end $$;

-- Wording inside emails, timeline entries and errors: "approver" becomes "Dean".
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and (p.prosrc like '%the approver%' or p.prosrc like '%Only approvers%')
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'Only approvers can decide leave.', 'Only the Dean can decide leave.');
    def := replace(def, 'the approver', 'the Dean');
    execute def;
  end loop;
end $$;
