-- =====================================================================
-- Afsenderroller, og retningslinjer der kan rettes
--
-- Retningslinjerne stod i koden. Det var fint da appen skrev for en
-- rengoeringsvirksomhed og en idraetsforening, og forkert i det
-- oejeblik den ogsaa skal skrive for en loesningsarkitekt: «skriv som
-- et menneske fra virksomheden» betyder noget andet naar afsenderen ER
-- mennesket.
--
-- To ting foelger af det.
--
-- Arketypen er HVEM der skriver og med hvilken ret. Den samme viden kan
-- fortaelles af en der har bygget det, en der har ryddet op efter det,
-- og en der ikke tror paa det -- og det giver tre forskellige opslag.
-- Derfor er den et valg per kampagne og ikke et felt paa brandet.
--
-- Retningslinjerne er HVORDAN der skrives. De faar en standard paa
-- organisationen og kan afviges for en enkelt kampagne, saa et forsoeg
-- ikke koster en aendring af standarden.
-- =====================================================================

create table if not exists public.arketyper (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,

  navn            text not null,
  -- Selve teksten der skydes ind i prompten. Skrevet i anden person:
  -- «Du er loesningsarkitekt og har siddet i fem S/4-implementeringer.»
  beskrivelse     text not null,
  aktiv           boolean not null default true,
  sortering       int not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organisation_id, navn)
);

create index if not exists arketyper_org_idx on public.arketyper(organisation_id);

-- Organisationens egen udgave af retningslinjerne. Null betyder «brug
-- den indbyggede» -- ikke «ingen retningslinjer».
alter table public.organisations
  add column if not exists retningslinjer text;

comment on column public.organisations.retningslinjer is
  'Erstatter de indbyggede retningslinjer. Null = brug de indbyggede.';

alter table public.campaigns
  add column if not exists arketype_id uuid references public.arketyper(id) on delete set null,
  add column if not exists retningslinjer text;

comment on column public.campaigns.retningslinjer is
  'Afvigelse for netop denne kampagne. Null = brug organisationens.';

-- ---------------------------------------------------------------------
-- Politikker
-- ---------------------------------------------------------------------
-- Laesning for alle medlemmer: en godkender skal kunne se hvilken rolle
-- et opslag er skrevet i, for at kunne vurdere det.
--
-- Skrivning for redaktoerer og ejere. En arketype er indhold, ikke
-- adgang -- den aabner ingen doere, og den der skriver opslagene er ogsaa
-- den der ved hvilke roller der mangler.
alter table public.arketyper enable row level security;

drop policy if exists "medlemmer ser arketyper" on public.arketyper;
create policy "medlemmer ser arketyper" on public.arketyper
  for select using (public.har_org_adgang(organisation_id));

drop policy if exists "redaktoerer styrer arketyper" on public.arketyper;
create policy "redaktoerer styrer arketyper" on public.arketyper
  for all using (public.kan_redigere(organisation_id))
  with check (public.kan_redigere(organisation_id));

-- ---------------------------------------------------------------------
-- Visningen skal udlevere det nye felt
-- ---------------------------------------------------------------------
-- mine_organisationer lister sine kolonner eksplicit. Et felt tilfoejet
-- til tabellen dukker derfor ikke op af sig selv -- og appen laeser
-- organisationen gennem netop den visning.
--
-- security_invoker saettes igen. create or replace bevarer den, men det
-- er ikke vaerd at stole paa: bliver den slaaet fra, udleverer visningen
-- alle organisationer til enhver der er logget ind, og det kan ikke ses
-- ved at laese politikkerne. Det var praecis fejlen 0005 lukkede, og
-- adskillelse.sql holder oeje med at den bliver ved med at vaere lukket.
create or replace view public.mine_organisationer as
select
  o.id,
  o.name,
  o.slug,
  o.plan,
  o.aktiv,
  m.rolle,
  (select count(*) from public.customers c where c.organisation_id = o.id) as antal_kunder,
  o.retningslinjer
from public.organisations o
join public.org_members m on m.org_id = o.id
where m.user_id = auth.uid();

alter view public.mine_organisationer set (security_invoker = on);

notify pgrst, 'reload schema';
