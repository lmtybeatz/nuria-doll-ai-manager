-- AI Music Manager — connexions Meta multi-artistes
-- Exécuter dans le projet Supabase dédié à AI Music Manager.
begin;

alter table public.ai_social_connections
  drop constraint if exists ai_social_connections_provider_check;

alter table public.ai_social_connections
  add constraint ai_social_connections_provider_check
  check (provider in ('youtube','meta'));

alter table public.ai_social_connections
  add column if not exists account_metadata jsonb not null default '{}'::jsonb;

create index if not exists ai_social_connections_owner_artist_provider_idx
  on public.ai_social_connections(owner_id, artist_id, provider);

-- Les jetons restent chiffrés côté serveur. Aucun accès direct depuis anon/authenticated.
alter table public.ai_social_connections enable row level security;
revoke all on public.ai_social_connections from anon, authenticated;
grant select, insert, update, delete on public.ai_social_connections to service_role;

commit;

-- Vérification après exécution :
-- select provider, count(*) from public.ai_social_connections group by provider;
