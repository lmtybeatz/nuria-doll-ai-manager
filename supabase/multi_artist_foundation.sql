-- NURIA DOLL AI MANAGER — Fondation multi-artistes (Phase 1)
-- Migration additive et rétrocompatible : les tables historiques restent intactes.
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à l'AI Manager.
-- Ne pas exécuter dans le projet Supabase du site public NURIA DOLL.
--
-- Cette migration :
-- 1) crée le répertoire d'artistes par gestionnaire ;
-- 2) copie le profil historique dans le nouveau modèle sans le supprimer ;
-- 3) rattache les campagnes, médias, validations et recommandations existants
--    à l'artiste principal ;
-- 4) conserve les politiques RLS fondées sur owner_id.

create extension if not exists pgcrypto;

create table if not exists public.ai_artists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_name text not null check (char_length(trim(artist_name)) between 1 and 120),
  slug text,
  status text not null default 'active'
    check (status in ('active','paused','archived')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index if not exists ai_artists_owner_name_unique
  on public.ai_artists (owner_id, lower(artist_name));
create unique index if not exists ai_artists_one_default_per_owner
  on public.ai_artists (owner_id) where is_default = true;
create index if not exists ai_artists_owner_created_idx
  on public.ai_artists (owner_id, created_at);

create table if not exists public.ai_artist_profiles (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null unique references public.ai_artists(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  genre text,
  bio text,
  target_audience text,
  language text default 'Français',
  tone text,
  parent_guardrails text,
  primary_color text default '#6D45A6',
  secondary_color text default '#E8B9D4',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, owner_id)
);

-- Reprise du profil historique : aucune suppression ni modification de ai_brand_profile.
insert into public.ai_artists (owner_id, artist_name, is_default)
select p.owner_id, coalesce(nullif(trim(p.artist_name), ''), 'Artiste sans nom'), true
from public.ai_brand_profile p
where not exists (
  select 1 from public.ai_artists a
  where a.owner_id = p.owner_id and a.is_default = true
)
on conflict do nothing;

insert into public.ai_artist_profiles
  (artist_id, owner_id, genre, bio, target_audience, language, tone,
   parent_guardrails, primary_color, secondary_color, created_at, updated_at)
select a.id, p.owner_id, p.genre, p.bio, p.target_audience, p.language, p.tone,
       p.parent_guardrails, p.primary_color, p.secondary_color, p.created_at, p.updated_at
from public.ai_brand_profile p
join public.ai_artists a on a.owner_id = p.owner_id and a.is_default = true
where not exists (
  select 1 from public.ai_artist_profiles ap where ap.artist_id = a.id
);

-- Ajout non destructif de la clé artiste aux ressources déjà présentes.
alter table public.ai_marketing_campaigns
  add column if not exists artist_id uuid references public.ai_artists(id) on delete set null;
alter table public.ai_media_library
  add column if not exists artist_id uuid references public.ai_artists(id) on delete set null;
alter table public.ai_parent_approvals
  add column if not exists artist_id uuid references public.ai_artists(id) on delete set null;
alter table public.ai_marketing_recommendations
  add column if not exists artist_id uuid references public.ai_artists(id) on delete set null;

-- Rattachement des éléments historiques à l'artiste principal du gestionnaire.
update public.ai_marketing_campaigns c
set artist_id = a.id
from public.ai_artists a
where c.owner_id = a.owner_id and a.is_default = true and c.artist_id is null;

update public.ai_media_library m
set artist_id = a.id
from public.ai_artists a
where m.owner_id = a.owner_id and a.is_default = true and m.artist_id is null;

update public.ai_parent_approvals p
set artist_id = a.id
from public.ai_artists a
where p.owner_id = a.owner_id and a.is_default = true and p.artist_id is null;

update public.ai_marketing_recommendations r
set artist_id = a.id
from public.ai_artists a
where r.owner_id = a.owner_id and a.is_default = true and r.artist_id is null;

create index if not exists ai_campaigns_artist_updated_idx
  on public.ai_marketing_campaigns (artist_id, updated_at desc);
create index if not exists ai_media_artist_created_idx
  on public.ai_media_library (artist_id, created_at desc);
create index if not exists ai_approvals_artist_created_idx
  on public.ai_parent_approvals (artist_id, created_at desc);
create index if not exists ai_recommendations_artist_created_idx
  on public.ai_marketing_recommendations (artist_id, created_at desc);

alter table public.ai_artists enable row level security;
alter table public.ai_artist_profiles enable row level security;

drop policy if exists "Manager manages own artists" on public.ai_artists;
create policy "Manager manages own artists" on public.ai_artists
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Manager manages own artist profiles" on public.ai_artist_profiles;
create policy "Manager manages own artist profiles" on public.ai_artist_profiles
  for all to authenticated
  using (
    auth.uid() = owner_id and exists (
      select 1 from public.ai_artists a
      where a.id = artist_id and a.owner_id = auth.uid()
    )
  )
  with check (
    auth.uid() = owner_id and exists (
      select 1 from public.ai_artists a
      where a.id = artist_id and a.owner_id = auth.uid()
    )
  );

revoke all on public.ai_artists from anon;
revoke all on public.ai_artist_profiles from anon;
grant select, insert, update, delete on public.ai_artists to authenticated;
grant select, insert, update, delete on public.ai_artist_profiles to authenticated;

-- Vérification rapide après exécution :
-- select id, artist_name, is_default from public.ai_artists order by created_at;
-- select artist_id, owner_id, artist_name from public.ai_artist_profiles
-- join public.ai_artists using (artist_id);
