-- NURIA DOLL AI MANAGER — Connexion sociale sécurisée (YouTube en lecture seule)
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à AI Manager.
create table if not exists public.ai_social_connections (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check (provider in ('youtube')),
 token_ciphertext text not null,
 scopes text[] not null default '{}',
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id, provider)
);
alter table public.ai_social_connections enable row level security;
-- Aucun accès direct depuis le navigateur, même pour l'utilisateur authentifié.
revoke all on public.ai_social_connections from anon, authenticated;

-- Accès serveur uniquement : nécessaire à l'enregistrement et à la lecture des jetons chiffrés.
GRANT SELECT, INSERT, UPDATE ON public.ai_social_connections TO service_role;
