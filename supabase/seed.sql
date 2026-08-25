-- =====================================================================
-- Seed: de to første kunder.
-- Kør efter 0001_init.sql. Tilpas navne og farver til virkeligheden.
--
-- Bagefter: knyt din egen bruger til begge brands med
--   insert into brand_members (brand_id, user_id, role)
--   select id, '<din-auth-uid>', 'owner' from brands;
-- =====================================================================

insert into public.brands (slug, name, kind, colors, tone_of_voice, target_audience, description, guardrails)
values
  (
    'rengoring',
    'Rengøringsfirmaet',
    'business',
    '{"primary": "#0F6E5C", "secondary": "#FFFFFF", "accent": "#F2B705"}'::jsonb,
    'Jordnær og konkret. Ingen superlativer, ingen udråbstegn. Skriver som en fagperson der ved hvad et gulv kræver — ikke som et reklamebureau. Dansk, De-form aldrig.',
    'Erhvervskunder i Region Hovedstaden: kontorer 10-100 ansatte, ejendomsadministratorer, butikker. Beslutningstager er typisk kontorchef eller driftsansvarlig.',
    'Erhvervsrengøring med fast personale. Sælger på stabilitet og samme kontaktperson — ikke på pris.',
    'Aldrig prisløfter eller "billigst". Ingen påstande om certificeringer vi ikke har. Nævn aldrig konkurrenter. Ingen før/efter-billeder af kunders lokaler uden skriftlig accept.'
  ),
  (
    'idraetsforening',
    'Idrætsforeningen',
    'association',
    '{"primary": "#1E4FD8", "secondary": "#FFFFFF", "accent": "#FF5A36"}'::jsonb,
    'Varm og inkluderende. Korte sætninger. Taler til forældre og medlemmer som naboer, ikke som kunder. Må gerne være sjov. Bruger klubbens vi-form.',
    'Børnefamilier i lokalområdet, nuværende medlemmer, frivillige og forældre. Sekundært: lokale sponsorer.',
    'Lokal breddeidrætsforening med hold for børn og voksne. Lever af medlemmer og frivillige hænder.',
    'Aldrig billeder af børn uden forældresamtykke. Ingen resultater der udstiller enkeltpersoner negativt. Nævn altid at alle er velkomne uanset niveau.'
  );
