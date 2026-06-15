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

<!-- Ajouter ici chaque endpoint au fur et à mesure de son implémentation. -->
