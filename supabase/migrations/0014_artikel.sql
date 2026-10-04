-- =====================================================================
-- Artiklen: serien samlet til ét stykke
--
-- Opslagene i en kampagne er brudstykker af én pointe, skaaret op saa de
-- kan staa alene i et feed. Det der forsvinder i den opskaering, er
-- sammenhaengen -- og den er tit det mest vaerdifulde.
--
-- LinkedIns artikelplatform kan ikke skrives til gennem API'et. Posts API
-- kan tekst, billeder, video, dokumenter og LINKS til artikler, men ikke
-- den native «Write article». Derfor gemmes artiklen her og kopieres
-- derfra ind i LinkedIns egen editor.
--
-- Det er ogsaa grunden til at den ikke er en raekke i posts: den bliver
-- aldrig publiceret af appen, den har ingen kanal, intet tidspunkt og
-- ingen godkendelse. Et felt paa kampagnen fortaeller sandheden om hvad
-- det er -- et arbejdsdokument, ikke et opslag der venter.
-- =====================================================================

alter table public.campaigns
  add column if not exists artikel text,
  add column if not exists artikel_opdateret timestamptz;

comment on column public.campaigns.artikel is
  'Serien samlet til en artikel. Kopieres manuelt ind i LinkedIns editor.';
comment on column public.campaigns.artikel_opdateret is
  'Hvornaar artiklen sidst blev skrevet. Null = der er ingen.';

notify pgrst, 'reload schema';
