-- =====================================================================
-- Fem ting der skal goere teksterne bedre
--
-- Den stoerste er den foerste, og den er ikke en prompt: appen gemmer i
-- dag kun den godkendte tekst. Den ved altsaa ikke hvad modellen skrev,
-- og kan derfor aldrig laere af forskellen. Efter tyve opslag ville
-- diffen mellem forslag og godkendt vaere det bedste materiale der
-- findes til at ramme stemmen -- men kun hvis vi begynder at gemme den
-- NU. Data man ikke har opsamlet, kan man ikke gaa tilbage og hente.
--
-- Resten hjaelper modellen foer den skriver, frem for bagefter.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hvad modellen foreslog
-- ---------------------------------------------------------------------
-- Saettes een gang, ved oprettelsen, og roeres aldrig igen. Er den lig
-- body, har du ikke rettet noget -- og saa ramte den plet.
alter table public.posts
  add column if not exists body_original text,
  add column if not exists hashtags_original text[];

comment on column public.posts.body_original is
  'Teksten som modellen skrev den. Aendres aldrig. Forskellen til body er '
  'det materiale kommende kampagner laerer stemmen af.';

-- To kroge, saa godkendelse bliver et valg frem for et ja/nej. Valget er
-- samtidig det billigste signal vi kan opsamle om hvad der virker.
alter table public.posts
  add column if not exists krog_alt text;

comment on column public.posts.krog_alt is
  'Alternativ foerste linje. Vaelges den, skrives den ind i body.';

-- ---------------------------------------------------------------------
-- Brandet: eksempler slaar beskrivelser
-- ---------------------------------------------------------------------
-- tone_of_voice er et adjektivfelt, og «jordnaer og konkret» kan betyde
-- hvad som helst. Tre rigtige opslag rammer stemmen bedre end nogen
-- beskrivelse: modeller imiterer bedre end de adlyder.
alter table public.brands
  add column if not exists eksempel_opslag text;

comment on column public.brands.eksempel_opslag is
  'To-tre rigtige opslag kunden selv er glad for. Sendes med som eksempler.';

-- Maalgruppen beskrives i dag kun som hvem den er. Det der styrer
-- teksten, er hvad den allerede ved -- og hvad den er traet af at hoere.
-- Afstanden mellem indforstaaet og banal er lille i et fagligt felt.
alter table public.brands
  add column if not exists maalgruppe_ved text,
  add column if not exists maalgruppe_undgaa text;

comment on column public.brands.maalgruppe_ved is
  'Hvad maalgruppen allerede ved. Skal ikke forklares forfra.';
comment on column public.brands.maalgruppe_undgaa is
  'Hvad de er traette af at hoere. Vinkler der er brugt op.';

notify pgrst, 'reload schema';
