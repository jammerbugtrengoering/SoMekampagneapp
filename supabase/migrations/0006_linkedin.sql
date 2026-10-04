-- =====================================================================
-- LinkedIn: en side at publicere til, og et token der udløber
--
-- Meta-modellen bygger på to ting der begge er forkerte på LinkedIn:
-- at et token er én streng, og at det aldrig udløber. Et LinkedIn-token
-- er fire værdier med to udløbsdatoer — access efter 60 dage, refresh
-- efter et år — og det år nulstilles ikke når access-tokenet fornys.
--
-- Derfor får LinkedIn sin egen tabel frem for en plads i
-- channels.token_ciphertext. Havde vi proppet det derned, ville
-- kanal_med_token udlevere en streng som ingen kunne se holdbarheden
-- på, og den dag publiceringen stopper ville ingen vide hvorfor.
--
-- kanal_med_token røres ikke. Den er Metas regel, og den skal blive
-- ved med kun at betyde det den betyder.
--
-- Migrationen er additiv. Den kan køres på en base med data i, og den
-- ændrer intet for Facebook og Instagram.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hvilken LinkedIn-side peger kanalen på?
-- ---------------------------------------------------------------------
-- page_id er Facebooks, og den indgår i unique (brand_id, platform,
-- page_id). Genbrugte vi den til en organisations-URN, ville to
-- forskellige slags id'er dele kolonne og regel — og fejlen først vise
-- sig den dag nogen læser page_id på en LinkedIn-kanal.
alter table public.channels
  add column if not exists org_urn text;

comment on column public.channels.org_urn is
  'LinkedIn-organisationens URN, fx urn:li:organization:5583111. Kun for platform = linkedin.';

-- ---------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------
-- Tokenet hører normalt til KUNDEN: den der autoriserer, gør det som
-- sig selv, og autorisationen dækker de sider hun er admin på — typisk
-- alle kundens. En enkelt kanal kan have sit eget som nødudgang, hvis
-- en side administreres af en anden. Samme mønster som billedarkivet:
-- præcis én af de to skal være sat, og basen håndhæver det.
create table if not exists public.linkedin_tokens (
  id                 uuid primary key default gen_random_uuid(),

  customer_id        uuid references public.customers(id) on delete cascade,
  channel_id         uuid references public.channels(id)  on delete cascade,

  -- Hvem autoriserede. Gemmes så en ejer kan se hvis konto det hænger
  -- på — det er hende der skal reautorisere når året er gået.
  member_urn         text not null,
  member_navn        text,

  access_ciphertext  text not null,
  refresh_ciphertext text,

  -- De to datoer er hele grunden til at tabellen findes. De står i
  -- klartekst, for de er ikke hemmelige — og en advarsel om at
  -- adgangen snart udløber skal kunne stilles uden at dekryptere.
  access_udloeber    timestamptz not null,
  refresh_udloeber   timestamptz,

  scope              text,
  sidst_fornyet_at   timestamptz,
  sidste_fejl        text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint linkedin_tokens_ejer_entydig check (
    (customer_id is not null and channel_id is null) or
    (customer_id is null and channel_id is not null)
  )
);

-- Én autorisation per kunde og per kanal. Uden det ville to
-- halvgyldige tokens kunne ligge side om side, og publiceringen ville
-- vælge tilfældigt.
create unique index if not exists linkedin_tokens_kunde_idx
  on public.linkedin_tokens(customer_id) where customer_id is not null;

create unique index if not exists linkedin_tokens_kanal_idx
  on public.linkedin_tokens(channel_id) where channel_id is not null;

-- Den daglige fornyelse spørger «hvad udløber snart» og intet andet.
create index if not exists linkedin_tokens_udloeb_idx
  on public.linkedin_tokens(access_udloeber);

-- ---------------------------------------------------------------------
-- Vejen fra en kunde op til organisationen
-- ---------------------------------------------------------------------
-- 0005 har org_for_brand, fordi alt indhold hang på et brand. Tokenet
-- hænger på kunden, så den vej mangler. Samme form: security definer,
-- ellers ville politikken kalde sig selv gennem customers' egen.
create or replace function public.org_for_kunde(maal uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.organisation_id from public.customers c where c.id = maal;
$$;

-- Organisationen bag et token, uanset om det hænger på kunden eller på
-- en enkelt kanal. Politikkerne kalder kun denne, så modellen kan
-- ændres ét sted.
create or replace function public.org_for_linkedin_token(kunde uuid, kanal uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    public.org_for_kunde(kunde),
    (select public.org_for_brand(ch.brand_id) from public.channels ch where ch.id = kanal)
  );
$$;

-- ---------------------------------------------------------------------
-- Politikker
-- ---------------------------------------------------------------------
-- Læsning som for kanaler: er du medlem, må du se at tokenet findes og
-- hvornår det udløber. Ciphertexten er uden værdi uden nøglen, og den
-- findes kun i Netlify-funktionernes miljø.
--
-- Skrivning kun for ejere, som for kanaler og kundetokens. En redaktør
-- der kunne udskifte et token, kunne flytte publiceringen til en side
-- ingen havde besluttet.
alter table public.linkedin_tokens enable row level security;

drop policy if exists "medlemmer ser linkedin-tokens" on public.linkedin_tokens;
create policy "medlemmer ser linkedin-tokens" on public.linkedin_tokens
  for select using (
    public.har_org_adgang(public.org_for_linkedin_token(customer_id, channel_id))
  );

drop policy if exists "ejere styrer linkedin-tokens" on public.linkedin_tokens;
create policy "ejere styrer linkedin-tokens" on public.linkedin_tokens
  for all using (
    public.er_ejer(public.org_for_linkedin_token(customer_id, channel_id))
  ) with check (
    public.er_ejer(public.org_for_linkedin_token(customer_id, channel_id))
  );

-- ---------------------------------------------------------------------
-- Bed PostgREST om at læse skemaet forfra.
--
-- Uden det svarer den nye tabel «Could not find the table in the schema
-- cache» i op til et minut — en fejl der ligner at migrationen ikke
-- virkede.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
