# NURIA DOLL AI MANAGER — Phase 1

Application web indépendante pour préparer la gestion marketing de NURIA DOLL. Cette première version comprend l'interface, l'authentification Supabase, le profil artistique, la bibliothèque média privée et les préférences de l'agent.

## Déploiement

Le projet est relié à Cloudflare Pages via la branche `main`. Les modifications validées sur cette branche doivent déclencher un nouveau déploiement automatique.

## Séparation impérative

- Créer un **nouveau projet Supabase** réservé à AI MANAGER.
- Ne pas exécuter `supabase/schema.sql` dans le projet Supabase du site public NURIA DOLL.
- Déployer ce dossier dans un projet Cloudflare Pages distinct.
- Aucun changement n'est apporté au site public existant.

## 1. Créer Supabase

1. Créer un nouveau projet dans Supabase.
2. Ouvrir SQL Editor et exécuter le contenu de `supabase/schema.sql`.
3. Dans Authentication → URL Configuration, définir l'URL de déploiement Cloudflare Pages comme Site URL et ajouter les URL locales/de production nécessaires aux Redirect URLs.
4. Créer ton compte parent/gestionnaire. Pour un usage strictement personnel, désactiver ensuite les inscriptions publiques dans les paramètres Authentication de Supabase ; conserve uniquement ton compte autorisé.
5. Copier l'URL du projet et sa clé publique (publishable/anon) depuis les paramètres API.
6. Remplacer les deux valeurs de `config.js`.

Ne jamais utiliser la clé `service_role` ou une clé secrète dans `config.js`, le navigateur ou GitHub.

## 2. Tester en local

Un serveur statique suffit. Par exemple, avec Python installé :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080`. Ajouter cette URL aux Redirect URLs Supabase. L'inscription peut demander une confirmation d'e-mail selon la configuration Supabase.

## 3. Déployer sur Cloudflare Pages

1. Créer un nouveau projet Pages, distinct du projet du site NURIA DOLL.
2. Déployer le contenu de ce dossier comme site statique (pas de commande de build, répertoire de sortie `.`).
3. Vérifier `/api/health` : la réponse doit indiquer `status: ok` et `automations_enabled: false`.
4. Configurer les URL Supabase pour le domaine Pages définitif.

## 4. Ce qui fonctionne dans cette phase

- Inscription / connexion par e-mail et mot de passe.
- Lecture et enregistrement du profil artistique.
- Enregistrement des préférences IA (sans lancer d'API payante).
- Téléversement et suppression de fichiers dans un bucket privé.
- Tableau de bord initial et état des modules sociaux.
- Protection des tables et fichiers par RLS et politiques Storage.

## 5. Ce qui n'est volontairement pas activé

- Aucun appel OpenAI.
- Aucune génération d'image ou de vidéo.
- Aucune connexion OAuth aux réseaux sociaux.
- Aucune publication, réponse automatique ou campagne publicitaire.
- Aucune automatisation planifiée.

Ces fonctions seront ajoutées après configuration des comptes, validation des autorisations et mise en place des plafonds de dépense côté serveur.

## Limites de cette version

- La limite de téléversement de l'interface est de 100 Mo par fichier ; le bucket est configuré à 100 MiB.
- L'interface utilise la bibliothèque Supabase JS depuis un CDN et Google Fonts. Une connexion Internet est nécessaire.
- Les identifiants publics Supabase sont destinés au navigateur ; la sécurité repose sur RLS. Les clés privées et jetons de réseaux devront être conservés côté serveur dans les secrets Cloudflare.
- Le formulaire de budget est une préférence de configuration et ne bloque pas à lui seul la facturation fournisseur.
