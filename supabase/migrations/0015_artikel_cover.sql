-- =====================================================================
-- Coverbilledet til artiklen
--
-- Artiklen har sit eget billede, og det er ikke et af opslagenes. Et
-- opslagsbillede er skaaret til et feed og skal kunne ses i en kvadrat;
-- et coverbillede staar bredt over en artikel og er det foerste man ser.
--
-- Briefen gemmes ved siden af selve billedet, af samme grund som paa
-- opslagene: den er skrevet af den der kendte artiklen, og den skal kunne
-- bruges igen naar billedet skal laves om. Uden den starter man forfra med
-- at finde ud af hvad billedet egentlig skulle vise.
-- =====================================================================

alter table public.campaigns
  add column if not exists artikel_billedbrief text,
  add column if not exists artikel_billede text;

comment on column public.campaigns.artikel_billedbrief is
  'Hvad coverbilledet skal vise. Foreslaaet sammen med artiklen.';
comment on column public.campaigns.artikel_billede is
  'URL til coverbilledet i storage. Null = der er intet.';

notify pgrst, 'reload schema';
