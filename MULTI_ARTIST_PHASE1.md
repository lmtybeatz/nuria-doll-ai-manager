# Fondation multi-artistes — Phase 1

Cette phase prépare le passage de NURIA DOLL AI MANAGER à un espace de management multi-artistes, sans modifier le site public NURIA DOLL.

## Ce qui est ajouté

- `ai_artists` : répertoire des artistes gérés par un compte parent/manager.
- `ai_artist_profiles` : identité, bio, genre, public, tonalité et garde-fous propres à chaque artiste.
- Une clé `artist_id` facultative sur les campagnes, médias, validations parentales et recommandations.
- Une reprise du profil historique comme artiste principal (`is_default = true`).
- Des index et politiques RLS pour isoler les données par propriétaire.

## Compatibilité et précautions

- Les tables historiques `ai_brand_profile`, `ai_settings` et les fichiers Storage ne sont ni supprimés ni renommés.
- Les lignes déjà présentes dans campagnes, bibliothèque, validations et recommandations sont rattachées à l'artiste principal quand il existe.
- Les colonnes `artist_id` restent nullable pour ne pas bloquer l'application actuelle pendant la transition.
- Cette migration ne change pas la branche principale et ne déclenche aucun déploiement.
- Le code actuel continue d'utiliser les tables historiques. L'interface de sélection et de création d'artistes, puis le basculement de chaque module vers `artist_id`, seront livrés dans la phase d'intégration applicative suivante.

## Exécution

1. Ouvrir le projet Supabase dédié à l'AI Manager (jamais celui du site public).
2. Ouvrir SQL Editor.
3. Copier le contenu de `supabase/multi_artist_foundation.sql`.
4. Exécuter une seule fois. Le script est conçu pour être relançable.
5. Vérifier les résultats avec les deux requêtes de contrôle commentées à la fin du SQL.

Ne pas fusionner ni déployer avant d'avoir vérifié la migration sur le bon projet Supabase.
