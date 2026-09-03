-- =====================================================================
-- Organisationer: fra ét hold til mange kunder i samme base
--
-- Hidtil har adgangen været binær: står du i app_admins, kan du alt — også
-- på tværs af kunder. Det holder så længe alle brugere arbejder for samme
-- firma. Det holder ikke den dag PGU skal fortsætte uden Jammerbugt, og
-- slet ikke hvis løsningen skal sælges til andre.
--
-- Modellen bliver:
--
--   organisation → kunde → brand → kanal
--
-- Organisationen er den der har et abonnement og nogle brugere. Kunden er
-- den organisationen laver opslag for. For Jammerbugt er de to det samme;
-- for et reklamebureau vil der ligge mange kunder under én organisation.
--
-- Roller i organisationen:
--   ejer        alt, inklusive kunder, Meta-tokens og medlemmer
--   redaktoer   kampagner, opslag og billeder — ikke tokens, ikke medlemmer
--   godkender   må se, og må kun sætte et opslag til godkendt eller afvist
--
-- Den bærende idé fra 0002 genbruges: adgangen ligger i FÅ funktioner, så
-- modellen kan flyttes uden at hver politik skal tænkes igennem forfra.
-- Forskellen er at læsning og skrivning nu skilles, for en godkender skal
-- kunne se alt og næsten intet ændre.
--
-- Migrationen er additiv og kan køres på en base med data i: hver
-- eksisterende kunde bliver sin egen organisation, og alle nuværende
-- administratorer bliver ejere i dem alle. Ingen mister adgang i dag; du
-- fjerner selv folk fra de organisationer de ikke skal være i.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Organisationer
-- ---------------------------------------------------------------------
create table if not exists public.organisations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,

  -- Abonnementet. Står her frem for hos en betalingsudbyder, fordi appen
  -- skal kunne svare på "må denne organisation det her" uden et netkald.
  plan        text not null default 'gratis',
  aktiv       boolean not null default true,

  -- Hvor mange kunder og opslag om måneden planen rummer. Null = uden
  -- grænse, som for din egen organisation.
  maks_kunder int,
  maks_opslag int,

  noter       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Medlemmer og roller
-- ---------------------------------------------------------------------
create table if not exists public.org_members (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rolle      text not null check (rolle in ('ejer', 'redaktoer', 'godkender')),

  -- E-mail og navn gentages her, så en medlemsliste kan vises uden at
  -- skærmbilledet skal have adgang til auth.users.
  email      text,
  name       text,
  created_at timestamptz not null default now(),

  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members(user_id);

-- ---------------------------------------------------------------------
-- Kunden hører til en organisation
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists organisation_id uuid references public.organisations(id) on delete cascade;

-- Hver eksisterende kunde bliver sin egen organisation. Migrationen kan
-- ikke gætte hvilke der hører sammen, og at gætte forkert her ville give
-- to kunder adgang til hinandens sider — den fejl vil vi ikke lave.
insert into public.organisations (slug, name)
select c.slug, c.name
from public.customers c
where c.organisation_id is null
  and not exists (select 1 from public.organisations o where o.slug = c.slug);

update public.customers c
set organisation_id = o.id
from public.organisations o
where c.organisation_id is null and o.slug = c.slug;

-- Først nu kan kolonnen gøres obligatorisk: en kunde uden organisation
-- ville være usynlig for alle, og det er en fejl der er svær at finde.
alter table public.customers alter column organisation_id set not null;

create index if not exists customers_org_idx on public.customers(organisation_id);

-- Alle nuværende administratorer bliver ejere i alle organisationer, så
-- ingen står uden adgang efter migrationen. Det er med vilje bredt: at
-- fjerne adgang er en beslutning, ikke noget en migration skal tage.
insert into public.org_members (org_id, user_id, rolle, email, name)
select o.id, a.user_id, 'ejer', a.email, a.name
from public.organisations o
cross join public.app_admins a
on conflict (org_id, user_id) do nothing;

-- ---------------------------------------------------------------------
-- Funktionerne der afgør alt
-- ---------------------------------------------------------------------
-- security definer hele vejen: funktionerne læser org_members, og skulle
-- de ramme tabellens egen politik, ville politikken kalde funktionen igen
-- og løbe i ring.

create or replace function public.min_rolle(maal uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select m.rolle
  from public.org_members m
  where m.org_id = maal and m.user_id = auth.uid();
$$;

create or replace function public.har_org_adgang(maal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.min_rolle(maal) is not null;
$$;

create or replace function public.kan_redigere(maal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.min_rolle(maal) in ('ejer', 'redaktoer');
$$;

create or replace function public.er_ejer(maal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.min_rolle(maal) = 'ejer';
$$;

-- Vejen fra et brand op til organisationen. Alt indhold hænger på et
-- brand, så det er her de to modeller mødes.
create or replace function public.org_for_brand(maal uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.organisation_id
  from public.brands b
  join public.customers c on c.id = b.customer_id
  where b.id = maal;
$$;

-- Signaturen fra 0001 beholdes, så gamle politikker og eventuelle kald
-- andre steder betyder præcis det samme som før — bare inden for
-- organisationen. Den er nu LÆSEADGANG.
create or replace function public.has_brand_access(target_brand uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.har_org_adgang(public.org_for_brand(target_brand));
$$;

-- Og den nye modstykke: må jeg ændre indhold på brandet?
create or replace function public.kan_redigere_brand(maal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.kan_redigere(public.org_for_brand(maal));
$$;

create or replace function public.er_ejer_af_brand(maal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.er_ejer(public.org_for_brand(maal));
$$;

-- er_admin() bliver stående, fordi 0002 og 0003 kalder den. Den betyder nu
-- "er ejer eller redaktør et sted" — nok til at være logget ind som andet
-- end godkender, men den afgør ikke længere adgang til data.
create or replace function public.er_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid() and rolle in ('ejer', 'redaktoer')
  );
$$;

-- ---------------------------------------------------------------------
-- Politikker: organisationen og dens medlemmer
-- ---------------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.org_members   enable row level security;

drop policy if exists "medlemmer ser egen organisation" on public.organisations;
create policy "medlemmer ser egen organisation" on public.organisations
  for select using (public.har_org_adgang(id));

-- Kun ejeren retter navnet og planen. En ny organisation oprettes med
-- secret key gennem en funktion, ikke fra browseren — ellers kunne enhver
-- logget ind bruger lave sig en.
drop policy if exists "ejere retter egen organisation" on public.organisations;
create policy "ejere retter egen organisation" on public.organisations
  for update using (public.er_ejer(id)) with check (public.er_ejer(id));

-- Alle i organisationen kan se hvem de arbejder sammen med. Det er ikke
-- fortroligt, og uden det kan man ikke se hvem der skal godkende.
drop policy if exists "medlemmer ser medlemmer" on public.org_members;
create policy "medlemmer ser medlemmer" on public.org_members
  for select using (public.har_org_adgang(org_id));

drop policy if exists "ejere styrer medlemmer" on public.org_members;
create policy "ejere styrer medlemmer" on public.org_members
  for all using (public.er_ejer(org_id)) with check (public.er_ejer(org_id));

-- ---------------------------------------------------------------------
-- Politikker: kunder
-- ---------------------------------------------------------------------
-- 0004 gav administratorer alle kunder. Nu gælder organisationen.
drop policy if exists "admins styrer kunder" on public.customers;

drop policy if exists "medlemmer ser kunder" on public.customers;
create policy "medlemmer ser kunder" on public.customers
  for select using (public.har_org_adgang(organisation_id));

-- Kunden bærer Meta-tokenet og aftalen. Det er ejerens bord.
drop policy if exists "ejere styrer kunder" on public.customers;
create policy "ejere styrer kunder" on public.customers
  for all using (public.er_ejer(organisation_id))
  with check (public.er_ejer(organisation_id));

-- ---------------------------------------------------------------------
-- Politikker: brands
-- ---------------------------------------------------------------------
drop policy if exists "admins styrer brands" on public.brands;

drop policy if exists "medlemmer ser brands" on public.brands;
create policy "medlemmer ser brands" on public.brands
  for select using (public.has_brand_access(id));

drop policy if exists "redaktoerer retter brands" on public.brands;
create policy "redaktoerer retter brands" on public.brands
  for update using (public.kan_redigere_brand(id))
  with check (public.kan_redigere_brand(id));

-- Et nyt brand skal hænge på en kunde man ejer. Uden with check kunne man
-- oprette et brand under en fremmed kunde og derefter læse det.
drop policy if exists "ejere opretter brands" on public.brands;
create policy "ejere opretter brands" on public.brands
  for insert with check (
    exists (
      select 1 from public.customers c
      where c.id = brands.customer_id and public.er_ejer(c.organisation_id)
    )
  );

drop policy if exists "ejere sletter brands" on public.brands;
create policy "ejere sletter brands" on public.brands
  for delete using (public.er_ejer_af_brand(id));

-- ---------------------------------------------------------------------
-- Politikker: kanaler
-- ---------------------------------------------------------------------
-- Kanalen bærer et token og peger på en rigtig Facebook-side. Derfor er
-- den ejerens, også når redaktøren gerne må lave opslag til den.
drop policy if exists "kanaler via brand" on public.channels;

drop policy if exists "medlemmer ser kanaler" on public.channels;
create policy "medlemmer ser kanaler" on public.channels
  for select using (public.has_brand_access(brand_id));

drop policy if exists "ejere styrer kanaler" on public.channels;
create policy "ejere styrer kanaler" on public.channels
  for all using (public.er_ejer_af_brand(brand_id))
  with check (public.er_ejer_af_brand(brand_id));

-- ---------------------------------------------------------------------
-- Politikker: billeder, kampagner, opslag
-- ---------------------------------------------------------------------
-- Assets kan hænge på et brand ELLER på kunden (0004). Begge veje skal
-- afgøres, ellers falder det fælles arkiv udenfor.
drop policy if exists "assets via brand" on public.assets;

drop policy if exists "medlemmer ser assets" on public.assets;
create policy "medlemmer ser assets" on public.assets
  for select using (
    (brand_id is not null and public.has_brand_access(brand_id))
    or (customer_id is not null and exists (
      select 1 from public.customers c
      where c.id = assets.customer_id and public.har_org_adgang(c.organisation_id)
    ))
  );

drop policy if exists "redaktoerer styrer assets" on public.assets;
create policy "redaktoerer styrer assets" on public.assets
  for all using (
    (brand_id is not null and public.kan_redigere_brand(brand_id))
    or (customer_id is not null and exists (
      select 1 from public.customers c
      where c.id = assets.customer_id and public.kan_redigere(c.organisation_id)
    ))
  )
  with check (
    (brand_id is not null and public.kan_redigere_brand(brand_id))
    or (customer_id is not null and exists (
      select 1 from public.customers c
      where c.id = assets.customer_id and public.kan_redigere(c.organisation_id)
    ))
  );

drop policy if exists "kampagner via brand" on public.campaigns;

drop policy if exists "medlemmer ser kampagner" on public.campaigns;
create policy "medlemmer ser kampagner" on public.campaigns
  for select using (public.has_brand_access(brand_id));

drop policy if exists "redaktoerer styrer kampagner" on public.campaigns;
create policy "redaktoerer styrer kampagner" on public.campaigns
  for all using (public.kan_redigere_brand(brand_id))
  with check (public.kan_redigere_brand(brand_id));

drop policy if exists "opslag via brand" on public.posts;

drop policy if exists "medlemmer ser opslag" on public.posts;
create policy "medlemmer ser opslag" on public.posts
  for select using (public.has_brand_access(brand_id));

drop policy if exists "redaktoerer opretter opslag" on public.posts;
create policy "redaktoerer opretter opslag" on public.posts
  for insert with check (public.kan_redigere_brand(brand_id));

drop policy if exists "redaktoerer sletter opslag" on public.posts;
create policy "redaktoerer sletter opslag" on public.posts
  for delete using (public.kan_redigere_brand(brand_id));

-- Her er godkenderen med: hun må opdatere opslag i sin organisation.
-- HVAD hun må ændre, står i triggeren nedenfor — en politik kan ikke se
-- forskel på gamle og nye værdier, og det er præcis det der skal til.
drop policy if exists "redaktoerer og godkendere retter opslag" on public.posts;
create policy "redaktoerer og godkendere retter opslag" on public.posts
  for update using (public.has_brand_access(brand_id))
  with check (public.has_brand_access(brand_id));

drop policy if exists "targets via opslag" on public.post_targets;

drop policy if exists "medlemmer ser targets" on public.post_targets;
create policy "medlemmer ser targets" on public.post_targets
  for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_targets.post_id and public.has_brand_access(p.brand_id)
    )
  );

drop policy if exists "redaktoerer styrer targets" on public.post_targets;
create policy "redaktoerer styrer targets" on public.post_targets
  for all using (
    exists (
      select 1 from public.posts p
      where p.id = post_targets.post_id and public.kan_redigere_brand(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_targets.post_id and public.kan_redigere_brand(p.brand_id)
    )
  );

-- ---------------------------------------------------------------------
-- Godkenderen må kun godkende
-- ---------------------------------------------------------------------
-- En politik kan afgøre OM rækken må opdateres, men ikke hvilke felter der
-- ændrede sig. Uden denne trigger kunne en godkender omskrive teksten og
-- godkende sin egen version — og det er hele pointen med at have en
-- godkender at det ikke kan ske.
create or replace function public.begraens_godkender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rolle text;
begin
  rolle := public.min_rolle(public.org_for_brand(old.brand_id));

  -- Ejer og redaktør går fri. Kaldes der med service key uden en bruger
  -- (den planlagte publicering), er rollen null, og så er det heller ikke
  -- en godkender der er på arbejde.
  if rolle is distinct from 'godkender' then
    return new;
  end if;

  if new.status not in ('approved', 'rejected', 'needs_approval') then
    raise exception 'En godkender kan kun godkende eller afvise, ikke sætte status til %.', new.status;
  end if;

  -- Alt andet end status skal stå uændret. Sammenligningen er felt for
  -- felt med is distinct from, så null håndteres rigtigt.
  if new.body           is distinct from old.body
     or new.hashtags    is distinct from old.hashtags
     or new.image_url   is distinct from old.image_url
     or new.image_brief is distinct from old.image_brief
     or new.scheduled_at is distinct from old.scheduled_at
     or new.campaign_id is distinct from old.campaign_id
     or new.brand_id    is distinct from old.brand_id then
    raise exception 'En godkender må kun ændre status. Bed en redaktør om at rette indholdet.';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_begraens_godkender on public.posts;
create trigger posts_begraens_godkender
  before update on public.posts
  for each row execute function public.begraens_godkender();

-- ---------------------------------------------------------------------
-- Billeder i storage
-- ---------------------------------------------------------------------
-- Stien er "<brand_id>/<uuid>.<endelse>", så mappenavnet ER brandet. Det
-- betyder at storage kan låses med præcis samme regel som resten — uden
-- det kunne en fremmed organisation skrive filer ind under dine brands.
drop policy if exists "admins uploader kampagnebilleder" on storage.objects;
drop policy if exists "admins opdaterer kampagnebilleder" on storage.objects;
drop policy if exists "admins sletter kampagnebilleder" on storage.objects;

-- Også de nye navne: køres migrationen to gange, skal den anden gang være
-- lige så stille som den første.
drop policy if exists "medlemmer uploader kampagnebilleder" on storage.objects;
drop policy if exists "medlemmer opdaterer kampagnebilleder" on storage.objects;
drop policy if exists "medlemmer sletter kampagnebilleder" on storage.objects;

-- Uuid-tjekket skal med: et mappenavn der ikke er et uuid ville få
-- castet til at fejle, og en fejl i en politik nægter alt.
create or replace function public.mit_brand_i_sti(navn text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when (storage.foldername(navn))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.kan_redigere_brand(((storage.foldername(navn))[1])::uuid)
    else false
  end;
$$;

create policy "medlemmer uploader kampagnebilleder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kampagne-assets' and public.mit_brand_i_sti(name));

create policy "medlemmer opdaterer kampagnebilleder" on storage.objects
  for update to authenticated
  using (bucket_id = 'kampagne-assets' and public.mit_brand_i_sti(name))
  with check (bucket_id = 'kampagne-assets' and public.mit_brand_i_sti(name));

create policy "medlemmer sletter kampagnebilleder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'kampagne-assets' and public.mit_brand_i_sti(name));

-- ---------------------------------------------------------------------
-- updated_at på organisationen
-- ---------------------------------------------------------------------
drop trigger if exists organisations_touch on public.organisations;
create trigger organisations_touch before update on public.organisations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Hjælpevisning: hvad er jeg med i, og som hvad?
-- ---------------------------------------------------------------------
create or replace view public.mine_organisationer as
select
  o.id,
  o.name,
  o.slug,
  o.plan,
  o.aktiv,
  m.rolle,
  (select count(*) from public.customers c where c.organisation_id = o.id) as antal_kunder
from public.organisations o
join public.org_members m on m.org_id = o.id
where m.user_id = auth.uid();

-- ---------------------------------------------------------------------
-- app_admins bliver stående — indtil videre
-- ---------------------------------------------------------------------
-- Netlify-funktionerne slår stadig op i den for at afgøre om et kald må
-- gå igennem, og de kører med secret key uden om RLS. Tabellen fjernes
-- først når funktionerne er lagt om til at spørge om rolle i en
-- organisation. Den giver ikke længere adgang til data.

notify pgrst, 'reload schema';
