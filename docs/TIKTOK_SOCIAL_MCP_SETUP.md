# TikTok Social MCP — gestion de communauté

AI Music Manager utilise deux connexions TikTok complémentaires :

- **Login Kit / Content Posting API** : profil, statistiques, vidéos et flux de publication vidéo/photo déjà présents dans l'application.
- **TikTok Social MCP** : outils officiels TikTok Organic pour découvrir les actions disponibles, consulter les commentaires, répondre et gérer les interactions autorisées.

## Migration Supabase

Exécuter une seule fois le script `supabase/tiktok_social_mcp_migration.sql` dans Supabase SQL Editor. Il autorise le provider `tiktok_social_mcp` dans `ai_social_connections`. Les jetons MCP sont chiffrés avec la clé serveur existante `META_TOKEN_ENCRYPTION_KEY`.

## Configuration Cloudflare

Le callback par défaut est :

`https://nuria-doll-ai-manager.pages.dev/api/tiktok/social-mcp/callback`

La variable `TIKTOK_SOCIAL_MCP_REDIRECT_URI` est facultative. Si elle est définie, elle doit correspondre exactement à cette URL.

Les variables déjà utilisées par les intégrations OAuth doivent être présentes :

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_TOKEN_ENCRYPTION_KEY`
- `META_OAUTH_STATE_SECRET`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`

La connexion MCP s'enregistre dynamiquement auprès du serveur TikTok Social, utilise OAuth 2.0 avec PKCE, et conserve les jetons chiffrés par artiste. Le jeton d'accès expire après environ 24 h ; le renouvellement est automatique. L'autorisation doit être renouvelée après environ un an.

## Autorisations demandées

`user.info.basic`, `user.info.username`, `user.info.stats`, `user.info.profile`, `user.account.type`, `user.insights`, `video.list`, `video.insights`, `comment.list`, `comment.list.manage`, `discovery.search.words`.

Le tableau de bord interroge `tools/list` à la connexion et construit les champs à partir des schémas fournis par TikTok. Les outils de commentaires, vidéos, insights et découverte disponibles dans la région du compte sont exposés dans l'espace TikTok.

## Limites connues

- Le serveur TikTok Social MCP expose plus de 30 outils organiques, mais la disponibilité dépend du compte et de la région.
- Les outils de publication vidéo/photo ne sont pas pris en charge par l'autorisation MCP standard. La publication reste donc séparée via Content Posting API.
- Limite annoncée : 6 requêtes par seconde et par outil et par compte.
- Les actions de réponse, like, masquage et suppression sont des actions réelles sur le compte ; l'interface demande une confirmation avant leur exécution.
