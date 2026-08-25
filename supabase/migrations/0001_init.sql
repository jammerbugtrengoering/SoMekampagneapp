-- =====================================================================
-- Kampagneapp — grundskema
-- Multi-tenant fra dag ét: alt hænger på brand_id, og adgang styres af
-- brand_members. Selv med én bruger i dag koster det ingenting at have
-- rigtigt, og det sparer en smertefuld migrering senere.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Brands (kunder)
-- ---------------------------------------------------------------------
create table public.brands (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  kind           text not null default 'business'
                 check (kind in ('business', 'association')),
  logo_url       text,
  -- {"primary": "#0a5", "secondary": "#fff", "accent": "#f60"}
  colors         jsonb not null default '{}'::jsonb,
  tone_of_voice  text,
  target_audience text,
  description    text,
  -- Ting Claude aldrig må skrive: konkurrentnavne, forbudte påstande osv.
  guardrails     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Adgang
-- ---------------------------------------------------------------------
create table public.brand_members (
  brand_id  uuid not null references public.brands(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'editor'
            check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create index brand_members_user_idx on public.brand_members(user_id);

-- ---------------------------------------------------------------------
-- Kanaler — én række pr. sted vi kan publicere
-- Tokens ligger krypteret (AES-256-GCM, se src/lib/crypto.ts). Databasen
-- alene er derfor ikke nok til at overtage kundens side.
-- ---------------------------------------------------------------------
create table public.channels (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  platform         text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  display_name     text not null,
  -- Facebook Page ID. Instagram hænger altid på en side, så den udfyldes også for IG.
  page_id          text,
  -- Instagram Business Account ID (hentes via /{page-id}?fields=instagram_business_account)
  ig_user_id       text,
  token_ciphertext text,
  -- Fx "system-user 2026-08" så du kan se hvilket token der sidder hvor
  token_label      text,
  active           boolean not null default true,
  last_verified_at timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  unique (brand_id, platform, page_id)
);

create index channels_brand_idx on public.channels(brand_id);

-- ---------------------------------------------------------------------
-- Billedarkiv — kundens egne fotos + AI-genererede
-- Bucket skal være public: Meta henter selv billedet fra URL'en, og
-- Graph API kan ikke logge ind.
-- ---------------------------------------------------------------------
create table public.assets (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  url        text not null,
  storage_path text,
  source     text not null default 'upload' check (source in ('upload', 'ai', 'template')),
  alt_text   text,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index assets_brand_idx on public.assets(brand_id);

-- ---------------------------------------------------------------------
-- Kampagner
-- ---------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  brief       text,
  goal        text,
  starts_on   date,
  ends_on     date,
  status      text not null default 'draft'
              check (status in ('draft', 'active', 'done', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index campaigns_brand_idx on public.campaigns(brand_id);

-- ---------------------------------------------------------------------
-- Opslag
-- ---------------------------------------------------------------------
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  body          text not null,
  hashtags      text[] not null default '{}',
  -- Beskrivelse af hvilket billede der skal laves. Bliver til prompt eller
  -- til en besked til kunden om hvilket foto de skal sende.
  image_brief   text,
  asset_id      uuid references public.assets(id) on delete set null,
  image_url     text,
  scheduled_at  timestamptz,
  status        text not null default 'draft'
                check (status in ('draft', 'needs_approval', 'approved', 'publishing', 'published', 'failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index posts_brand_idx on public.posts(brand_id);
create index posts_campaign_idx on public.posts(campaign_id);
create index posts_schedule_idx on public.posts(status, scheduled_at);

-- ---------------------------------------------------------------------
-- Ét opslag kan gå til flere kanaler, og hver kanal kan fejle for sig.
-- Derfor er publiceringsstatus per (post, channel) — ikke per post.
-- ---------------------------------------------------------------------
create table public.post_targets (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  channel_id   uuid not null references public.channels(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'publishing', 'published', 'failed', 'skipped')),
  -- ID'et Meta giver retur, så vi kan linke til det publicerede opslag
  external_id  text,
  permalink    text,
  error        text,
  attempts     int not null default 0,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (post_id, channel_id)
);

create index post_targets_status_idx on public.post_targets(status);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.brands        enable row level security;
alter table public.brand_members enable row level security;
alter table public.channels      enable row level security;
alter table public.assets        enable row level security;
alter table public.campaigns     enable row level security;
alter table public.posts         enable row level security;
alter table public.post_targets  enable row level security;

-- Hjælpefunktion: har den aktuelle bruger adgang til brandet?
-- security definer, så den kan læse brand_members uden at ramme
-- brand_members' egen politik og lave uendelig rekursion.
create or replace function public.has_brand_access(target_brand uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.brand_members
    where brand_id = target_brand
      and user_id = auth.uid()
  );
$$;

create policy "medlemmer ser eget brand" on public.brands
  for select using (public.has_brand_access(id));
create policy "ejere redigerer eget brand" on public.brands
  for update using (public.has_brand_access(id));

create policy "se eget medlemskab" on public.brand_members
  for select using (user_id = auth.uid());

create policy "kanaler via brand" on public.channels
  for all using (public.has_brand_access(brand_id))
  with check (public.has_brand_access(brand_id));

create policy "assets via brand" on public.assets
  for all using (public.has_brand_access(brand_id))
  with check (public.has_brand_access(brand_id));

create policy "kampagner via brand" on public.campaigns
  for all using (public.has_brand_access(brand_id))
  with check (public.has_brand_access(brand_id));

create policy "opslag via brand" on public.posts
  for all using (public.has_brand_access(brand_id))
  with check (public.has_brand_access(brand_id));

create policy "targets via opslag" on public.post_targets
  for all using (
    exists (
      select 1 from public.posts p
      where p.id = post_targets.post_id
        and public.has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_targets.post_id
        and public.has_brand_access(p.brand_id)
    )
  );

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brands_touch    before update on public.brands
  for each row execute function public.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();
create trigger posts_touch     before update on public.posts
  for each row execute function public.touch_updated_at();
