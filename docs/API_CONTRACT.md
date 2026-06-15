# Contrat d'API — AdresseBJ (consommation frontend)

Document de référence pour le frontend. **Zéro terminologie NestJS/Prisma, zéro détail d'implémentation.**
Mis à jour **avant** que le frontend branche un endpoint. C'est la source de vérité du contrat.

## Généralités

- **URL de base** : `https://<host>/api` (voir `docs/USER_ACTIONS.md` pour l'URL de prod).
- **Headers** :
  - `Authorization: Bearer <jwt>` pour les routes authentifiées.
  - `Content-Type: application/json`.
- **Enveloppe de succès** : toute réponse réussie est `{ "data": …, "meta": { "timestamp": "…" } }`.
- **Enveloppe d'erreur** : `{ "statusCode": <n>, "error": "<texte>", "code": "<CODE_MACHINE>", "message": "<fr>" }`.
  Le frontend **switch sur `code`**, jamais sur le message.

## Codes d'erreur machines (catalogue)

| `code` | HTTP | Sens |
|--------|------|------|
| `ADDRESS_NOT_FOUND` | 404 | Aucune adresse publiée pour ce code (ou existence non exposée). |
| `ADDRESS_INACTIVE` | 410 | Adresse désactivée — données non exposées (corps enrichi : `address_code`, `deactivated_at`). |
| `ADDRESS_ALREADY_EXISTS_AT_LOCATION` | 409 | L'habitant a déjà une adresse sur cette localisation. |
| `COORDINATES_OUT_OF_COVERAGE` | 400 | GPS hors de tout quartier couvert. |
| `ANALYTICS_QUOTA_INSUFFICIENT` | 403 | Ratio de remontée < 0,80 sur la clé API. |
| `API_KEY_MISSING` | 401 | Endpoint intégrateur appelé sans header `Authorization: Bearer`. |
| `API_KEY_INVALID` | 401 | Clé API inconnue ou mal formée. |
| `API_KEY_REVOKED` | 401 | Clé API révoquée. |
| `API_KEY_EXPIRED` | 401 | Clé API expirée. |
| `INVALID_RATING` | 400 | Note d'évaluation hors de l'intervalle entier 1–5. |
| `CONTRIBUTION_MESSAGE_REQUIRED` | 400 | Message de contribution vide. |
| `ACCOUNT_NOT_ACTIVE` | 401 | Compte suspendu ou désactivé (rejet à l'authentification). |
| `NOT_ADDRESS_OWNER` | 403 | Action d'administration sur une adresse dont on n'est pas propriétaire. |
| `REVISION_ALREADY_PENDING` | 409 | Une modification est déjà en attente de validation pour cette adresse. |
| `ADDRESS_ALREADY_DEACTIVATED` | 409 | Adresse déjà désactivée (modification/désactivation impossible). |
| `INVALID_BOUNDING_BOX` | 400 | Aire carte invalide (`north < south` ou `east < west`). |
| … | … | _(compléter au fil des endpoints)_ |

## Comportements spéciaux à connaître

- **404 vs 410** : non publiée/inexistante → 404 ; désactivée → 410.
- **États d'adresse** : une adresse n'est publique que si une version a déjà été publiée.
- **Matrice de visibilité carte** (`/map/addresses`) : domicile muet, autres catégories en clair, non-découvrables exclues.

## Endpoints

> Documenter chaque endpoint avant son branchement frontend : méthode, route, auth, shape de la requête,
> shape de la réponse (`data`), codes d'erreur possibles.

### `POST /auth/request-otp`
- _(à compléter)_

### `GET /addresses/:code` — Page publique (visiteur)

- **Auth** : aucune (public). Appelable depuis le navigateur, y compris pour les métadonnées de partage (og:tags WhatsApp).
- **Réponse 200** (uniquement si l'adresse est active **et** une version a déjà été publiée) :

```json
{
  "data": {
    "code": "AKP-7X3K",
    "category": "COMMERCE",
    "quartier": { "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du carrefour", "Boutique verte"],
    "assembledText": "Partir du carrefour. Boutique verte.",
    "averageRating": 3.7,
    "ratingCount": 12,
    "fieldNotes": [{ "message": "Sens unique le matin", "createdAt": "…" }],
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

- `gps` = coordonnées **figées de la localisation** (utilisées pour la navigation), pas celles de la version.
- `averageRating` vaut `null` (et non `0`) quand il n'y a aucune évaluation → afficher « Aucune évaluation pour le moment ».
- `fieldNotes` = contributions terrain approuvées (lecture seule), `[]` si aucune.
- **Erreurs** : `404 ADDRESS_NOT_FOUND` (inexistante ou jamais publiée), `410 ADDRESS_INACTIVE` (désactivée).

### `GET /addresses/:code/resolve` — Résolution complète (intégrateurs, clé API)

- **Auth** : `Authorization: Bearer bj_live_xxxxxxxxxxxxxxxx` (clé API, **pas** un JWT). Chaque appel est facturable/météré.
- **Réponse 200** (mêmes conditions de publication que la page publique) :

```json
{
  "data": {
    "code": "AKP-7X3K",
    "category": "COMMERCE",
    "quartier": { "id": "…", "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du carrefour", "Boutique verte"],
    "assembledText": "Partir du carrefour. Boutique verte.",
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `410 ADDRESS_INACTIVE`, `401 API_KEY_MISSING|API_KEY_INVALID|API_KEY_REVOKED|API_KEY_EXPIRED`.

### `POST /addresses/:code/rate` — Évaluer une adresse (habitant)

- **Auth** : `Authorization: Bearer <jwt habitant>`.
- **Body** : `{ "stars": 4 }` — entier **1 à 5**.
- **Réponse 200** : `{ "data": { "recorded": true, "averageRating": 3.8, "ratingCount": 13 } }`.
- Une seule évaluation par habitant et par adresse : une nouvelle soumission **remplace** la précédente (modifiable à tout moment). La moyenne est recalculée immédiatement.
- **Erreurs** : `400 INVALID_RATING` (note hors 1–5), `404 ADDRESS_NOT_FOUND` (adresse non publiée), `410 ADDRESS_INACTIVE` (désactivée). Un compte suspendu est refusé dès l'authentification (`401 ACCOUNT_NOT_ACTIVE`).

### `GET /addresses/:code/verify` — Vérification (intégrateurs, clé API)

- **Auth** : `Authorization: Bearer bj_live_…` (clé API). Chaque appel est météré.
- **Réponse 200** :

```json
{ "data": { "code": "AKP-7X3K", "averageRating": 3.7, "ratingCount": 12, "published": true } }
```

- Conçu pour les cas de vérification (KYC fintech, banques, assurances). `averageRating` à `null` = « aucune évaluation » (à distinguer d'une note basse).
- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `410 ADDRESS_INACTIVE`, `401 API_KEY_MISSING|API_KEY_INVALID|API_KEY_REVOKED|API_KEY_EXPIRED`.

### `POST /addresses/:code/report` — Signaler une adresse (habitant)

- **Auth** : `Authorization: Bearer <jwt habitant>`.
- **Body** : `{ "message": "La maison a été démolie." }` — `message` **facultatif** (≤ 500 car.).
- **Réponse 201** : `{ "data": { "reportId": "…", "status": "PENDING" } }`.
- Le signalement entre dans une file de modération ; **l'historique des signalements n'est jamais exposé publiquement**.
- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `410 ADDRESS_INACTIVE`.

### `POST /addresses/:code/contribution` — Contribution terrain (habitant)

- **Auth** : `Authorization: Bearer <jwt habitant>`.
- **Body** : `{ "message": "Sens unique le matin, entrer par le nord." }` — requis, non vide (≤ 1000 car.).
- **Réponse 201** : `{ "data": { "contributionId": "…", "status": "PENDING" } }`.
- Une contribution approuvée devient une **note terrain** affichée à part sur la page publique (`fieldNotes`) ; elle **ne modifie jamais** les `steps` du propriétaire.
- **Erreurs** : `400 CONTRIBUTION_MESSAGE_REQUIRED` (message vide), `404 ADDRESS_NOT_FOUND`, `410 ADDRESS_INACTIVE`.

### `PATCH /addresses/:code` — Modifier une adresse (propriétaire)

- **Auth** : `Authorization: Bearer <jwt propriétaire>`.
- **Body** : `{ "category": "COMMERCE", "steps": ["…"], "photoUrl": "https://…" }`. **Le GPS n'est pas modifiable** (la position d'une adresse est figée).
- **Réponse 200** : `{ "data": { "code": "…", "revisionStatus": "EN_ATTENTE_VALIDATION", "published": true } }`.
- La modification crée une **nouvelle version** soumise à validation. **Tant qu'elle n'est pas approuvée, le public continue de voir l'ancienne version** ; le code ne change jamais.
- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `403 NOT_ADDRESS_OWNER`, `409 REVISION_ALREADY_PENDING` (une modif est déjà en attente), `409 ADDRESS_ALREADY_DEACTIVATED`.

### `PATCH /addresses/:code/discoverable` — Découverte cartographique (propriétaire)

- **Auth** : `Authorization: Bearer <jwt propriétaire>`.
- **Body** : `{ "discoverable": false }`.
- **Réponse 200** : `{ "data": { "code": "…", "mapDiscoverable": false } }`.
- `mapDiscoverable = false` retire l'adresse de la carte browsable (`/map/addresses`) ; sa résolution par code reste possible.
- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `403 NOT_ADDRESS_OWNER`, `409 ADDRESS_ALREADY_DEACTIVATED`.

### `DELETE /addresses/:code` — Désactiver une adresse (propriétaire)

- **Auth** : `Authorization: Bearer <jwt propriétaire>`.
- **Réponse 200** : `{ "data": { "code": "…", "lifecycle": "DESACTIVEE" } }`.
- Désactivation **définitive** (le code n'est jamais réattribué) : l'adresse renvoie ensuite `410` en public/API. Une éventuelle modification en attente sort de la file.
- **Erreurs** : `404 ADDRESS_NOT_FOUND`, `403 NOT_ADDRESS_OWNER`, `409 ADDRESS_ALREADY_DEACTIVATED`.

### `GET /map/addresses` — Surcouche carte browsable (public)

- **Auth** : aucune (public).
- **Query** : `north`, `south`, `east`, `west` (obligatoires, bornes de l'aire visible) ; `category` (optionnel, filtre).
  Exemple : `/map/addresses?north=6.41&south=6.40&east=2.41&west=2.40&category=COMMERCE`.
- **Réponse 200** : tableau de marqueurs.

```json
{
  "data": [
    { "code": "CAD-3M9P", "category": "COMMERCE", "gps": { "lat": 6.366, "lng": 2.421 },
      "muted": false, "preview": { "photoUrl": "https://…", "code": "CAD-3M9P" } },
    { "code": "AKP-7X3K", "category": "DOMICILE", "gps": { "lat": 6.367, "lng": 2.425 },
      "muted": true, "preview": null }
  ]
}
```

- **Matrice de visibilité (appliquée côté serveur)** : `category = DOMICILE` → `muted: true`, `preview: null` (le contenu n'est accessible qu'en ouvrant `GET /addresses/:code`) ; toute autre catégorie → `muted: false`, `preview` = `{ photoUrl, code }`.
- **Seules** les adresses **publiées** et **découvrables** (`mapDiscoverable = true`) de la bbox sont renvoyées. Une adresse non découvrable reste résolvable par code mais **n'apparaît jamais** ici.
- **Erreurs** : `400 INVALID_BOUNDING_BOX` ; `400` de validation si une borne manque/hors plage.

### Modération (dashboard Modérateur/Admin) — `Authorization: Bearer <jwt mod/admin>`

> Réservé aux rôles `MODERATEUR`/`ADMIN`. Un habitant reçoit `403`.

- **File 1 — Révisions** : `GET /moderation/revisions` · `PATCH /moderation/revisions/:id/approve` · `PATCH /moderation/revisions/:id/reject` (body `{ "reason": "…" }`, obligatoire).
- **File 2 — Signalements** : `GET /moderation/reports` (chaque item porte `ownerInactiveOver90Days`, aide à la décision) · `PATCH /moderation/reports/:id/resolve` · `PATCH /moderation/reports/:id/deactivate` (body `{ "reason": "…" }` facultatif ; désactive l'adresse signalée → `410` public).
- **File 3 — Contributions** : `GET /moderation/contributions` · `PATCH /moderation/contributions/:id/approve` (publiée en note terrain) · `PATCH /moderation/contributions/:id/reject`.

<!-- Ajouter ici chaque endpoint au fur et à mesure de son implémentation. -->
