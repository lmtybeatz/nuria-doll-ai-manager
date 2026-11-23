-- Validation parentale des propositions IA (privée par compte).
create table if not exists public.ai_parent_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('assistant','strategy','youtube')),
  source_key text not null,
  title text not null,
  content text not null,
  approved boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_type, source_key)
);
create index if not exists ai_parent_approvals_owner_created_idx
  on public.ai_parent_approvals (owner_id, created_at desc);
alter table public.ai_parent_approvals enable row level security;
drop policy if exists "Owner manages own parent approvals" on public.ai_parent_approvals;
create policy "Owner manages own parent approvals"
  on public.ai_parent_approvals for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
revoke all on public.ai_parent_approvals from anon;
grant select, insert, update, delete on public.ai_parent_approvals to authenticated;
