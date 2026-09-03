-- =====================================================================
-- Supabase-attrap til adskillelsestesten
--
-- Migrationerne regner med ting Supabase selv har: auth.users, auth.uid(),
-- storage.objects og rollen authenticated. En almindelig Postgres har dem
-- ikke, så her laves præcis nok af dem til at politikkerne kan afprøves.
--
-- Det er med vilje magert. Formålet er at afprøve VORES regler, ikke at
-- efterligne Supabase — og hver ting der findes her uden at være i brug,
-- er en ting testen kan lyve om.
--
-- Filen kører kun mod en engangsbase; se scripts/test-adskillelse.mjs.
-- =====================================================================

-- Rollerne må ikke fejle hvis basen genbruges.
do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null; end $$;

create extension if not exists pgcrypto;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- auth.uid() læser jwt-claims, som Supabase sætter per forespørgsel.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema public, storage to authenticated;
alter default privileges in schema public grant all on tables to authenticated;
