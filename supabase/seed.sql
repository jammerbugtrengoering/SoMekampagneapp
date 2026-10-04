-- =====================================================================
-- Seed: to kunder med hver sit brand, til at have noget at se på.
--
-- Den gamle udgave af filen indsatte kun brands, fordi den blev skrevet
-- da modellen stoppede der. Migration 0004 lagde en kunde ind over, og
-- 0005 en organisation over den igen -- og de to migrationer udleder
-- kunder og organisationer af de brands der ALLEREDE fandtes. Kørte man
-- db:setup forfra, kom seedens brands derfor for sent til festen og
-- endte uden kunde. De var usynlige i appen, for RLS går fra brand til
-- kunde til organisation, og den kæde manglede sit første led.
--
-- Filen her bygger hele kæden selv og kan køres igen uden at duplikere.
--
-- Men den køres kun ÉN gang: setup-db.mjs noterer den i
-- schema_migrations bagefter. Ellers ville demokunderne komme tilbage
-- hver gang db:setup blev kørt — også dem man havde slettet med vilje.
-- At reparere en skæv base er en migrations opgave, ikke en seeds.
--
-- Organisationen gættes ikke. Findes der præcis én, bruges den. Findes
-- der ingen, laves «Demo». Findes der flere, rører seeden ingenting --
-- at vælge forkert ville give en organisation adgang til en andens
-- kunde, og den fejl skal en seed ikke kunne lave.
-- =====================================================================

do $$
declare
  v_org             uuid;
  v_antal_orgs      int;
  v_kunde_reng      uuid;
  v_kunde_forening  uuid;
begin
  select count(*) into v_antal_orgs from public.organisations;

  if v_antal_orgs > 1 then
    raise notice 'Seed sprunget over: der er % organisationer, og seeden gætter ikke hvilken.', v_antal_orgs;
    return;
  elsif v_antal_orgs = 1 then
    select id into v_org from public.organisations;
  else
    insert into public.organisations (slug, name) values ('demo', 'Demo')
    returning id into v_org;
  end if;

  -- ---------------------------------------------------------------
  -- Kunderne
  -- ---------------------------------------------------------------
  insert into public.customers (slug, name, organisation_id, guardrails)
  values
    ('rengoringsfirmaet', 'Rengøringsfirmaet', v_org,
     'Aldrig prisløfter eller "billigst". Ingen påstande om certificeringer vi ikke har.'),
    ('idraetsforeningen', 'Idrætsforeningen', v_org,
     'Aldrig billeder af børn uden forældresamtykke.')
  on conflict (slug) do nothing;

  select id into v_kunde_reng     from public.customers where slug = 'rengoringsfirmaet';
  select id into v_kunde_forening from public.customers where slug = 'idraetsforeningen';

  -- ---------------------------------------------------------------
  -- Brands
  -- ---------------------------------------------------------------
  -- Kundens må-ikke-liste står ovenfor og gælder alle dens brands.
  -- Her står kun det der er brandets eget.
  insert into public.brands
    (slug, name, kind, customer_id, colors, tone_of_voice, target_audience, description, guardrails)
  values
    (
      'rengoring',
      'Erhvervsrengøring',
      'business',
      v_kunde_reng,
      '{"primary": "#0F6E5C", "secondary": "#FFFFFF", "accent": "#F2B705"}'::jsonb,
      'Jordnær og konkret. Ingen superlativer, ingen udråbstegn. Skriver som en fagperson der ved hvad et gulv kræver — ikke som et reklamebureau. Dansk, De-form aldrig.',
      'Erhvervskunder i Region Hovedstaden: kontorer 10-100 ansatte, ejendomsadministratorer, butikker. Beslutningstager er typisk kontorchef eller driftsansvarlig.',
      'Erhvervsrengøring med fast personale. Sælger på stabilitet og samme kontaktperson — ikke på pris.',
      'Nævn aldrig konkurrenter. Ingen før/efter-billeder af kunders lokaler uden skriftlig accept.'
    ),
    (
      'idraetsforening',
      'Idrætsforeningen',
      'association',
      v_kunde_forening,
      '{"primary": "#1E4FD8", "secondary": "#FFFFFF", "accent": "#FF5A36"}'::jsonb,
      'Varm og inkluderende. Korte sætninger. Taler til forældre og medlemmer som naboer, ikke som kunder. Må gerne være sjov. Bruger klubbens vi-form.',
      'Børnefamilier i lokalområdet, nuværende medlemmer, frivillige og forældre. Sekundært: lokale sponsorer.',
      'Lokal breddeidrætsforening med hold for børn og voksne. Lever af medlemmer og frivillige hænder.',
      'Ingen resultater der udstiller enkeltpersoner negativt. Nævn altid at alle er velkomne uanset niveau.'
    )
  on conflict (slug) do nothing;

end $$;
