-- =====================================================================
-- De unikke indeks skal kunne rammes af ON CONFLICT
--
-- 0006 lavede dem partielle -- «where customer_id is not null» -- fordi
-- en raekke hoerer enten til en kunde eller til en kanal, aldrig begge.
-- Det er rigtigt taenkt og forkert bygget: Postgres kan ikke bruge et
-- partielt indeks til ON CONFLICT (customer_id), medmindre kaldet
-- gentager praecis samme praedikat -- og det kan PostgREST ikke sende.
--
-- Resultatet var at OAuth-flowet naaede hele vejen igennem, hentede
-- tokenet, og saa faldt paa at gemme det:
--   «there is no unique or exclusion constraint matching the ON CONFLICT»
--
-- Loesningen er at droppe praedikatet. Et almindeligt unikt indeks
-- tillader flere NULL'er -- Postgres regner NULL'er for forskellige -- saa
-- kanalraekkerne kan stadig ligge side om side med customer_id tom, og
-- omvendt. Reglen om at praecis EEN af de to skal vaere sat staar
-- uaendret i check-constrainten fra 0006; den er stadig det der
-- haandhaever modellen.
-- =====================================================================

drop index if exists public.linkedin_tokens_kunde_idx;
drop index if exists public.linkedin_tokens_kanal_idx;

create unique index if not exists linkedin_tokens_kunde_idx
  on public.linkedin_tokens(customer_id);

create unique index if not exists linkedin_tokens_kanal_idx
  on public.linkedin_tokens(channel_id);

notify pgrst, 'reload schema';
