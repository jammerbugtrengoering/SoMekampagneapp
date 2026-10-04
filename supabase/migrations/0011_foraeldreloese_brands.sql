-- =====================================================================
-- Reparation hoerer i en migration, ikke i en seed
--
-- Seeden blev tidligere sat til altid at koere, saa den kunne samle
-- brands op der laa uden kunde. Det virkede -- og havde en pris jeg ikke
-- havde taenkt igennem: hver gang db:setup blev koert, kom demokunderne
-- tilbage. Ogsaa dem man havde slettet med vilje.
--
-- Det er to forskellige opgaver. En migration retter noget der ER galt i
-- en eksisterende base, een gang. En seed laver demodata paa en tom base,
-- ogsaa een gang. Kun den foerste hoerer hjemme her.
--
-- Denne migration goer det seeden gjorde, men som en migration: den
-- koerer een gang, noteres i schema_migrations, og genskaber ingenting.
-- =====================================================================

do $$
declare
  v_org   uuid;
  v_antal int;
begin
  select count(*) into v_antal from public.brands where customer_id is null;
  if v_antal = 0 then return; end if;

  -- Uden praecis een organisation kan vi ikke gaette hvor de hoerer til,
  -- og at gaette forkert ville give en organisation adgang til en andens
  -- indhold. Saa siger vi det hoejt og lader dem ligge.
  select id into v_org from public.organisations;
  if v_org is null or (select count(*) from public.organisations) > 1 then
    raise notice
      'Springer over: % brand(s) uden kunde, men organisationen kan ikke afgoeres. Flyt dem i appen.',
      v_antal;
    return;
  end if;

  -- Hvert foraeldreloest brand faar sin egen kunde, opkaldt efter brandet.
  -- Samme valg som 0004 traf: at samle dem er en beslutning, ikke noget en
  -- migration kan regne ud.
  insert into public.customers (slug, name, organisation_id)
  select b.slug, b.name, v_org
  from public.brands b
  where b.customer_id is null
    and not exists (select 1 from public.customers c where c.slug = b.slug);

  update public.brands b
  set customer_id = c.id
  from public.customers c
  where b.customer_id is null and c.slug = b.slug;

  raise notice '% brand(s) uden kunde fik en kunde.', v_antal;
end $$;

notify pgrst, 'reload schema';
