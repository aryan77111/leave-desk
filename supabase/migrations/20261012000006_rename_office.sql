-- Leave Desk: the programme office is now called the Dean HRM Office.
-- Rewrites the wording inside existing workflow functions (emails, timeline entries, errors).
-- Safe to run more than once.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%programme office%'
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'the programme office', 'the Dean HRM Office');
    def := replace(def, 'The programme office', 'The Dean HRM Office');
    def := replace(def, 'Programme office', 'Dean HRM Office');
    def := replace(def, 'programme office', 'Dean HRM Office');
    execute def;
  end loop;
end $$;
