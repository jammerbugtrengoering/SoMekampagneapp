-- =====================================================================
-- Er organisationerne tætte?
--
-- Testen svarer på det spørgsmål der afgør om løsningen kan sælges: kan en
-- bruger hos PGU se eller ændre noget hos Jammerbugt? Den spørger basen
-- direkte, ikke skærmbilledet — for skærmbilledet er ikke sikkerheden, det
-- er kun høfligheden.
--
-- KØR DEN ALDRIG MOD PRODUKTION. Den opretter og sletter data. Den er
-- skrevet til en engangsbase:
--
--   npm run test:adskillelse
--
-- Hver kontrol er en assert. Fejler én, stopper hele filen med en besked
-- der siger hvad der slap igennem.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- To organisationer med hver sit indhold
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'jonn@test.dk'),
  ('22222222-2222-2222-2222-222222222222', 'pgu@test.dk'),
  ('33333333-3333-3333-3333-333333333333', 'redaktoer@test.dk'),
  ('44444444-4444-4444-4444-444444444444', 'godkender@test.dk');

insert into public.organisations (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-jammerbugt', 'Jammerbugt (test)'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test-pgu', 'PGU (test)');

insert into public.org_members (org_id, user_id, rolle) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ejer'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'redaktoer'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'godkender'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'ejer');

insert into public.customers (id, slug, name, organisation_id, token_ciphertext) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-jb', 'Jammerbugt Rengøring',
   'aaaaaaaa-0000-0000-0000-000000000001', 'hemmeligt-jb-token'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'test-pgu-k', 'PGU',
   'aaaaaaaa-0000-0000-0000-000000000002', 'hemmeligt-pgu-token');

insert into public.brands (id, slug, name, customer_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'test-jb-reng', 'Rengøring',
   'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'test-pgu-brand', 'PGU',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.channels (id, brand_id, platform, display_name, page_id, token_ciphertext) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'facebook', 'JB Facebook', '123', 'kanaltoken-jb');

insert into public.campaigns (id, brand_id, name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Hovedrengøring');

insert into public.posts (id, campaign_id, brand_id, body, status) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'Original tekst', 'needs_approval');

insert into public.post_targets (id, post_id, channel_id) values
  ('ffffffff-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001');

insert into storage.objects (bucket_id, name) values
  ('kampagne-assets', 'cccccccc-0000-0000-0000-000000000001/billede.jpg');

-- ---------------------------------------------------------------------
-- Hjælper: skift bruger
-- ---------------------------------------------------------------------
create or replace function pg_temp.som(bruger uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', bruger::text, true);
end;
$$;

create or replace function pg_temp.tjek(paastand boolean, hvad text) returns void
language plpgsql as $$
begin
  if not paastand then
    raise exception 'FEJLET: %', hvad;
  end if;
  raise notice 'ok  %', hvad;
end;
$$;

set role authenticated;

-- =====================================================================
-- 1. PGU må ikke kunne SE noget hos Jammerbugt
-- =====================================================================
select pg_temp.som('22222222-2222-2222-2222-222222222222');

select pg_temp.tjek(
  (select count(*) from public.customers where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts kunde');

select pg_temp.tjek(
  (select count(*) from public.brands where id = 'cccccccc-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts brand');

select pg_temp.tjek(
  (select count(*) from public.channels where id = 'dddddddd-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts kanal — og dermed ikke tokenet');

select pg_temp.tjek(
  (select count(*) from public.campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts kampagne');

select pg_temp.tjek(
  (select count(*) from public.posts where id = 'ffffffff-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts opslag');

select pg_temp.tjek(
  (select count(*) from public.post_targets where id = 'ffffffff-1111-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts kanalmål');

select pg_temp.tjek(
  (select count(*) from public.organisations where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts organisation');

select pg_temp.tjek(
  (select count(*) from public.org_members
   where org_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'PGU ser ikke Jammerbugts medlemmer');

-- =====================================================================
-- 2. PGU må ikke kunne ÆNDRE noget hos Jammerbugt
--
-- Bemærk hvorfor der tælles rækker: en update der ikke må noget, fejler
-- ikke — den rammer nul rækker. Det er den tavse variant, og den er værd
-- at teste netop fordi den ikke larmer.
-- =====================================================================
with u as (
  update public.posts set body = 'PGU overtog teksten'
  where id = 'ffffffff-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'PGU kan ikke rette Jammerbugts opslag');

with u as (
  update public.customers set token_ciphertext = 'stjaalet'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'PGU kan ikke overskrive Jammerbugts token');

with d as (
  delete from public.campaigns
  where id = 'eeeeeeee-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from d) = 0, 'PGU kan ikke slette Jammerbugts kampagne');

do $$
begin
  insert into public.brands (slug, name, customer_id)
  values ('test-snyd', 'Snydebrand', 'bbbbbbbb-0000-0000-0000-000000000001');
  raise exception 'FEJLET: PGU kunne oprette et brand under Jammerbugts kunde';
exception
  when insufficient_privilege then
    raise notice 'ok  PGU kan ikke oprette brand under Jammerbugts kunde';
end;
$$;

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('kampagne-assets', 'cccccccc-0000-0000-0000-000000000001/snydebillede.jpg');
  raise exception 'FEJLET: PGU kunne lægge en fil under Jammerbugts brand';
exception
  when insufficient_privilege then
    raise notice 'ok  PGU kan ikke lægge filer under Jammerbugts brand';
end;
$$;

-- =====================================================================
-- 3. Redaktøren må lave opslag, men ikke røre tokens
-- =====================================================================
select pg_temp.som('33333333-3333-3333-3333-333333333333');

select pg_temp.tjek(
  (select count(*) from public.posts where id = 'ffffffff-0000-0000-0000-000000000001') = 1,
  'Redaktøren ser sin organisations opslag');

with u as (
  update public.posts set body = 'Redaktøren rettede teksten'
  where id = 'ffffffff-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1, 'Redaktøren kan rette et opslag');

with u as (
  update public.channels set token_ciphertext = 'redaktoeren-satte-token'
  where id = 'dddddddd-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'Redaktøren kan ikke ændre en kanals token');

with u as (
  update public.customers set token_ciphertext = 'redaktoeren-satte-token'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'Redaktøren kan ikke ændre kundens token');

with u as (
  update public.org_members set rolle = 'ejer'
  where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and user_id = '33333333-3333-3333-3333-333333333333' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'Redaktøren kan ikke forfremme sig selv');

-- =====================================================================
-- 4. Godkenderen må kun godkende
-- =====================================================================
select pg_temp.som('44444444-4444-4444-4444-444444444444');

select pg_temp.tjek(
  (select count(*) from public.posts where id = 'ffffffff-0000-0000-0000-000000000001') = 1,
  'Godkenderen ser opslaget');

with u as (
  update public.posts set status = 'approved'
  where id = 'ffffffff-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1, 'Godkenderen kan godkende');

-- Den vigtigste: godkenderen må ikke kunne omskrive teksten og godkende
-- sin egen version. Politikken tillader opdateringen; triggeren stopper den.
do $$
begin
  update public.posts set body = 'Godkenderen skrev noget andet', status = 'approved'
  where id = 'ffffffff-0000-0000-0000-000000000001';
  raise exception 'FEJLET: Godkenderen kunne ændre teksten';
exception
  when raise_exception then
    if position('FEJLET' in sqlerrm) = 1 then raise;
    end if;
    raise notice 'ok  Godkenderen kan ikke ændre teksten';
end;
$$;

do $$
begin
  update public.posts set status = 'published'
  where id = 'ffffffff-0000-0000-0000-000000000001';
  raise exception 'FEJLET: Godkenderen kunne markere et opslag som publiceret';
exception
  when raise_exception then
    if position('FEJLET' in sqlerrm) = 1 then raise;
    end if;
    raise notice 'ok  Godkenderen kan ikke sætte status til publiceret';
end;
$$;

do $$
begin
  insert into public.posts (campaign_id, brand_id, body, status)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
          'Godkenderens eget opslag', 'draft');
  raise exception 'FEJLET: Godkenderen kunne oprette et opslag';
exception
  when insufficient_privilege then
    raise notice 'ok  Godkenderen kan ikke oprette opslag';
end;
$$;

with d as (
  delete from public.posts where id = 'ffffffff-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from d) = 0, 'Godkenderen kan ikke slette et opslag');

-- =====================================================================
-- 5. Ejeren må det hele — i sin egen organisation
-- =====================================================================
select pg_temp.som('11111111-1111-1111-1111-111111111111');

with u as (
  update public.channels set token_ciphertext = 'ejeren-satte-token'
  where id = 'dddddddd-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1, 'Ejeren kan sætte en kanals token');

select pg_temp.tjek(
  (select count(*) from public.customers) = 1,
  'Ejeren ser præcis sin egen kunde og ikke PGU''s');

select pg_temp.tjek(
  (select count(*) from public.mine_organisationer) = 1,
  'Ejeren er med i én organisation');

select pg_temp.tjek(
  (select rolle from public.mine_organisationer limit 1) = 'ejer',
  'Rollen kommer med ud af mine_organisationer');

reset role;
rollback;
