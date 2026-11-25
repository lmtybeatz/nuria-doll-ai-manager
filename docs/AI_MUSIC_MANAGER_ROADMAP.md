# AI MUSIC MANAGER — Plan d’exécution multi-artistes

## Décisions produit
- Autonomie : assistée. L’agent prépare et recommande ; publication, contact, dépense et suppression restent soumis à validation.
- Création : complète, selon les fournisseurs réellement configurés (texte, image, vidéo, voix et audio).
- Priorité : multi-artistes dès le socle. Chaque ressource doit être liée à un `artist_id` et à un `owner_id`.

## Architecture existante auditée
- Frontend : PWA statique `index.html`, `app.js`, `styles.css`.
- Hébergement et API : Cloudflare Pages Functions sous `functions/api/`.
- Authentification, base et médias : projet Supabase dédié à AI MUSIC MANAGER.
- Assistant : `/api/assistant`, Groq en priorité et Workers AI en secours.
- Données déjà scindées par artiste dans l’application : `ai_artists`, `ai_brand_profile`, `ai_settings`, `ai_media_library`, `ai_marketing_campaigns`, `ai_marketing_recommendations`, `ai_parent_approvals`.
- Statistiques déjà amorcées pour YouTube via les routes `/api/youtube/*`.

## Point de vigilance détecté à l’audit\nLe fichier historique `supabase/schema.sql` ne reflète plus le modèle réellement utilisé par `app.js` : il contient encore des profils et paramètres uniques par propriétaire, alors que l’application utilise `ai_artists` et des lignes liées par `artist_id`. Ne pas réexécuter ce fichier sur la base existante. Un lot de consolidation devra reconstruire un schéma de référence complet et des migrations reproductibles, après comparaison avec le schéma Supabase actuellement en production. La migration de recherche de cette PR suppose que `ai_artists` existe déjà.\n\n## Lots techniques
1. **Fondation multi-artistes (en cours)** : vérifier l’isolation propriétaire/artiste, ajouter les dossiers de recherche par artiste et conserver les sources.
2. **Recherche documentaire** : recherche web, discographie, dates de sorties, biographie publique, sources datées, gestion des homonymes et niveau de confiance.
3. **Orchestration** : planifier les sous-tâches, sélectionner les outils, agréger les résultats et distinguer faits/hypothèses.
4. **Création complète** : adapter texte, images, storyboards/vidéos, voix et audio aux identités et formats de chaque artiste.
5. **Campagnes** : calendrier 30 jours, déclinaisons par réseau, bibliothèque de brouillons et circuit d’approbation.
6. **Analytique** : connecteurs officiels disponibles, import CSV et indicateurs calculés avec traçabilité.
7. **Réseaux sociaux** : OAuth officiel et publication uniquement après validation.
8. **Contrôle** : coûts, quotas, journal des opérations, secrets serveur, permissions et tests de non-régression.

## Règles de conception
- Aucun contexte, média, dossier, calendrier ou historique ne doit fuiter entre deux artistes.
- Les recherches doivent enregistrer les URL, titres, extraits, dates disponibles et requêtes utilisées.
- Un nom d’artiste peut être ambigu : ne pas fusionner automatiquement des profils homonymes.
- Le « vrai nom » n’est retenu que s’il est publié par une source fiable ; aucune recherche de données privées.
- Aucun secret fournisseur dans le navigateur ou dans Git.
- NURIA DOLL conserve les protections propres à un projet porté par une enfant et la validation parentale.

## Premier incrément
Ajout d’un endpoint de recherche web et d’une table `ai_artist_research` rattachée au profil artiste. Il requiert la migration SQL dédiée et le secret Cloudflare `TAVILY_API_KEY`. Les recherches sont conservées comme sources documentaires, sans prétendre certifier automatiquement les faits.
