-- AI Music Manager — TikTok Social MCP
-- À exécuter dans le projet Supabase dédié à AI Music Manager.
-- Migration idempotente : peut être rejouée sans créer de doublons.

begin;

alter table public.ai_social_connections
  add column if not exists account_metadata jsonb not null default '{}'::jsonb;

alter table public.ai_social_connections
  drop constraint if exists ai_social_connections_provider_check;

alter table public.ai_social_connections
  add constraint ai_social_connections_provider_check
  check (provider in ('youtube', 'meta', 'tiktok', 'tiktok_social_mcp'));

create index if not exists ai_social_connections_owner_artist_provider_idx
  on public.ai_social_connections(owner_id, artist_id, provider);

alter table public.ai_social_connections enable row level security;
revoke all on public.ai_social_connections from anon, authenticated;
grant select, insert, update, delete on public.ai_social_connections to service_role;

commit;

-- Vérification :
-- select provider, count(*) from public.ai_social_connections group by provider;
