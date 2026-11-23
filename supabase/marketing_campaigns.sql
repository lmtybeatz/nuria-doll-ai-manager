-- NURIA DOLL AI MANAGER — Phase 2.1
-- Table des campagnes marketing multi-projets.
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à l'AI Manager.
-- Ne pas exécuter dans le projet Supabase du site public NURIA DOLL.

create table if not exists public.ai_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_type text not null check (project_type in ('single','album','brand')),
  project_name text not null check (char_length(trim(project_name)) between 1 and 180),
  objective text not null default 'Lancement et promotion',
  duration_days integer not null default 30 check (duration_days in (30,60,90,180,365)),
  budget_amount numeric(12,2) check (budget_amount is null or budget_amount >= 0),
  budget_currency text not null default 'XOF' check (budget_currency in ('XOF','EUR','USD')),
  markets text,
  channels text,
  notes text,
  status text not null default 'draft' check (status in ('draft','planned','active','completed','archived')),
  generated_strategy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_marketing_campaigns_owner_updated_idx
  on public.ai_marketing_campaigns (owner_id, updated_at desc);

alter table public.ai_marketing_campaigns enable row level security;

drop policy if exists "Owner manages own marketing campaigns" on public.ai_marketing_campaigns;
create policy "Owner manages own marketing campaigns"
  on public.ai_marketing_campaigns
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

revoke all on public.ai_marketing_campaigns from anon;
grant select, insert, update, delete on public.ai_marketing_campaigns to authenticated;
