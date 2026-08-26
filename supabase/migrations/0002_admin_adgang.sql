-- =====================================================================
-- Fra brand_members til administrator-adgang.
--
-- Kampagneappen har ét adgangsniveau: administrator. Er man i app_admins,
-- kan man alt. Er man ikke, kan man ingenting — også hvis man skulle få
-- fingre i anon-nøglen, for det håndhæves i databasen og ikke i skærmbilledet.
--
-- Kunsten her er at ALLE eksisterende politikker fra 0001 kalder
-- has_brand_access(). Ved at omskrive den ene funktion flytter hele
-- adgangsmodellen sig, uden at en enkelt politik skal røres.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administratorer
-- ---------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- security definer, så funktionen kan læse app_admins uden at ramme
-- tabellens egen politik og lave uendelig rekursion.
create or replace function public.er_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.app_admins where user_id = auth.uid()
  );
$$;

drop policy if exists "admins ser admins" on public.app_admins;
create policy "admins ser admins" on public.app_admins
  for select using (public.er_admin());

-- ---------------------------------------------------------------------
-- Den ene funktion der flytter alt
-- ---------------------------------------------------------------------
-- Signaturen beholdes, så politikkerne fra 0001 virker uændret.
-- Brandet er ikke længere afgørende — administratorer ser alle kunder.
create or replace function public.has_brand_access(target_brand uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.er_admin();
$$;

-- ---------------------------------------------------------------------
-- brand_members bruges ikke længere
-- ---------------------------------------------------------------------
drop policy if exists "se eget medlemskab" on public.brand_members;
drop table if exists public.brand_members;

-- ---------------------------------------------------------------------
-- brands manglede insert og delete i 0001 — administratorer skal kunne
-- oprette og fjerne kunder, ikke kun rette dem.
-- ---------------------------------------------------------------------
drop policy if exists "medlemmer ser eget brand" on public.brands;
drop policy if exists "ejere redigerer eget brand" on public.brands;

create policy "admins styrer brands" on public.brands
  for all using (public.er_admin()) with check (public.er_admin());
