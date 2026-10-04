-- =====================================================================
-- Marketingstrategier: hvad kampagnen bygger paa
--
-- Arketypen er HVEM der skriver. Retningslinjerne er HVORDAN der skrives.
-- Der manglede et tredje spoergsmaal: HVAD er planen med de fem opslag
-- tilsammen.
--
-- Uden det svar bliver en serie fem varianter af samme opslag. Modellen
-- faar en brief og et antal, og den skriver den samme gode tekst fem
-- gange -- fordi intet i prompten siger at nummer to skal gribe det
-- anderledes an end nummer et.
--
-- Derfor to niveauer, og det er den vigtigste beslutning i denne fil:
--
--   niveau = 'kampagne'  én valgt per kampagne. Den bestemmer hvordan
--                        opslagene FORDELER sig: soejler, tragt, serie.
--   niveau = 'vinkel'    flere valgte. Det er grebene modellen skal
--                        fordele hen over opslagene -- PAS, case, how-to.
--
-- Havde vi kun haft ét niveau, skulle man vaelge mellem at styre helheden
-- og at styre det enkelte opslag. Det er to forskellige beslutninger, og
-- de traeffes af den samme person paa samme tid.
--
-- Teksterne er data og ikke kode, af samme grund som retningslinjerne
-- flyttede ud af koden i 0010: den dag en formulering ikke passer til
-- afsenderen, skal den kunne rettes uden en deploy.
-- =====================================================================

create table if not exists public.strategier (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,

  -- 'kampagne' eller 'vinkel'. Ingen enum-type: en ny slags strategi skal
  -- ikke kraeve en alter type i en migration.
  niveau          text not null check (niveau in ('kampagne', 'vinkel')),
  navn            text not null,
  -- Skydes ind i prompten som den staar. Skrevet som besked til modellen.
  beskrivelse     text not null,
  aktiv           boolean not null default true,
  sortering       int not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Navnet er kun entydigt inden for sit niveau. «Case» kan baade vaere en
  -- maade at fordele serien paa og et greb i ét opslag.
  unique (organisation_id, niveau, navn)
);

create index if not exists strategier_org_idx on public.strategier(organisation_id, niveau);

alter table public.campaigns
  add column if not exists strategi_id uuid references public.strategier(id) on delete set null,
  -- Vinklerne er en liste, og en liste kan ikke have en fremmednoegle.
  -- Slettes en vinkel, bliver dens id staaende her som en doed henvisning
  -- -- appen slaar op i de vinkler der findes, og en der ikke findes
  -- falder bare ud. Alternativet var en samletabel med en raekke per
  -- vinkel per kampagne, og den pris er ikke vaerd at betale for et felt
  -- der kun laeses samlet.
  add column if not exists vinkel_ids uuid[] not null default '{}';

comment on column public.campaigns.strategi_id is
  'Kampagnestrategien: hvordan opslagene fordeler sig. Null = ingen valgt.';
comment on column public.campaigns.vinkel_ids is
  'Vinkler modellen maa fordele over opslagene. Tom = modellen vaelger selv.';

-- ---------------------------------------------------------------------
-- Politikker: som arketyperne
-- ---------------------------------------------------------------------
-- Alle medlemmer laeser -- en godkender skal kunne se hvad opslaget var
-- taenkt som. Redaktoerer og ejere skriver.
alter table public.strategier enable row level security;

drop policy if exists "medlemmer ser strategier" on public.strategier;
create policy "medlemmer ser strategier" on public.strategier
  for select using (public.har_org_adgang(organisation_id));

drop policy if exists "redaktoerer styrer strategier" on public.strategier;
create policy "redaktoerer styrer strategier" on public.strategier
  for all using (public.kan_redigere(organisation_id))
  with check (public.kan_redigere(organisation_id));

-- ---------------------------------------------------------------------
-- Standardstrategierne
-- ---------------------------------------------------------------------
-- En tom liste er ikke et godt udgangspunkt. Ingen skriver femten
-- beskrivelser fra bunden foer de laver deres foerste kampagne, og
-- resultatet ville vaere at funktionen aldrig blev brugt.
--
-- security definer, fordi funktionen ogsaa kaldes fra en trigger i det
-- sekund organisationen oprettes -- der findes medlemsraekken endnu ikke,
-- og kan_redigere ville derfor sige nej til opretteren selv.
--
-- on conflict do nothing: koeres den igen, rettes intet. Har du skrevet
-- «Mytenedbrydning» om, skal en genkoersel ikke skrive den tilbage.
create or replace function public.saa_standardstrategier(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.strategier (organisation_id, niveau, navn, beskrivelse, sortering)
  values
    (p_org, 'kampagne', 'Indholdssøjler',
     'Fordel opslagene på søjler i stedet for at skrive det samme fem gange: omkring 40% faglig indsigt, 30% konkret case eller resultat, 20% bag om arbejdet, 10% personligt. Brug ikke samme søjle to gange i træk.', 10),
    (p_org, 'kampagne', 'Tragt',
     'Byg serien som en tragt. De første opslag skaber opmærksomhed og sælger ingenting. De midterste giver bevis: tal, cases, sammenligninger. De sidste beder om et konkret næste skridt. Kun det sidste opslag må indeholde en direkte opfordring til at tage kontakt.', 20),
    (p_org, 'kampagne', 'Serie med rød tråd',
     'Ét tema skåret i dele. Hvert opslag bygger videre på det forrige og skal stadig kunne læses alene af en der ikke så de andre. Gør det tydeligt hvor i forløbet vi er, uden at skrive «del 3 af 5».', 30),
    (p_org, 'kampagne', 'Challenger',
     'Reframe, bevis, vej frem. Start serien med at vende en udbredt antagelse i branchen på hovedet. Dokumentér derefter hvorfor den ikke holder. Slut med hvad man gør i stedet. Ubehaget skal være fagligt — du udfordrer en tankegang, ikke personer.', 40),
    (p_org, 'kampagne', 'Bevisstige',
     'Stigende konkretion hen over serien: først påstanden, så tallene bag, så en navngiven situation hvor det skete, og til sidst hvad man kan få hjælp til. Hvert opslag skal kunne efterprøves af den der læser det.', 50),

    (p_org, 'vinkel', 'PAS — problem, agitér, løsning',
     'Start ved problemet som læseren selv oplever det. Gør derefter konsekvensen konkret — hvad det koster at lade det ligge. Først til sidst løsningen. Agitationen skal være genkendelig, ikke skræmmende.', 10),
    (p_org, 'vinkel', 'AIDA',
     'Fang opmærksomheden i første linje, skab interesse med noget læseren ikke vidste, gør det relevant for netop hans situation, og slut med ét klart næste skridt.', 20),
    (p_org, 'vinkel', 'Før, efter, bro',
     'Beskriv situationen som den er nu. Beskriv så hvordan den ser ud når problemet er væk. Broen er det der forbinder de to — og den skal være konkret nok til at man kan se sig selv gå over den.', 30),
    (p_org, 'vinkel', 'Læseren er helten',
     'Læseren er hovedpersonen, ikke afsenderen. Du er den der har set problemet før og kan give en plan. Skriv «du» langt oftere end «vi».', 40),
    (p_org, 'vinkel', 'Jobs to be done',
     'Tag udgangspunkt i den opgave læseren faktisk skal have løst, ikke i det produkt der løser den. Beskriv opgaven så præcist at han tænker «det er lige nu jeg står med det».', 50),
    (p_org, 'vinkel', 'Holdning',
     'Skriv en påstand som en stor del af branchen er uenig i, og som du kan belægge. Ingen forbehold i første linje. Argumentet skal bære — en holdning uden belæg er bare støj.', 60),
    (p_org, 'vinkel', 'Case og tal',
     'Ét konkret forløb: udgangspunktet, det der blev gjort, og udfaldet med et tal på. Ingen anonyme superlativer — enten kan du sige hvad der skete, eller også er det ikke en case.', 70),
    (p_org, 'vinkel', 'Lær dem én ting',
     'Én afgrænset ting læseren kan bruge i morgen, forklaret færdigt. Hellere ét skridt hele vejen end fem skridt halvt.', 80),
    (p_org, 'vinkel', 'Mytenedbrydning',
     'Tag en antagelse alle nikker til, og vis hvorfor den ikke holder. Vær fair over for den du modsiger — stråmænd bliver gennemskuet.', 90),
    (p_org, 'vinkel', 'Det jeg tog fejl af',
     'En beslutning eller en antagelse du selv havde, som viste sig forkert, og hvad du gør anderledes nu. Det skal koste noget at skrive — ellers er det ikke troværdigt.', 100)
  on conflict (organisation_id, niveau, navn) do nothing;
$$;

-- Nye organisationer faar dem med det samme. Bo skal ikke skrive femten
-- beskrivelser foer han kan lave sin foerste kampagne.
create or replace function public.saa_strategier_ved_oprettelse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.saa_standardstrategier(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_saa_strategier on public.organisations;
create trigger organisations_saa_strategier
  after insert on public.organisations
  for each row execute function public.saa_strategier_ved_oprettelse();

-- Og de organisationer der allerede findes.
do $$
declare o uuid;
begin
  for o in select id from public.organisations loop
    perform public.saa_standardstrategier(o);
  end loop;
end $$;

notify pgrst, 'reload schema';
