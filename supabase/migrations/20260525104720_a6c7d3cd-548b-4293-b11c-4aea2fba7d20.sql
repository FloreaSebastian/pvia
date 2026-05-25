-- Public bucket for company logos (used in PDFs, emails, app UI)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152, -- 2 MB
  array['image/png','image/jpeg','image/jpg','image/webp','image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read for company-logos (logos are referenced in PDFs and emails)
drop policy if exists "company_logos_public_read" on storage.objects;
create policy "company_logos_public_read"
on storage.objects
for select
to public
using (bucket_id = 'company-logos');

-- No direct insert/update/delete: only the server function (service role) can write.
drop policy if exists "company_logos_no_client_write_insert" on storage.objects;
drop policy if exists "company_logos_no_client_write_update" on storage.objects;
drop policy if exists "company_logos_no_client_write_delete" on storage.objects;