-- Autorise une connexion OAuth distincte au TikTok Social MCP.
-- À exécuter une seule fois dans Supabase SQL Editor.
ALTER TABLE public.ai_social_connections
  DROP CONSTRAINT IF EXISTS ai_social_connections_provider_check;

ALTER TABLE public.ai_social_connections
  ADD CONSTRAINT ai_social_connections_provider_check
  CHECK (provider IN ('youtube', 'meta', 'tiktok', 'tiktok_social_mcp'));

-- La connexion MCP réutilise les politiques RLS et l'index unique
-- owner_id + artist_id + provider déjà présents sur ai_social_connections.
