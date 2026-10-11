-- Leave Desk: private bucket for medical certificates.
-- Students upload to <their auth user id>/<leave id>/<file>. Only the student,
-- approvers and the Dean HRM Office can read a certificate. Faculty cannot.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Students upload their own certificates"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_role('student')
  );

create policy "Students, approvers and office read certificates"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'certificates'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role('office') or public.has_role('approver'))
  );
