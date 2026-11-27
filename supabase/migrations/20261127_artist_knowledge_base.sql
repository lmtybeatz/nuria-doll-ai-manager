-- AI Music Manager: verified, public-safe knowledge per artist.
-- This migration has already been applied to the dedicated Supabase project.
-- Apply only to the AI MUSIC MANAGER Supabase project; never run the historic schema.sql.

begin;

create table if not exists public.ai_artist_knowledge (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  category text not null default 'general'
    check (category in ('identity','biography','discography','release','availability','sales_link','official_link','faq','event','safety','other')),
  fact_key text not null,
  fact_value text not null,
  verification_status text not null default 'needs_review'
    check (verification_status in ('manager_confirmed','official_source_verified','needs_review','rejected')),
  public_safe boolean not null default true,
  is_active boolean not null default true,
  source_kind text not null default 'manager_confirmed'
    check (source_kind in ('manager_confirmed','official_website','official_platform','reliable_press','web_search')),
  source_url text,
  source_label text,
  evidence_note text,
  last_verified_at timestamptz,
  review_after timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, artist_id, fact_key)
);

create index if not exists ai_artist_knowledge_owner_artist_status_idx
  on public.ai_artist_knowledge(owner_id, artist_id, verification_status, is_active);
create index if not exists ai_artist_knowledge_artist_category_idx
  on public.ai_artist_knowledge(artist_id, category, fact_key);

alter table public.ai_artist_knowledge enable row level security;
drop policy if exists "Owner manages knowledge for own artists" on public.ai_artist_knowledge;
create policy "Owner manages knowledge for own artists"
  on public.ai_artist_knowledge for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_knowledge.artist_id
        and a.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_artist_knowledge.artist_id
        and a.owner_id = (select auth.uid())
        and a.status = 'active'
    )
  );

revoke all on public.ai_artist_knowledge from anon;
grant select, insert, update, delete on public.ai_artist_knowledge to authenticated;

commit;
