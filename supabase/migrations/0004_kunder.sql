-- =====================================================================
-- Kundeniveau: kunde → brand → kanal
--
-- Hidtil har brands gjort to ting på én gang: været kunden man har en
-- relation til, OG brandet der har en stemme. For Jammerbugt Rengøring er
-- det ikke samme ting — hundevask taler ikke som erhvervsrengøring, men
-- de deler kontaktperson, Business-portefølje og systemtoken.
--
-- Den vigtigste konsekvens er tokenet: et Meta-systemtoken hører til en
-- portefølje og tildeles de sider det skal dække. Ét token kan altså dække
-- alle tre Jammerbugt-sider. Derfor flytter det op på kunden, med mulighed
-- for at overstyre på den enkelte kanal.
--
-- Migrationen er additiv og kan køres på en database med data i: hvert
-- eksisterende brand får sin egen kunde, så intet peger i ingenting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kunder
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,

  -- Aftalen
  kontakt_navn     text,
  kontakt_mail     text,
  kontakt_telefon  text,
  aftale           text,   -- fx "4 opslag om måneden, fordelt på de tre sider"
  godkender        text,   -- hvem hos kunden siger god for opslag

  -- Meta-opsætning, samlet ét sted
  meta_portefoelje_id text,
  meta_systembruger   text,
  -- Fælles token. Kanalens eget token vinder, hvis det er sat.
  token_ciphertext    text,
  token_label         text,
  token_testet_at     timestamptz,
  token_fejl          text,

  -- Forbehold der gælder hele kunden, ikke kun ét brand
  samtykke      text,   -- hvem har givet samtykke til billeder
  guardrails    text,   -- lægges oven i brandets egen må-ikke-liste
  noter         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- brands hænger nu på en kunde
-- ---------------------------------------------------------------------
alter table public.brands
  add column if not exists customer_id uuid references public.customers(id) on delete cascade;

-- Hvert eksisterende brand bliver sin egen kunde. Er der flere brands der
-- reelt hører sammen, flyttes de bagefter i appen — det er en beslutning,
-- ikke noget en migration kan gætte.
insert into public.customers (slug, name, guardrails)
select b.slug, b.name, null
from public.brands b
where b.customer_id is null
  and not exists (select 1 from public.customers c where c.slug = b.slug);

update public.brands b
set customer_id = c.id
from public.customers c
where b.customer_id is null and c.slug = b.slug;

-- ---------------------------------------------------------------------
-- Fælles billedarkiv
-- ---------------------------------------------------------------------
-- Et billede hører enten til ét brand eller til hele kunden. Firmabiler og
-- medarbejdere passer til både rengøring og vaskeri; et brandet opslag gør
-- ikke. Derfor må præcis én af de to være sat.
alter table public.assets
  add column if not exists customer_id uuid references public.customers(id) on delete cascade;

alter table public.assets alter column brand_id drop not null;

alter table public.assets drop constraint if exists assets_ejer_check;
alter table public.assets
  add constraint assets_ejer_check
  check ((brand_id is not null) <> (customer_id is not null));

create index if not exists assets_customer_idx on public.assets(customer_id);
create index if not exists brands_customer_idx on public.brands(customer_id);

-- ---------------------------------------------------------------------
-- Adgang: samme regel som alt andet — administratorer, håndhævet i basen
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;

drop policy if exists "admins styrer kunder" on public.customers;
create policy "admins styrer kunder" on public.customers
  for all using (public.er_admin()) with check (public.er_admin());

-- drop først: kører migrationen halvvejs og bliver kørt igen, ville et
-- create trigger uden dette fejle på at triggeren allerede findes — og så
-- ville migrationen aldrig blive markeret som gennemført.
drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Hjælpevisning: hvilket token gælder for en kanal?
--
-- Så både appen og funktionerne læser reglen ét sted, i stedet for at
-- gentage "kanalens eget, ellers kundens" hver gang.
-- ---------------------------------------------------------------------
create or replace view public.kanal_med_token as
select
  ch.*,
  b.customer_id,
  cu.name as kunde_navn,
  coalesce(ch.token_ciphertext, cu.token_ciphertext) as gaeldende_token,
  case
    when ch.token_ciphertext is not null then 'kanal'
    when cu.token_ciphertext is not null then 'kunde'
    else null
  end as token_kilde
from public.channels ch
join public.brands b on b.id = ch.brand_id
left join public.customers cu on cu.id = b.customer_id;

-- ---------------------------------------------------------------------
-- Bed PostgREST om at læse skemaet forfra.
--
-- Supabases API-lag holder et cachet billede af skemaet. Uden det her kan
-- en ny tabel svare "Could not find the table in the schema cache" i op til
-- et minut efter migrationen — en fejl der ligner at migrationen ikke virkede.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

