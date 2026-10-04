-- =====================================================================
-- Sproget paa opslagene
--
-- «Skriv paa dansk» stod i retningslinjerne. Det var rigtigt saa laenge
-- appen skrev for danske kunder til danske foelgere, og forkert i det
-- oejeblik den skriver fagligt indhold paa LinkedIn, hvor raekkevidden
-- for en SAP-arkitekt er en helt anden paa engelsk.
--
-- Sproget hoerer ikke hjemme i retningslinjerne af to grunde. Det er et
-- valg man traeffer per kampagne og ikke én gang for alle. Og det er en
-- regel der ikke maa kunne redigeres vaek ved et uheld: skriver man sine
-- egne retningslinjer og glemmer linjen, faar man pludselig opslag paa
-- det sprog briefen tilfaeldigvis var skrevet paa.
--
-- Derfor staar det som sit eget felt, og prompten skriver kravet EFTER
-- retningslinjerne, saa det vinder over dem uanset hvad der staar.
--
-- To sprog og ikke en fri tekst: hver tilfoejelse koster en gennemgang af
-- kanalreglerne -- klichéerne og de almene vendinger i kanalregler.js er
-- skrevet sprog for sprog, og et sprog uden dem ville se ud til at blive
-- kontrolleret uden at blive det.
-- =====================================================================

alter table public.organisations
  add column if not exists sprog text not null default 'da'
    check (sprog in ('da', 'en'));

comment on column public.organisations.sprog is
  'Standardsproget for nye kampagner. Kampagnen kan afvige.';

alter table public.campaigns
  add column if not exists sprog text not null default 'da'
    check (sprog in ('da', 'en'));

comment on column public.campaigns.sprog is
  'Sproget opslagene skrives paa. Saettes ved oprettelsen fra organisationens standard.';

-- ---------------------------------------------------------------------
-- Visningen skal udlevere det nye felt
-- ---------------------------------------------------------------------
-- Samme faelde som i 0010: mine_organisationer lister sine kolonner
-- eksplicit, saa et felt tilfoejet til tabellen dukker ikke op af sig
-- selv -- og appen laeser organisationen gennem netop den visning.
--
-- security_invoker saettes igen. create or replace bevarer den, men det
-- er ikke vaerd at stole paa: bliver den slaaet fra, udleverer visningen
-- alle organisationer til enhver der er logget ind, og det kan ikke ses
-- ved at laese politikkerne.
create or replace view public.mine_organisationer as
select
  o.id,
  o.name,
  o.slug,
  o.plan,
  o.aktiv,
  m.rolle,
  (select count(*) from public.customers c where c.organisation_id = o.id) as antal_kunder,
  o.retningslinjer,
  o.sprog
from public.organisations o
join public.org_members m on m.org_id = o.id
where m.user_id = auth.uid();

alter view public.mine_organisationer set (security_invoker = on);

notify pgrst, 'reload schema';
