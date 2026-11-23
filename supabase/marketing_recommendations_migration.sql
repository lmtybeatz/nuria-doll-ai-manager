-- Historique privé des recommandations marketing IA basées sur YouTube Analytics.
create table if not exists public.ai_marketing_recommendations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  range_days integer not null check (range_days in (7, 30, 90)),
  start_date date not null,
  end_date date not null,
  source text not null check (source in ('automatic', 'manual')),
  recommendation text not null,
  provider text not null default 'unknown',
  analytics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_marketing_recommendations_owner_created_idx
  on public.ai_marketing_recommendations (owner_id, created_at desc);

alter table public.ai_marketing_recommendations enable row level security;

drop policy if exists "Owner reads own marketing recommendations" on public.ai_marketing_recommendations;
create policy "Owner reads own marketing recommendations"
  on public.ai_marketing_recommendations
  for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Owner creates own marketing recommendations" on public.ai_marketing_recommendations;
create policy "Owner creates own marketing recommendations"
  on public.ai_marketing_recommendations
  for insert to authenticated
  with check (auth.uid() = owner_id);

revoke all on public.ai_marketing_recommendations from anon;
grant select, insert on public.ai_marketing_recommendations to authenticated;
