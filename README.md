# AI MUSIC MANAGER

Plateforme professionnelle multi-comptes destinée aux artistes, producteurs et managers. Chaque utilisateur possède son propre espace, peut y gérer plusieurs artistes et connecter séparément les comptes sociaux de chacun.

## Déploiement

Le projet est relié à Cloudflare Pages via la branche `main`. Les modifications validées sur cette branche doivent déclencher un nouveau déploiement automatique.

## Architecture et séparation des données

- Le projet Supabase `nuria-doll-ai-manager` est dédié à AI Music Manager.
- Le site public NURIA DOLL conserve son propre projet Supabase et son propre déploiement.
- Chaque profil artiste est rattaché à son propriétaire via `owner_id`.
- Les connexions sociales sont isolées par propriétaire, artiste et plateforme.
- Les jetons sociaux sont chiffrés côté serveur ; aucune clé privée ne doit être placée dans le navigateur ou dans GitHub.
- Les politiques RLS doivent rester activées sur toutes les tables exposées.

## Configuration Supabase

1. Utiliser le projet Supabase dédié à AI Music Manager.
2. Pour une nouvelle installation uniquement, exécuter le schéma et les migrations documentés dans le dossier `supabase/`.
3. Dans Authentication → URL Configuration, définir l'URL Cloudflare Pages comme Site URL et ajouter les URL de redirection locales et de production.
4. Autoriser l'inscription des nouveaux utilisateurs pour le modèle de plateforme. Configurer la confirmation d'e-mail et les protections anti-abus avant ouverture publique.
5. Copier l'URL du projet et sa clé publique (publishable/anon) dans `config.js`.
6. Conserver les clés secrètes et jetons fournisseurs exclusivement dans les secrets Cloudflare.

Ne jamais utiliser la clé `service_role` ou une clé secrète dans `config.js`, le navigateur ou GitHub.

## Onboarding

- À la première connexion, un espace artiste initial est créé automatiquement si le compte n'en possède aucun.
- L'utilisateur peut ensuite ajouter et gérer plusieurs artistes.
- Les données, médias et connexions sociales d'un compte ne doivent jamais être accessibles à un autre compte.
- Les connexions TikTok, Instagram/Facebook et YouTube sont réalisées séparément pour chaque artiste.

## Tester en local

Un serveur statique suffit. Par exemple :

```bash
python -m http.server 8080
```

Ajouter `http://localhost:8080` aux Redirect URLs Supabase.

## Déploiement Cloudflare Pages

1. Conserver le projet Pages AI Music Manager, distinct du site public NURIA DOLL.
2. Déployer le contenu du dépôt depuis la branche `main` (répertoire de sortie `.`).
3. Vérifier `/api/health`.
4. Configurer les variables et secrets Cloudflare requis par les modules activés.
5. Tester l'inscription, la création d'artiste, l'isolation entre deux comptes et les connexions sociales avant ouverture publique.

## Conformité TikTok

Le module Content Posting API doit respecter les règles de TikTok : affichage du créateur connecté, récupération des options de confidentialité depuis l'API, consentement explicite, aperçu du média, choix manuel des paramètres et suivi du statut. Tant que l'application n'a pas passé l'audit TikTok, les publications Direct Post restent soumises aux restrictions du client non audité. La plateforme ne doit pas être présentée comme un simple outil privé pour les comptes d'une seule équipe.

Documentation officielle :
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-sharing-guidelines

## Limites et contrôles

- La bibliothèque média applique actuellement une limite d'interface de 100 Mo par fichier ; vérifier les limites du bucket avant de l'augmenter.
- Le formulaire de budget est une préférence et ne constitue pas, à lui seul, un plafond de facturation fournisseur.
- Toute publication ou réponse sociale doit rester soumise aux autorisations accordées par chaque réseau et au consentement du compte connecté.
