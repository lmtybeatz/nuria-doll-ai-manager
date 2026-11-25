-- Multi-artist research dossier foundation.
-- Apply only to the dedicated AI MUSIC MANAGER Supabase project.
-- This migration is additive and does not alter the public NURIA DOLL website.

create table if not exists public.ai_artist_research (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  research_type text not null default 'artist_profile'
    check (research_type in ('artist_profile','discography','release_history','market_scan')),
  subject_name text not null,
  status text not null default 'completed'
    check (status in ('completed','partial','failed')),
  queries jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  source_count integer not null default 0 check (source_count >= 0),
  notes text,
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ai_artist_research_owner_artist_date_idx
  on public.ai_artist_research (owner_id, artist_id, researched_at desc);

alter table public.ai_artist_research enable row level security;

drop policy if exists "Owner reads research for own artists" on public.ai_artist_research;
create policy "Owner reads research for own artists" on public.ai_artist_research
  for select to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_research.artist_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "Owner creates research for own artists" on public.ai_artist_research;
create policy "Owner creates research for own artists" on public.ai_artist_research
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_research.artist_id
        and a.owner_id = auth.uid()
        and a.status = 'active'
    )
  );

drop policy if exists "Owner updates research for own artists" on public.ai_artist_research;
create policy "Owner updates research for own artists" on public.ai_artist_research
  for update to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_research.artist_id
        and a.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_research.artist_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "Owner deletes research for own artists" on public.ai_artist_research;
create policy "Owner deletes research for own artists" on public.ai_artist_research
  for delete to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_research.artist_id
        and a.owner_id = auth.uid()
    )
  );

revoke all on public.ai_artist_research from anon;
grant select, insert, update, delete on public.ai_artist_research to authenticated;
