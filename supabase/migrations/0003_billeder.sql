-- =====================================================================
-- Billeder: skriveadgang til storage, og lidt mere at vide om hvert asset.
--
-- Læsning klarer sig selv: bucket'en er public, fordi Meta selv henter
-- billedet fra URL'en og ikke kan logge ind. Skrivning skal derimod låses,
-- ellers kan enhver med anon-nøglen fylde bucket'en op.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage-politikker
-- ---------------------------------------------------------------------
-- storage.objects har RLS slået til fra Supabases side. Uden en
-- insert-politik fejler ethvert upload — også for en logget ind bruger.

drop policy if exists "admins uploader kampagnebilleder" on storage.objects;
create policy "admins uploader kampagnebilleder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kampagne-assets' and public.er_admin());

drop policy if exists "admins opdaterer kampagnebilleder" on storage.objects;
create policy "admins opdaterer kampagnebilleder" on storage.objects
  for update to authenticated
  using (bucket_id = 'kampagne-assets' and public.er_admin())
  with check (bucket_id = 'kampagne-assets' and public.er_admin());

drop policy if exists "admins sletter kampagnebilleder" on storage.objects;
create policy "admins sletter kampagnebilleder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'kampagne-assets' and public.er_admin());

-- ---------------------------------------------------------------------
-- assets: hvor kom billedet fra, og hvad blev det lavet af
-- ---------------------------------------------------------------------
alter table public.assets
  add column if not exists width int,
  add column if not exists height int,
  -- Skabelon-billeder gemmer deres opskrift, så de kan laves om senere
  -- uden at man skal huske hvilken tekst og hvilket foto der blev brugt.
  add column if not exists opskrift jsonb;

-- 'ai' fandtes allerede i 0001. 'skabelon' er den nye, hvor vi selv har
-- tegnet billedet i browseren.
alter table public.assets drop constraint if exists assets_source_check;
alter table public.assets
  add constraint assets_source_check
  check (source in ('upload', 'ai', 'template', 'skabelon'));
