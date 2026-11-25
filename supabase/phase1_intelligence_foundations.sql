-- AI Music Manager — Phase 1: orchestration, audit et permissions.
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à AI Music Manager.
-- Migration additive : ne modifie ni les tables historiques ni le site public NURIA DOLL.
-- Prérequis : ai_artists et artist_id dans ai_brand_profile (multi_artist_migration.sql).
begin;

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  task_category text not null default 'general',
  risk_level text not null default 'standard' check (risk_level in ('standard','high_stakes','sensitive_action')),
  provider text not null default 'none',
  model text,
  status text not null check (status in ('completed','failed','blocked')),
  request_excerpt text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists ai_agent_runs_owner_created_idx on public.ai_agent_runs(owner_id,created_at desc);
create index if not exists ai_agent_runs_artist_created_idx on public.ai_agent_runs(owner_id,artist_id,created_at desc);
alter table public.ai_agent_runs enable row level security;
drop policy if exists "Owner reads own agent runs" on public.ai_agent_runs;
create policy "Owner reads own agent runs" on public.ai_agent_runs for select to authenticated using (auth.uid()=owner_id);
drop policy if exists "Owner creates own agent runs" on public.ai_agent_runs;
create policy "Owner creates own agent runs" on public.ai_agent_runs for insert to authenticated
with check (auth.uid()=owner_id and exists(select 1 from public.ai_artists a where a.id=artist_id and a.owner_id=auth.uid()));
revoke all on public.ai_agent_runs from anon;
grant select,insert on public.ai_agent_runs to authenticated;

create table if not exists public.ai_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  tool_key text not null,
  enabled boolean not null default false,
  permission_mode text not null default 'approval_required' check(permission_mode in ('prepare_only','auto_low_risk','approval_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,artist_id,tool_key)
);
create index if not exists ai_tool_permissions_owner_artist_idx on public.ai_tool_permissions(owner_id,artist_id);
alter table public.ai_tool_permissions enable row level security;
drop policy if exists "Owner manages own tool permissions" on public.ai_tool_permissions;
create policy "Owner manages own tool permissions" on public.ai_tool_permissions for all to authenticated
using(auth.uid()=owner_id and exists(select 1 from public.ai_artists a where a.id=artist_id and a.owner_id=auth.uid()))
with check(auth.uid()=owner_id and exists(select 1 from public.ai_artists a where a.id=artist_id and a.owner_id=auth.uid()));
revoke all on public.ai_tool_permissions from anon;
grant select,insert,update,delete on public.ai_tool_permissions to authenticated;

create table if not exists public.ai_action_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','approved','rejected','expired','executed')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz,
  decision_note text
);
create index if not exists ai_action_approvals_owner_status_idx on public.ai_action_approvals(owner_id,status,requested_at desc);
alter table public.ai_action_approvals enable row level security;
drop policy if exists "Owner manages own action approvals" on public.ai_action_approvals;
create policy "Owner manages own action approvals" on public.ai_action_approvals for all to authenticated
using(auth.uid()=owner_id and exists(select 1 from public.ai_artists a where a.id=artist_id and a.owner_id=auth.uid()))
with check(auth.uid()=owner_id and exists(select 1 from public.ai_artists a where a.id=artist_id and a.owner_id=auth.uid()));
revoke all on public.ai_action_approvals from anon;
grant select,insert,update on public.ai_action_approvals to authenticated;

commit;

-- Vérification : select count(*) from public.ai_agent_runs;
-- select count(*) from public.ai_tool_permissions;
-- select count(*) from public.ai_action_approvals;
