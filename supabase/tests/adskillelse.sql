-- =====================================================================
-- Er organisationerne tætte?
--
-- Testen svarer på det spørgsmål der afgør om løsningen kan sælges: kan en
-- bruger hos Beta se eller ændre noget hos Alfa? Den spørger basen
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
  ('22222222-2222-2222-2222-222222222222', 'beta@test.dk'),
  ('33333333-3333-3333-3333-333333333333', 'redaktoer@test.dk'),
  ('44444444-4444-4444-4444-444444444444', 'godkender@test.dk');

insert into public.organisations (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-alfa', 'Alfa (test)'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test-beta', 'Beta (test)');

insert into public.org_members (org_id, user_id, rolle) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ejer'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'redaktoer'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'godkender'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'ejer');

insert into public.customers (id, slug, name, organisation_id, token_ciphertext) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-alfa-k', 'Alfa A/S',
   'aaaaaaaa-0000-0000-0000-000000000001', 'hemmeligt-alfa-token'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'test-beta-k', 'Beta ApS',
   'aaaaaaaa-0000-0000-0000-000000000002', 'hemmeligt-beta-token');

insert into public.brands (id, slug, name, customer_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'test-alfa-brand', 'Alfa Drift',
   'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'test-beta-brand', 'Beta',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.channels (id, brand_id, platform, display_name, page_id, token_ciphertext) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'facebook', 'Alfa Facebook', '123', 'kanaltoken-alfa');

-- En LinkedIn-kanal og dens token. Tokenet haenger paa KUNDEN, som det
-- gaelder for LinkedIn: den der autoriserer, gaelder for de sider hun er
-- admin paa.
insert into public.channels (id, brand_id, platform, display_name, author_urn) values
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
   'linkedin', 'Alfa LinkedIn', 'urn:li:person:999');

insert into public.linkedin_tokens
  (id, customer_id, member_urn, access_ciphertext, refresh_ciphertext, access_udloeber)
values
  ('99999999-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'urn:li:person:jb', 'hemmeligt-li-access', 'hemmeligt-li-refresh',
   now() + interval '60 days');

insert into public.campaigns (id, brand_id, name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Hovedrengøring');

insert into public.posts (id, campaign_id, brand_id, body, status) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'Original tekst', 'needs_approval');

insert into public.post_targets (id, post_id, channel_id) values
  ('ffffffff-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001');

insert into public.arketyper (id, organisation_id, navn, beskrivelse) values
  ('77777777-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Driftslederen', 'Du har staaet med spanden selv.');

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
-- 1. Beta må ikke kunne SE noget hos Alfa
-- =====================================================================
select pg_temp.som('22222222-2222-2222-2222-222222222222');

select pg_temp.tjek(
  (select count(*) from public.customers where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas kunde');

select pg_temp.tjek(
  (select count(*) from public.brands where id = 'cccccccc-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas brand');

select pg_temp.tjek(
  (select count(*) from public.channels where id = 'dddddddd-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas kanal — og dermed ikke tokenet');

select pg_temp.tjek(
  (select count(*) from public.campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas kampagne');

select pg_temp.tjek(
  (select count(*) from public.posts where id = 'ffffffff-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas opslag');

select pg_temp.tjek(
  (select count(*) from public.post_targets where id = 'ffffffff-1111-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas kanalmål');

select pg_temp.tjek(
  (select count(*) from public.organisations where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas organisation');

select pg_temp.tjek(
  (select count(*) from public.org_members
   where org_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas medlemmer');

-- Den kontrol der fangede en rigtig fejl: en visning kører som standard med
-- ejerens rettigheder og går uden om RLS. kanal_med_token udleverede alle
-- kunders tokens til enhver der var logget ind, uden at det kunne ses ved at
-- læse politikkerne. Bliver security_invoker slået fra igen, fejler den her.
select pg_temp.tjek(
  (select count(*) from public.kanal_med_token) = 0,
  'kanal_med_token lækker ikke tokens på tværs (visningen læser som kalderen)');

-- =====================================================================
-- 2. Beta må ikke kunne ÆNDRE noget hos Alfa
--
-- Bemærk hvorfor der tælles rækker: en update der ikke må noget, fejler
-- ikke — den rammer nul rækker. Det er den tavse variant, og den er værd
-- at teste netop fordi den ikke larmer.
-- =====================================================================
with u as (
  update public.posts set body = 'Beta overtog teksten'
  where id = 'ffffffff-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'Beta kan ikke rette Alfas opslag');

with u as (
  update public.customers set token_ciphertext = 'stjaalet'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0, 'Beta kan ikke overskrive Alfas token');

with d as (
  delete from public.campaigns
  where id = 'eeeeeeee-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from d) = 0, 'Beta kan ikke slette Alfas kampagne');

do $$
begin
  insert into public.brands (slug, name, customer_id)
  values ('test-snyd', 'Snydebrand', 'bbbbbbbb-0000-0000-0000-000000000001');
  raise exception 'FEJLET: Beta kunne oprette et brand under Alfas kunde';
exception
  when insufficient_privilege then
    raise notice 'ok  Beta kan ikke oprette brand under Alfas kunde';
end;
$$;

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('kampagne-assets', 'cccccccc-0000-0000-0000-000000000001/snydebillede.jpg');
  raise exception 'FEJLET: Beta kunne lægge en fil under Alfas brand';
exception
  when insufficient_privilege then
    raise notice 'ok  Beta kan ikke lægge filer under Alfas brand';
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
  'Ejeren ser præcis sin egen kunde og ikke Beta''s');

select pg_temp.tjek(
  (select count(*) from public.mine_organisationer) = 1,
  'Ejeren er med i én organisation');

select pg_temp.tjek(
  (select rolle from public.mine_organisationer limit 1) = 'ejer',
  'Rollen kommer med ud af mine_organisationer');

-- =====================================================================
-- 6. LinkedIn-tokens er lige saa taette som Metas
--
-- De ligger i deres egen tabel med deres egne politikker, og en tabel
-- der er ny er en tabel ingen endnu har glemt at slaa RLS til paa. Det
-- er praecis derfor den skal staa her: naeste gang nogen tilfoejer et
-- felt eller et view ovenpaa, er det den her fil der opdager det.
-- =====================================================================
select pg_temp.som('22222222-2222-2222-2222-222222222222');

select pg_temp.tjek(
  (select count(*) from public.linkedin_tokens) = 0,
  'Beta ser ikke Alfas LinkedIn-token');

select pg_temp.tjek(
  (select count(*) from public.channels
   where id = 'dddddddd-0000-0000-0000-000000000002') = 0,
  'Beta ser ikke Alfas LinkedIn-kanal');

-- Den tavse variant igen: en update der intet maa, fejler ikke.
-- Den rammer nul raekker.
with u as (
  update public.linkedin_tokens set access_ciphertext = 'kapret'
  where id = '99999999-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Beta kan ikke overskrive Alfas LinkedIn-token');

with d as (
  delete from public.linkedin_tokens
  where id = '99999999-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from d) = 0,
  'Beta kan ikke slette Alfas LinkedIn-token');

-- At skrive et token IND hos en fremmed kunde ville vaere vaerre end at
-- laese: saa peger publiceringen et sted ingen har besluttet.
do $$
begin
  begin
    insert into public.linkedin_tokens
      (customer_id, member_urn, access_ciphertext, access_udloeber)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'urn:li:person:pgu',
            'indsmuglet', now() + interval '60 days');
    raise exception 'FEJLET: Beta kunne indsaette et token hos Alfa';
  exception when insufficient_privilege then
    raise notice 'ok  Beta kan ikke indsaette et token hos Alfa';
  end;
end $$;

-- Redaktoeren maa se at tokenet findes og hvornaar det udloeber -- hun
-- skal kunne forstaa hvorfor en publicering stoppede -- men ikke roere
-- det. Samme skel som for Metas kanaltokens.
select pg_temp.som('33333333-3333-3333-3333-333333333333');

select pg_temp.tjek(
  (select count(*) from public.linkedin_tokens) = 1,
  'Redaktoeren ser at der ER et LinkedIn-token');

with u as (
  update public.linkedin_tokens set access_ciphertext = 'redaktoeren-var-her'
  where id = '99999999-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Redaktoeren kan ikke roere LinkedIn-tokenet');

-- Og ejeren maa det, ellers kan ingen forny naar aaret er gaaet.
select pg_temp.som('11111111-1111-1111-1111-111111111111');

with u as (
  update public.linkedin_tokens set access_ciphertext = 'ejeren-fornyede'
  where id = '99999999-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1,
  'Ejeren kan forny LinkedIn-tokenet');

-- =====================================================================
-- 7. Arketyper hoerer til een organisation
--
-- En arketype er ikke en hemmelighed, men den er et arbejdsredskab nogen
-- har formuleret -- og den afsloerer hvad en anden organisation laver og
-- hvordan de taler. Den skal ikke kunne laeses paa tvaers, og slet ikke
-- redigeres.
-- =====================================================================
select pg_temp.som('22222222-2222-2222-2222-222222222222');

select pg_temp.tjek(
  (select count(*) from public.arketyper) = 0,
  'Beta ser ikke Alfas arketyper');

with u as (
  update public.arketyper set beskrivelse = 'kapret'
  where id = '77777777-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Beta kan ikke rette Alfas arketype');

do $$
begin
  begin
    insert into public.arketyper (organisation_id, navn, beskrivelse)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Indsmuglet', 'x');
    raise exception 'FEJLET: Beta kunne oprette en arketype hos Alfa';
  exception when insufficient_privilege then
    raise notice 'ok  Beta kan ikke oprette en arketype hos Alfa';
  end;
end $$;

-- Redaktoeren SKAL kunne styre dem: det er indhold, ikke adgang, og det
-- er hende der skriver opslagene og dermed ved hvilke roller der mangler.
select pg_temp.som('33333333-3333-3333-3333-333333333333');

with u as (
  update public.arketyper set beskrivelse = 'redaktoeren rettede'
  where id = '77777777-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1,
  'Redaktoeren kan rette en arketype');

-- Godkenderen maa se dem -- ellers kan hun ikke vurdere et opslag -- men
-- ikke roere dem.
select pg_temp.som('44444444-4444-4444-4444-444444444444');

select pg_temp.tjek(
  (select count(*) from public.arketyper) = 1,
  'Godkenderen ser arketypen');

with u as (
  update public.arketyper set beskrivelse = 'godkenderen var her'
  where id = '77777777-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Godkenderen kan ikke rette en arketype');

-- =====================================================================
-- 8. Strategier hoerer til een organisation
--
-- Strategierne saas automatisk ved oprettelsen af organisationen, saa
-- begge har deres egne femten. Det goer testen skarpere end den var for
-- arketyperne: her raekker det ikke at taelle raekker, for Beta HAR
-- raekker. Der skal taelles paa Alfas organisation_id.
--
-- Saaningen koerer som security definer. Det er den slags rettighed der
-- skal efterproeves og ikke antages: gik den for vidt, ville en funktion
-- med adgang til alt vaere naaelig fra klienten.
-- =====================================================================
select pg_temp.som('22222222-2222-2222-2222-222222222222');

select pg_temp.tjek(
  (select count(*) from public.strategier
   where organisation_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'Beta ser ikke Alfas strategier');

select pg_temp.tjek(
  (select count(*) from public.strategier) = 15,
  'Beta ser sine egne femten standarder');

select pg_temp.tjek(
  (select count(*) from public.strategier where niveau = 'kampagne') = 5,
  'Fem kampagnestrategier');

select pg_temp.tjek(
  (select count(*) from public.strategier where niveau = 'vinkel') = 10,
  'Ti vinkler');

with u as (
  update public.strategier set beskrivelse = 'kapret'
  where organisation_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Beta kan ikke rette Alfas strategier');

do $$
begin
  begin
    insert into public.strategier (organisation_id, niveau, navn, beskrivelse)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'vinkel', 'Indsmuglet', 'x');
    raise exception 'FEJLET: Beta kunne oprette en strategi hos Alfa';
  exception when insufficient_privilege then
    raise notice 'ok  Beta kan ikke oprette en strategi hos Alfa';
  end;
end $$;

-- Redaktoeren skriver opslagene og er dermed den der ved hvornaar en
-- formulering ikke passer. Hun skal kunne rette dem.
select pg_temp.som('33333333-3333-3333-3333-333333333333');

with u as (
  update public.strategier set beskrivelse = 'redaktoeren rettede'
  where organisation_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and niveau = 'kampagne' and navn = 'Tragt' returning 1
)
select pg_temp.tjek((select count(*) from u) = 1,
  'Redaktoeren kan rette en strategi');

-- Godkenderen skal kunne se hvad opslaget var taenkt som, men ikke aendre
-- planen bagefter.
select pg_temp.som('44444444-4444-4444-4444-444444444444');

select pg_temp.tjek(
  (select count(*) from public.strategier) = 15,
  'Godkenderen ser strategierne');

with u as (
  update public.strategier set beskrivelse = 'godkenderen var her'
  where organisation_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1
)
select pg_temp.tjek((select count(*) from u) = 0,
  'Godkenderen kan ikke rette en strategi');

reset role;
rollback;
