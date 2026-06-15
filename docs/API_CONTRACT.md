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
| `ADDRESS_DEACTIVATED` | 410 | Adresse désactivée — données non exposées. |
| `ADDRESS_ALREADY_EXISTS_AT_LOCATION` | 409 | L'habitant a déjà une adresse sur cette localisation. |
| `COORDINATES_OUT_OF_COVERAGE` | 400 | GPS hors de tout quartier couvert. |
| `ANALYTICS_QUOTA_INSUFFICIENT` | 403 | Ratio de remontée < 0,80 sur la clé API. |
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

<!-- Ajouter ici chaque endpoint au fur et à mesure de son implémentation. -->
