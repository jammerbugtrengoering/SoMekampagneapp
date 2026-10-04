-- =====================================================================
-- LinkedIn: forfatteren kan vaere en person, ikke kun en organisation
--
-- 0006 gik ud fra at der publiceres til firmasider. Det viste sig at
-- foerste behov er den modsatte: opslag paa en personlig profil.
--
-- Forskellen er ikke kosmetisk. Firmasider kraever Community Management
-- API med ansoegning og godkendelse; en personlig profil kraever
-- «Share on LinkedIn», som er selvbetjening. Men i selve opslaget er
-- forskellen praecis eet felt -- forfatteren er enten
-- urn:li:person:xxx eller urn:li:organization:yyy.
--
-- Derfor hedder kolonnen ikke laengere org_urn. Et navn der kun daekker
-- det halve af det den indeholder, er en faelde for den der laeser den
-- om et halvt aar.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'channels' and column_name = 'org_urn'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'channels' and column_name = 'author_urn'
  ) then
    alter table public.channels rename column org_urn to author_urn;
  end if;
end $$;

alter table public.channels add column if not exists author_urn text;

comment on column public.channels.author_urn is
  'LinkedIn-forfatteren: urn:li:person:xxx for en personlig profil, '
  'urn:li:organization:yyy for en firmaside. Kun for platform = linkedin.';

notify pgrst, 'reload schema';
