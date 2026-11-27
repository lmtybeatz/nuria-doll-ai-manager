# Activation du module de publication TikTok

Le module de publication est intégré à AI Music Manager. Il utilise le Content Posting API et ne dépend pas de Display API.

## 1. Préparer l'application TikTok

Dans TikTok for Developers, ouvrir l'application utilisée par AI Music Manager :

1. Ajouter le produit **Content Posting API**.
2. Demander l'approbation des scopes **video.publish** et **video.upload**.
3. Activer Direct Post dans la configuration Content Posting API si l'option est proposée.
4. Conserver l'URL de redirection OAuth déjà configurée.
5. Vérifier la propriété du domaine ou du préfixe d'URL qui hébergera les images des publications photo.

L'application doit être approuvée pour les scopes et chaque artiste doit ensuite les autoriser dans son propre compte TikTok.

## 2. Activer les nouveaux scopes sans casser les connexions existantes

Le code garde volontairement les anciens scopes par défaut.

Dans les variables d'environnement Cloudflare Pages, ajouter :

```text
TIKTOK_CONTENT_POSTING_ENABLED=true
```

Appliquer la variable à l'environnement Production, puis redéployer le projet.

Tant que cette variable n'est pas définie à `true`, le parcours OAuth continue de demander uniquement les anciens scopes. Cela évite de casser la connexion TikTok existante avant l'approbation du produit.

## 3. Reconnecter les comptes artistes

Après l'approbation des scopes et l'activation de la variable :

1. Ouvrir AI Music Manager.
2. Sélectionner l'artiste concerné.
3. Ouvrir Réseaux sociaux > TikTok.
4. Cliquer sur « Reconnecter ce compte TikTok ».
5. Accepter les nouvelles autorisations.

Chaque artiste doit autoriser individuellement les permissions. Les jetons sont stockés chiffrés et liés au propriétaire et à l'artiste.

## 4. Limites TikTok à respecter

- Les applications qui n'ont pas passé l'audit Content Posting peuvent être limitées aux publications privées (« Moi uniquement »).
- La publication publique exige l'audit TikTok et le respect des règles UX et de publication.
- Les publications photo utilisent des URL HTTPS hébergées sur un domaine ou préfixe vérifié par TikTok.
- Les vidéos locales sont transférées par blocs vers TikTok ; les brouillons sont finalisés dans l'application TikTok.
- Les options de confidentialité, commentaires, Duos et Collages sont chargées depuis les informations récentes du créateur avant la publication.

## 5. Commentaires

Le module ne simule pas l'accès aux commentaires. La Research API TikTok expose des commentaires publics, mais TikTok indique que les créateurs, annonceurs et utilisateurs commerciaux ne sont pas éligibles à cet accès de recherche. La gestion des commentaires nécessite donc une intégration distincte autorisée par TikTok, par exemple via les produits TikTok for Business si le compte et l'application remplissent leurs critères.

## 6. Endpoints ajoutés

- `POST /api/tiktok/publish` : informations du créateur, initialisation vidéo directe, brouillon vidéo, publication photo et consultation du statut.
- `POST /api/tiktok/upload` : transfert sécurisé des blocs vidéo vers l'URL temporaire fournie par TikTok.

Le serveur vérifie la session Supabase, l'appartenance de l'artiste au propriétaire et la connexion TikTok avant chaque opération. Les jetons sont renouvelés côté serveur et ne sont jamais envoyés au navigateur.


## Activation des permissions de publication

La fonction `/api/tiktok/publish` expose une action `capabilities` qui vérifie les scopes réellement accordés à l'artiste. Le bouton de publication est désactivé si le produit n'est pas activé côté serveur ou si le scope requis manque.

Après avoir ajouté **Content Posting API** au produit TikTok Developers et obtenu les permissions `video.publish` et `video.upload` :

1. Définir `TIKTOK_CONTENT_POSTING_ENABLED=true` dans les variables Cloudflare Pages (Production).
2. Redéployer l'application.
3. Reconnecter le compte TikTok de chaque artiste afin d'obtenir les nouveaux scopes.
4. Vérifier que `creator_info` renvoie les niveaux de visibilité disponibles avant une publication directe.

Le mode brouillon requiert `video.upload`. La publication directe requiert `video.publish` et les paramètres retournés par `creator_info`. Les publications publiques restent soumises à l'audit TikTok et à ses règles d'éligibilité d'application.
