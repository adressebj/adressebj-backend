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
| `ANALYTICS_QUOTA_INSUFFICIENT` | 403 | Ratio de remontée < 0,80 sur la clé API (analytics quartier). |
| `QUARTIER_NOT_FOUND` | 404 | Aucun quartier pour cet identifiant. |
| `API_KEY_MISSING` | 401 | Endpoint intégrateur appelé sans header `Authorization: Bearer`. |
| `API_KEY_INVALID` | 401 | Clé API inconnue ou mal formée. |
| `API_KEY_REVOKED` | 401 | Clé API révoquée. |
| `API_KEY_EXPIRED` | 401 | Clé API expirée. |
| `INVALID_RATING` | 400 | Note d'évaluation hors de l'intervalle entier 1–5. |
| `CONTRIBUTION_MESSAGE_REQUIRED` | 400 | Message de contribution vide. |
| `ACCOUNT_NOT_ACTIVE` | 401 | Compte suspendu ou désactivé (rejet à l'authentification). |
| `EMAIL_ALREADY_REGISTERED` | 409 | Email déjà associé à un autre compte vivant. |
| `PHONE_ALREADY_REGISTERED` | 409 | Numéro déjà associé à un autre compte vivant. |
| `OTP_INVALID` | 401 | Code OTP absent, expiré ou erroné. |
| `PHONE_MISMATCH` | 400 | Numéro de confirmation ≠ numéro du compte (suppression). |
| `INSUFFICIENT_ROLE` | 403 | Rôle insuffisant pour la route (ex. non-admin sur `/admin/*`). |
| `QUARTIER_PREFIX_TAKEN` | 409 | Préfixe de quartier déjà utilisé. |
| `MODERATOR_NOT_FOUND` | 404 | Modérateur introuvable (id inconnu ou rôle ≠ MODERATEUR). |
| `USER_NOT_FOUND` | 404 | Habitant introuvable (id inconnu ou rôle ≠ HABITANT). |
| `PASSWORD_REQUIRED` | 400 | Réinitialisation de mot de passe sans nouveau mot de passe. |
| `API_KEY_NOT_FOUND` | 404 | Clé API introuvable (révocation). |
| `NOT_ADDRESS_OWNER` | 403 | Action d'administration sur une adresse dont on n'est pas propriétaire. |
| `REVISION_ALREADY_PENDING` | 409 | Une modification est déjà en attente de validation pour cette adresse. |
| `ADDRESS_ALREADY_DEACTIVATED` | 409 | Adresse déjà désactivée (modification/désactivation impossible). |
| `INVALID_BOUNDING_BOX` | 400 | Aire carte invalide (`north < south` ou `east < west`). |
| `INVALID_VISIT_TIMESTAMPS` | 400 | Arrivée antérieure au départ. |
| `VISIT_NOT_FOUND` | 404 | Visite (web) introuvable à la confirmation. |
| `VISIT_ID_REQUIRED` | 400 | Confirmation web sans `visitId`. |
| `VISIT_FIELDS_REQUIRED` | 400 | Remontée API sans `addressCode`/`departAt`. |
| `UPLOAD_NOT_CONFIGURED` | 503 | Service d'upload (Cloudinary) non configuré côté serveur. |
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

### `PATCH /auth/profile` — Modifier son profil (habitant, JWT)

- **Auth** : `Authorization: Bearer <jwt>`.
- **Body** (tous champs optionnels — mise à jour partielle) : `{ "firstName": "Awa", "lastName": "Bello", "email": "new@example.com" }`.
- **Réponse 200** : `{ "data": { "id": "…", "phone": "+229…", "email": "new@example.com", "firstName": "Awa", "lastName": "Bello", "role": "HABITANT" } }`.
- **Erreurs** : `409 EMAIL_ALREADY_REGISTERED` (email pris par un autre compte vivant), `401` (sans JWT).

### `PATCH /auth/phone` — Changer de numéro (habitant, JWT)

- **Pré-requis** : appeler d'abord `POST /auth/request-otp` avec le **nouveau** numéro pour recevoir un code (preuve de possession).
- **Auth** : `Authorization: Bearer <jwt>`.
- **Body** : `{ "phone": "+22997000001", "code": "123456" }`.
- **Réponse 200** : profil public mis à jour (`{ "data": { …, "phone": "+22997000001" } }`). Le mot de passe n'est pas touché.
- **Erreurs** : `401 OTP_INVALID` (code absent/expiré/erroné), `409 PHONE_ALREADY_REGISTERED` (numéro déjà pris par un autre compte vivant).

### `DELETE /auth/account` — Supprimer son compte (habitant, JWT)

- **Auth** : `Authorization: Bearer <jwt>`.
- **Body** : `{ "phone": "+22997000000" }` — confirmation, doit correspondre au numéro du compte.
- **Comportement** : anonymisation **immédiate** en pierre tombale (pas de purge différée). Le compte n'est jamais hard-delete : numéro/email/nom/prénom/mot de passe → `null`, `deletedAt` posé. En cascade : adresses désactivées (`410` public), localisations devenues vides supprimées, abonnements push / notifications / OTP purgés. Évaluations, signalements et contributions **conservés** (rattachés à la tombstone anonyme). Le JWT devient aussitôt invalide.
- **Réponse 200** : `{ "data": { "deleted": true, "anonymizedAt": "2026-05-17T10:00:00Z" } }`.
- **Erreurs** : `400 PHONE_MISMATCH` (le numéro ne correspond pas), `401` (sans JWT).

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

### `GET /addresses/:code/eta` — Estimation ETA (intégrateurs, clé API)

- **Auth** : `Authorization: Bearer bj_live_…` (clé API). Chaque appel est météré.
- **Query** : `fromLat` et `fromLng` — coordonnées GPS de **l'origine** du trajet (obligatoires). La destination est l'adresse résolue par son code (jamais fournie par le client).
- Exemple : `GET /addresses/AKP-7X3K/eta?fromLat=6.3600&fromLng=2.4100`
- **Réponse 200** :

```json
{
  "data": {
    "code": "AKP-7X3K",
    "origin": { "lat": 6.36, "lng": 2.41 },
    "destination": { "lat": 6.3676, "lng": 2.4252 },
    "etaMinutes": 11,
    "distanceMeters": 4250,
    "source": "OSRM"
  }
}
```

- `source` vaut `"OSRM"` (routage réel) ou `"ESTIMATE"` (repli local quand le service de routage est indisponible : estimation à vol d'oiseau majorée d'un facteur urbain, divisée par une vitesse moyenne). Le repli ne renvoie **jamais** d'erreur — toujours une estimation exploitable.
- **Erreurs** : `400` (origine manquante ou hors bornes `[-90,90]`/`[-180,180]`), `404 ADDRESS_NOT_FOUND`, `410 ADDRESS_INACTIVE`, `401 API_KEY_MISSING|API_KEY_INVALID|API_KEY_REVOKED|API_KEY_EXPIRED`.

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

### `POST /visits/start` — Départ de navigation (public, anonyme)

- **Auth** : aucune.
- **Body** : `{ "addressCode": "AKP-7X3K", "departAt": "2026-05-17T09:00:00Z" }`.
- **Réponse 201** : `{ "data": { "visitId": "…" } }`.
- L'adresse doit être publiée (sinon `404`/`410`). Les visites alimentent l'ETA/analytics — **jamais** le score de fiabilité.

### `POST /visits/confirm` — Confirmation d'arrivée (public **ou** clé API)

Le mode est déterminé par l'en-tête : avec une clé API `Authorization: Bearer bj_live_…` → remontée intégrateur ; sinon → confirmation web.

- **Web** (sans clé) — Body : `{ "visitId": "…", "arrivedAt": "2026-05-17T09:14:00Z" }`.
- **API** (clé `bj_live_…`) — Body : `{ "addressCode": "AKP-7X3K", "departAt": "…", "arrivedAt": "…", "finalPrice": 1500 }`. Chaque appel est météré.
- **Réponse 201** : `{ "data": { "visitId": "…", "recorded": true } }`.
- **Erreurs** : `400 INVALID_VISIT_TIMESTAMPS` (arrivée < départ), `404 VISIT_NOT_FOUND` (web), `400 VISIT_ID_REQUIRED` / `400 VISIT_FIELDS_REQUIRED` (champs manquants selon le mode), `401 API_KEY_*` (clé fournie mais invalide).

### `POST /upload/signature` — Signature d'upload photo (habitant, JWT)

- **Auth** : `Authorization: Bearer <jwt>` (habitant). Sans JWT → `401`.
- **Body** : aucun.
- **Réponse 200** :

```json
{
  "data": {
    "signature": "a1b2c3…",
    "timestamp": 1747476000,
    "apiKey": "999888777",
    "cloudName": "adressebj",
    "folder": "adressebj/portals",
    "transformation": "q_auto,f_auto"
  }
}
```

- **Usage frontend** : le client envoie les octets de la photo **directement à Cloudinary** (`POST https://api.cloudinary.com/v1_1/{cloudName}/image/upload`) avec `signature`, `timestamp`, `api_key`, `folder` et `transformation` repris tels quels. Le backend ne transporte **jamais** de binaire — il ne fait que signer. L'URL renvoyée par Cloudinary est ensuite passée en `photoUrl` lors de la création/édition d'adresse.
- **Erreurs** : `503 UPLOAD_NOT_CONFIGURED` (identifiants Cloudinary absents côté serveur).

### `GET /quartiers` — Liste des quartiers actifs (public)

- **Auth** : aucune.
- **Réponse 200** : `{ "data": [ { "id": "…", "name": "Akpakpa", "prefix": "AKP" } ] }`.

### `GET /quartiers/:id/analytics` — Analytics de quartier (intégrateurs, clé API)

- **Auth** : `Authorization: Bearer bj_live_…` (clé API). Chaque appel réussi est météré.
- **Quota** : accès conditionné à un **ratio de remontée ≥ 80 %** sur 30 jours glissants, calculé par clé comme `CONFIRM / RESOLVE` (visites confirmées remontées ÷ résolutions effectuées). En dessous → `403`. **Dénominateur nul** (aucune résolution sur la période) → accès **autorisé** : aucun trajet pris, donc aucune obligation de remontée. `resolve` reste toujours accessible quel que soit le ratio.
- **Réponse 200** (agrégats sur les visites du quartier, 30 derniers jours) :

```json
{
  "data": {
    "quartierId": "…",
    "quartierName": "Akpakpa",
    "totalVisits": 142,
    "medianEtaMinutes": 11,
    "medianPriceFCFA": 1200,
    "peakHours": ["08:00-09:00", "17:00-18:00"],
    "successRate": 0.94,
    "period": "last_30_days"
  }
}
```

- Quartier sans visite sur la période : `totalVisits: 0`, `medianEtaMinutes`/`medianPriceFCFA`/`successRate` à `null`, `peakHours: []`. `medianPriceFCFA`/`medianEtaMinutes` à `null` = « pas de donnée » (à distinguer d'une valeur de 0).
- **Erreurs** : `404 QUARTIER_NOT_FOUND`, `403 ANALYTICS_QUOTA_INSUFFICIENT` (message indiquant le % atteint), `401 API_KEY_MISSING|API_KEY_INVALID|API_KEY_REVOKED|API_KEY_EXPIRED`.

### Modération (dashboard Modérateur/Admin) — `Authorization: Bearer <jwt mod/admin>`

> Réservé aux rôles `MODERATEUR`/`ADMIN`. Un habitant reçoit `403`.

- **File 1 — Révisions** : `GET /moderation/revisions` · `PATCH /moderation/revisions/:id/approve` · `PATCH /moderation/revisions/:id/reject` (body `{ "reason": "…" }`, obligatoire).
- **File 2 — Signalements** : `GET /moderation/reports` (chaque item porte `ownerInactiveOver90Days`, aide à la décision) · `PATCH /moderation/reports/:id/resolve` · `PATCH /moderation/reports/:id/deactivate` (body `{ "reason": "…" }` facultatif ; désactive l'adresse signalée → `410` public).
- **File 3 — Contributions** : `GET /moderation/contributions` · `PATCH /moderation/contributions/:id/approve` (publiée en note terrain) · `PATCH /moderation/contributions/:id/reject`.

### Administration — `Authorization: Bearer <jwt admin>`

> Réservé au rôle `ADMIN` (strictement, pas Modérateur). Tout autre rôle reçoit `403 INSUFFICIENT_ROLE`.

**Quartiers**
- `POST /admin/quartiers` — Body `{ "name", "prefix", "centerLat"?, "centerLng"?, "polygon"? }`. `prefix` : 2–6 caractères `A–Z`/`0–9`, unique. **201** → quartier créé. Erreur `409 QUARTIER_PREFIX_TAKEN`.
- `PATCH /admin/quartiers/:id` — Body partiel `{ "name"?, "prefix"?, "centerLat"?, "centerLng"?, "polygon"?, "isActive"? }`. **200** → quartier mis à jour. Erreurs `404 QUARTIER_NOT_FOUND`, `409 QUARTIER_PREFIX_TAKEN`.

**Supervision du référentiel**
- `GET /admin/addresses?code=&quartierId=&lifecycle=&category=&page=&limit=` — filtres optionnels (`code` = préfixe insensible à la casse) + pagination (`page` ≥ 1, `limit` 1–100, défaut 20). **200** → `{ "data": { "items": [ { "code", "category", "lifecycle", "published", "quartier": { "name", "prefix" }, "ownerId", "ownerDeleted", "createdAt" } ], "total", "page", "limit" } }`.

**Comptes Modérateurs**
- `POST /admin/moderators` — Body `{ "email", "password", "firstName"?, "lastName"? }`. **201** → `{ "data": { "id", "email", "firstName", "lastName", "role": "MODERATEUR", "status": "ACTIVE" } }`. Erreur `409 EMAIL_ALREADY_REGISTERED`.
- `PATCH /admin/moderators/:id` — Body `{ "action": "deactivate" | "reactivate" | "reset", "password"? }` (`password` requis si `reset`). **200** → compte mis à jour. Erreurs `404 MODERATOR_NOT_FOUND`, `400 PASSWORD_REQUIRED`.

**Suspension d'Habitants**
- `PATCH /admin/users/:id/suspend` — Body `{ "reason"? }`. **200** → `{ "data": { "id", "status": "SUSPENDED", "suspendedReason" } }`. Un habitant suspendu est rejeté sur toute route authentifiée (`401 ACCOUNT_NOT_ACTIVE`) ; ses adresses publiées restent visibles. Erreur `404 USER_NOT_FOUND`.
- `PATCH /admin/users/:id/unsuspend` — **200** → `{ "data": { "id", "status": "ACTIVE", "suspendedReason": null } }`.

**Clés API**
- `POST /admin/api-keys` — Body `{ "label", "expiresAt"? }` (`expiresAt` ISO 8601). **201** → `{ "data": { "id", "key": "bj_live_…", "label", "status": "ACTIVE", "expiresAt", "createdAt" } }`. **La clé en clair n'est renvoyée qu'ici.**
- `DELETE /admin/api-keys/:id` — **200** → `{ "data": { "id", "status": "REVOKED", "revokedAt" } }`. Toute requête ultérieure avec cette clé reçoit `401 API_KEY_REVOKED`. Erreur `404 API_KEY_NOT_FOUND`.

<!-- Ajouter ici chaque endpoint au fur et à mesure de son implémentation. -->
