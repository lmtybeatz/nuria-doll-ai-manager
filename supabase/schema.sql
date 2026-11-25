-- NURIA DOLL AI MANAGER — Phase 1 schema
-- IMPORTANT: execute uniquement dans un NOUVEAU projet Supabase dédié.
-- Ne pas exécuter dans le projet Supabase du site public NURIA DOLL.

create extension if not exists pgcrypto;

create table if not exists public.ai_brand_profile (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  artist_name text not null default 'Mon artiste',
  genre text,
  bio text,
  target_audience text,
  language text default 'Français',
  tone text,
  parent_guardrails text,
  primary_color text default '#6D45A6',
  secondary_color text default '#E8B9D4',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  primary_goal text not null default 'community' check (primary_goal in ('community','music','awareness','traffic')),
  planning_horizon integer not null default 30 check (planning_horizon in (7,14,30)),
  autonomy_mode text not null default 'draft_only' check (autonomy_mode in ('parent_guarded','draft_only')),
  monthly_budget_usd numeric(8,2) not null default 5 check (monthly_budget_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_media_library (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  category text not null default 'document' check (category in ('image','video','audio','document')),
  description text,
  created_at timestamptz not null default now()
);

alter table public.ai_brand_profile enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_media_library enable row level security;

drop policy if exists "Owner manages own brand profile" on public.ai_brand_profile;
create policy "Owner manages own brand profile" on public.ai_brand_profile
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owner manages own AI settings" on public.ai_settings;
create policy "Owner manages own AI settings" on public.ai_settings
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owner manages own media metadata" on public.ai_media_library;
create policy "Owner manages own media metadata" on public.ai_media_library
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Bucket privé : les fichiers ne sont pas accessibles publiquement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nuria-private-media', 'nuria-private-media', false, 104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/wav','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 104857600;

drop policy if exists "Owner uploads to own media folder" on storage.objects;
create policy "Owner uploads to own media folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'nuria-private-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner reads own media folder" on storage.objects;
create policy "Owner reads own media folder" on storage.objects
  for select to authenticated using (
    bucket_id = 'nuria-private-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner deletes own media folder" on storage.objects;
create policy "Owner deletes own media folder" on storage.objects
  for delete to authenticated using (
    bucket_id = 'nuria-private-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Aucun accès anonyme aux tables ou au bucket.
revoke all on public.ai_brand_profile from anon;
revoke all on public.ai_settings from anon;
revoke all on public.ai_media_library from anon;
grant select, insert, update, delete on public.ai_brand_profile to authenticated;
grant select, insert, update, delete on public.ai_settings to authenticated;
grant select, insert, update, delete on public.ai_media_library to authenticated;
