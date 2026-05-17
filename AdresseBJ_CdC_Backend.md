# AdresseBJ — Cahier des Charges Technique · Backend

> **Destinataire** : Développeur backend (BADAROU Mouwafic)
> **Rôle** : Concevoir, implémenter, tester et déployer l'API REST d'AdresseBJ, ainsi que maintenir les trois documentations vivantes du projet.
> **Relation avec le frontend** : Le backend définit le contrat. Le frontend s'y adapte. Tout changement de contrat doit être répercuté immédiatement dans la documentation de consommation.

---

## Table des matières

1. [Contexte et rôle du backend](#1-contexte-et-rôle-du-backend)
2. [Stack technique](#2-stack-technique)
3. [Architecture applicative](#3-architecture-applicative)
4. [Schéma de base de données](#4-schéma-de-base-de-données)
5. [Modules NestJS](#5-modules-nestjs)
6. [Authentification](#6-authentification)
7. [Gestion des clés API](#7-gestion-des-clés-api)
8. [Upload photos — Cloudinary](#8-upload-photos--cloudinary)
9. [Endpoints API](#9-endpoints-api)
10. [Logique métier critique](#10-logique-métier-critique)
11. [Tests](#11-tests)
12. [Les trois documentations vivantes](#12-les-trois-documentations-vivantes)
13. [Déploiement](#13-déploiement)
14. [Règles de travail](#14-règles-de-travail)

---

## 1. Contexte et rôle du backend

AdresseBJ est une infrastructure d'adressage numérique. Le backend est le cœur du système : il génère les codes adresse, orchestre l'authentification OTP, expose l'API REST consommée à la fois par le frontend et par les développeurs tiers, et maintient la fiabilité du référentiel.

Le backend n'est pas un simple CRUD. Il porte quatre responsabilités spécifiques qui le distinguent :

- **Génération de codes uniques** sans collision, déterministes dans leur format, permanents dans le temps.
- **Calcul de fiabilité** des adresses à partir de deux canaux indépendants : évaluations visiteurs et remontées intégrateurs.
- **Contrôle d'accès à deux niveaux** : JWT pour les habitants authentifiés, clé API pour les intégrateurs tiers.
- **Maintien de trois documentations vivantes** à chaque nouvelle implémentation.

Le backend ne gère pas le routage cartographique (délégué à OSRM public), ni le stockage des photos (délégué à Cloudinary). Il orchestre, il ne stocke pas ce qu'il n't a pas besoin de stocker.

---

## 2. Stack technique

Toutes les versions sont vérifiées au **17 mai 2026**. Aucune ne doit être substituée sans justification explicite.

| Rôle | Technologie | Version cible |
|------|-------------|---------------|
| Framework | NestJS | **11.x** (11.1.9+) |
| Langage | TypeScript | 5.x |
| ORM | Prisma | **7.x** (7.7+) |
| Base de données | PostgreSQL | 16+ (Render.com) |
| Validation | class-validator + class-transformer | std NestJS 11 |
| Authentification | @nestjs/jwt + @nestjs/passport | std NestJS 11 |
| Tests | Jest (natif NestJS) | std NestJS 11 |
| OTP SMS | Africa's Talking SDK | dernière stable |
| Upload photos | Cloudinary SDK (Node) | dernière stable |
| Documentation API | Swagger via @nestjs/swagger | std NestJS 11 |
| Déploiement | Render.com (plan gratuit) | — |
| Réveil backend | cron-job.org (ping HTTP, 7h–23h) | — |

**Ce qu'on n'utilise pas et pourquoi :**

- Pas de Redis — aucun besoin de cache distribué ou de session à ce stade.
- Pas de CQRS, pas d'Event Sourcing — sur-ingénierie injustifiée pour ce périmètre.
- Pas de microservices — une application monolithique modulaire est exactement ce qu'il faut ici.
- Pas de TypeORM — Prisma 7 offre un meilleur DX, une type-safety native, des migrations propres, et une intégration NestJS plus moderne.

---

## 3. Architecture applicative

### Principe général

L'architecture suit le pattern standard NestJS : **Controller → Service → Repository (Prisma)**. Chaque module encapsule sa propre responsabilité. Pas de fuite de logique entre couches.

```
src/
├── main.ts                     # Bootstrap, swagger setup, global pipes
├── app.module.ts               # Module racine
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts       # PrismaClient singleton
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts      # POST /auth/request-otp, POST /auth/verify-otp
│   ├── auth.service.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   └── guards/
│       ├── jwt-auth.guard.ts
│       └── api-key.guard.ts
├── addresses/
│   ├── addresses.module.ts
│   ├── addresses.controller.ts
│   ├── addresses.service.ts
│   └── dto/
│       ├── create-address.dto.ts
│       └── rate-address.dto.ts
├── zones/
│   ├── zones.module.ts
│   ├── zones.controller.ts
│   └── zones.service.ts
├── visits/
│   ├── visits.module.ts
│   ├── visits.controller.ts
│   └── visits.service.ts
├── api-keys/
│   ├── api-keys.module.ts
│   └── api-keys.service.ts
├── admin/
│   ├── admin.module.ts
│   └── admin.controller.ts     # Routes /admin/** protégées par rôle ADMIN
├── contributions/
│   ├── contributions.module.ts
│   ├── contributions.controller.ts  # POST /addresses/:code/contribution, routes admin
│   └── contributions.service.ts
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.controller.ts  # POST /notifications/subscribe, DELETE /notifications/unsubscribe
│   └── notifications.service.ts     # Envoi push (Web Push API) + logique de déclenchement
├── upload/
│   ├── upload.module.ts
│   └── upload.service.ts       # Génération signature Cloudinary
└── common/
    ├── filters/
    │   └── http-exception.filter.ts
    ├── interceptors/
    │   └── transform.interceptor.ts  # Enveloppe toutes les réponses en { data, meta }
    └── decorators/
        └── current-user.decorator.ts
```

### Conventions de réponse API

Toutes les réponses réussies sont enveloppées via `TransformInterceptor` :

```json
{
  "data": { ... },
  "meta": { "timestamp": "2026-05-17T10:00:00Z" }
}
```

Les erreurs suivent le format NestJS standard enrichi :

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "ADDRESS_NOT_FOUND",
  "message": "No address found with code AKP-7X3K"
}
```

Le champ `code` est une constante machine, documentée, consommable programmatiquement par le frontend et les intégrateurs.

### Variables d'environnement

```env
# Base de données
DATABASE_URL=postgresql://...

# JWT
JWT_SECRET=...
JWT_EXPIRES_IN=7d

# Africa's Talking
AT_USERNAME=...
AT_API_KEY=...
AT_SENDER_ID=AdresseBJ

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# App
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://adressebj.vercel.app

# Web Push (VAPID) — générer avec: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contact@adressebj.bj
```

---

## 4. Schéma de base de données

Le schéma Prisma est l'unique source de vérité sur la structure des données. Il est versionné avec le code, jamais modifié manuellement en base.

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Utilisateurs ───────────────────────────────────────────────────────────

model User {
  id        String   @id @default(cuid())
  phone     String   @unique
  email     String?
  role      Role     @default(CREATOR)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  addresses         Address[]
  otpCodes          OtpCode[]
  pushSubscriptions PushSubscription[]
}

enum Role {
  CREATOR
  ADMIN
}

model OtpCode {
  id        String   @id @default(cuid())
  phone     String
  code      String
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  user   User?   @relation(fields: [userId], references: [id])
  userId String?

  @@index([phone])
}

// ─── Zones ──────────────────────────────────────────────────────────────────

model Zone {
  id        String   @id @default(cuid())
  name      String
  prefix    String   @unique   // "AKP", "CAD", "FID"...
  polygon   Json?              // GeoJSON polygon OSM
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  addresses Address[]
}

// ─── Adresses ───────────────────────────────────────────────────────────────

model Address {
  id            String        @id @default(cuid())
  code          String        @unique  // "AKP-7X3K"
  zoneId        String
  userId        String
  steps         Json          // string[]
  assembledText String
  gpsLat        Float
  gpsLng        Float
  photoUrl      String
  isActive      Boolean       @default(true)
  deactivatedAt DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  zone     Zone      @relation(fields: [zoneId], references: [id])
  user     User      @relation(fields: [userId], references: [id])
  visits   Visit[]
  ratings  Rating[]
  reports  Report[]
  contributions Contribution[]

  @@index([code])
  @@index([zoneId])
}

// ─── Visites ─────────────────────────────────────────────────────────────────

model Visit {
  id          String    @id @default(cuid())
  addressId   String
  departAt    DateTime
  arrivedAt   DateTime?
  source      VisitSource @default(WEB)
  apiKeyId    String?
  finalPrice  Float?     // remonté par intégrateur (FCFA)
  corridor    Json?      // données OSRM du trajet
  createdAt   DateTime  @default(now())

  address Address  @relation(fields: [addressId], references: [id])
  apiKey  ApiKey?  @relation(fields: [apiKeyId], references: [id])

  @@index([addressId])
}

enum VisitSource {
  WEB        // navigation depuis la PWA
  API        // confirmé par intégrateur
}

// ─── Évaluations visiteurs ───────────────────────────────────────────────────

model Rating {
  id        String     @id @default(cuid())
  addressId String
  type      RatingType
  abuseHash String     // hash(IP + UA + code + date) — non-réversible
  createdAt DateTime   @default(now())

  address Address @relation(fields: [addressId], references: [id])

  @@index([addressId])
  @@index([abuseHash])
}

enum RatingType {
  CONFORM
  NONCONFORM
}

// ─── Signalements ────────────────────────────────────────────────────────────

model Report {
  id        String   @id @default(cuid())
  addressId String
  message   String?
  resolved  Boolean  @default(false)
  createdAt DateTime @default(now())

  address Address @relation(fields: [addressId], references: [id])

  @@index([addressId])
}

// ─── Clés API ────────────────────────────────────────────────────────────────

model ApiKey {
  id          String    @id @default(cuid())
  key         String    @unique  // "bj_live_[16car]" — stocké en clair (pas de données sensibles)
  label       String             // nom de l'application intégratrice
  status      ApiKeyStatus @default(ACTIVE)
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?

  visits      Visit[]

  @@index([key])
}

enum ApiKeyStatus {
  ACTIVE
  REVOKED
}

// ─── Contributions terrain (visiteurs) ──────────────────────────────────────

model Contribution {
  id          String             @id @default(cuid())
  addressId   String
  direction   String?            // sens de circulation (ex: "sens unique nord-sud")
  entrySide   String?            // côté d'entrée (ex: "côté gauche en venant du marché")
  status      ContributionStatus @default(PENDING)
  reviewedAt  DateTime?
  createdAt   DateTime           @default(now())

  address Address @relation(fields: [addressId], references: [id])

  @@index([addressId])
  @@index([status])
}

enum ContributionStatus {
  PENDING
  APPROVED
  REJECTED
}

// ─── Souscriptions push (notifications habitant) ─────────────────────────────

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

### Règles de migration

- Chaque modification de schéma déclenche une migration Prisma nommée : `prisma migrate dev --name <description-courte>`.
- Les migrations sont commitées avec le code qui les nécessite, dans le même commit.
- Jamais de `prisma db push` en production — uniquement `prisma migrate deploy`.

---

## 5. Modules NestJS

### AuthModule

Responsabilités : génération et vérification OTP via Africa's Talking, émission de JWT.

- `POST /api/v1/auth/request-otp` — crée un `OtpCode`, envoie le SMS via Africa's Talking SDK.
- `POST /api/v1/auth/verify-otp` — vérifie le code, crée ou retrouve le `User`, retourne un JWT.

**Durée de vie OTP** : 5 minutes. Un seul OTP actif par numéro à la fois. L'OTP précédent est invalidé dès qu'un nouveau est demandé.

**Format du SMS** : `Votre code AdresseBJ : 847291. Valable 5 minutes.`

### AddressesModule

Responsabilités : création, modification, désactivation, résolution, évaluation, signalement.

Le service `AddressesService` porte la logique de génération de code (voir section 10) et de calcul du score de fiabilité.

### ZonesModule

Responsabilités : liste des zones actives, analytics par zone.

Un script d'initialisation `scripts/seed-zones.ts` importe les quartiers depuis l'API Overpass (OpenStreetMap) et génère les préfixes automatiquement. Ce script est exécuté une seule fois à l'initialisation, pas à chaque démarrage.

### VisitsModule

Responsabilités : enregistrement des départs de navigation (horodatage), confirmation d'arrivée, remontée de données intégrateurs.

### ApiKeysModule

Service uniquement — pas de controller public. Les clés sont créées et révoquées exclusivement par l'administrateur via l'AdminModule.

### UploadModule

Responsabilités : générer une signature Cloudinary côté serveur pour permettre un upload direct depuis le frontend.

Ce module n'interagit jamais avec des fichiers binaires. Il produit uniquement un `{ signature, timestamp, apiKey, cloudName }` utilisable par le frontend pour un upload direct vers Cloudinary.

### AdminModule

Routes protégées par le guard `RolesGuard` + rôle `ADMIN`. Accessible uniquement avec un JWT appartenant à un utilisateur `ADMIN`.

Fonctionnalités : gestion des zones, modération des adresses signalées, validation des contributions terrain, supervision du référentiel, création et révocation de clés API.

### ContributionsModule

Responsabilités : réception des contributions terrain soumises par les visiteurs après confirmation de navigation (sens de circulation, côté d'entrée), et exposition des endpoints admin pour les valider ou les rejeter.

Une contribution approuvée est intégrée aux instructions de l'adresse concernée (`steps` et `assembledText` recalculé). Une contribution rejetée est marquée `REJECTED` et n'affecte pas l'adresse.

### NotificationsModule

Responsabilités : gestion des souscriptions push des habitants et envoi des notifications via l'API Web Push standard (bibliothèque `web-push`).

**Deux déclencheurs de notification**, tous deux gérés dans `NotificationsService.notifyOwner()` :

- **Seuil intermédiaire** : déclenché depuis `AddressesService` quand le score de fiabilité d'une adresse passe sous 40 après un nouveau vote ou une remontée. Message : `"Votre adresse ${code} a reçu des retours négatifs. Vérifiez que les informations sont à jour."`. Payload URL : `/dashboard/address/${code}/edit`.
- **Désactivation administrative** : déclenché depuis `AdminModule` lors d'une désactivation par l'admin. Message : `"Votre adresse ${code} a été désactivée par un administrateur."`. Payload URL : `/dashboard`.

La bibliothèque `web-push` est installée via `npm install web-push`. Les clés VAPID sont générées une seule fois (`npx web-push generate-vapid-keys`) et stockées dans les variables d'environnement.

---

## 6. Authentification

### Flux OTP

```
Frontend                         Backend                        Africa's Talking
   |                                |                                  |
   |-- POST /auth/request-otp ----->|                                  |
   |   { phone: "+22960000000" }    |                                  |
   |                                |-- SMS API (OTP 6 chiffres) ----->|
   |                                |<- confirmation envoi ------------|
   |<-- 200 { message: "OTP sent" } |                                  |
   |                                |                                  |
   |-- POST /auth/verify-otp ------>|                                  |
   |   { phone, code }              |                                  |
   |                                |-- vérifie OtpCode en base        |
   |<-- 200 { accessToken: "..." } -|                                  |
```

### JWT

- Payload minimal : `{ sub: userId, phone, role }`.
- Expiration : 7 jours. Pas de refresh token pour le prototype.
- Tout endpoint qui modifie des données (création, modification, désactivation d'adresse) requiert un JWT valide via `JwtAuthGuard`.

### Garde API Key

Les endpoints `/api/v1/addresses/:code/resolve`, `/verify`, `/eta`, `POST /visits/confirm`, `GET /zones/:id/analytics` requièrent le header `Authorization: Bearer bj_live_[16car]`. La garde `ApiKeyGuard` valide la clé en base, vérifie son statut `ACTIVE` et son expiration si présente.

**Comportement en cas de clé révoquée** : HTTP 401 avec corps `{ "code": "API_KEY_REVOKED" }`.

---

## 7. Gestion des clés API

**Format** : `bj_live_` suivi de 16 caractères alphanumériques générés aléatoirement (base 62 pour maximiser l'entropie).

**Génération** : côté backend uniquement, par l'administrateur. La clé est stockée en clair dans la colonne `key` — ce ne sont pas des données sensibles équivalentes à un mot de passe. Elle est identifiable dans les logs par son préfixe `bj_live_` sans exposer le reste.

**Quota analytique** : l'accès à `GET /zones/:id/analytics` est conditionné à un ratio de remontée `visits/confirm` ≥ 80 % sur 30 jours glissants. Ce ratio est calculé à la demande, pas stocké. Implémentation : `confirmedVisits / totalVisits` sur `Visit` WHERE `createdAt >= NOW() - INTERVAL '30 days'` AND `apiKeyId = $1`.

---

## 8. Upload photos — Cloudinary

### Flux choisi : upload direct depuis le frontend (signature backend)

Le backend ne manipule jamais de données binaires. Il génère une signature sécurisée que le frontend utilise pour uploader directement vers Cloudinary.

```
Frontend                              Backend                    Cloudinary
   |                                     |                           |
   |-- POST /upload/signature ---------->|                           |
   |   Header: Authorization Bearer JWT  |                           |
   |                                     |-- génère signature HMAC   |
   |<-- 200 { signature, timestamp,      |                           |
   |          apiKey, cloudName,         |                           |
   |          folder, transformation } --|                           |
   |                                     |                           |
   |-- POST (direct Cloudinary) -------->|                           |
   |   FormData: { file, signature,      |                           |
   |   timestamp, api_key, folder,       |                           |
   |   transformation: "q_auto,f_auto" } |                           |
   |<----------------------------------------------- { secure_url } |
   |                                     |                           |
   |-- POST /addresses (création) ------>|                           |
   |   { ..., photoUrl: secure_url }     |                           |
```

### Paramètres de signature

```typescript
// upload.service.ts
const timestamp = Math.round(new Date().getTime() / 1000);
const paramsToSign = {
  folder: 'adressebj/portals',
  transformation: 'q_auto,f_auto',
  timestamp,
};
const signature = cloudinary.utils.api_sign_request(
  paramsToSign,
  process.env.CLOUDINARY_API_SECRET,
);
```

La transformation `q_auto,f_auto` est appliquée à l'upload, réduisant le poids moyen de ~500 Ko à ~80–120 Ko sans perte visuelle perceptible.

---

## 9. Endpoints API

Tous les endpoints sont préfixés `/api/v1/`. Le Swagger est disponible sur `/api/docs`.

### Vue d'ensemble

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/request-otp` | Public | Demande d'OTP SMS |
| POST | `/auth/verify-otp` | Public | Vérification OTP → JWT |
| POST | `/upload/signature` | JWT | Signature Cloudinary |
| POST | `/addresses` | JWT | Création d'adresse |
| PATCH | `/addresses/:code` | JWT (propriétaire) | Modification adresse |
| DELETE | `/addresses/:code` | JWT (propriétaire) | Désactivation adresse |
| GET | `/addresses/:code` | Public | Page publique (visiteur) |
| GET | `/addresses/:code/resolve` | API Key | Résolution complète |
| GET | `/addresses/:code/verify` | API Key | Score de fiabilité |
| GET | `/addresses/:code/eta` | API Key | Estimation ETA |
| POST | `/addresses/:code/rate` | Public | Évaluation visiteur |
| POST | `/addresses/:code/report` | Public | Signalement visiteur |
| POST | `/visits/confirm` | API Key | Remontée données intégrateur |
| GET | `/zones` | Public | Liste des zones actives |
| GET | `/zones/:id/analytics` | API Key + quota | Analytics de zone |
| POST | `/admin/zones` | JWT Admin | Création zone manuelle |
| PATCH | `/admin/zones/:id` | JWT Admin | Modification zone |
| GET | `/admin/addresses` | JWT Admin | Supervision référentiel (recherche + filtres) |
| GET | `/admin/reports` | JWT Admin | Liste signalements |
| PATCH | `/admin/reports/:id/resolve` | JWT Admin | Marquer signalement résolu |
| PATCH | `/admin/addresses/:code/deactivate` | JWT Admin | Désactivation admin |
| POST | `/admin/api-keys` | JWT Admin | Création clé API |
| DELETE | `/admin/api-keys/:id` | JWT Admin | Révocation clé API |
| GET | `/admin/contributions` | JWT Admin | Liste contributions en attente |
| PATCH | `/admin/contributions/:id/approve` | JWT Admin | Publier une contribution |
| PATCH | `/admin/contributions/:id/reject` | JWT Admin | Rejeter une contribution |
| POST | `/notifications/subscribe` | JWT | Enregistrer endpoint push |
| DELETE | `/notifications/unsubscribe` | JWT | Se désinscrire des notifications push |
| DELETE | `/auth/account` | JWT | Suppression de compte + purge données |

---

### Détail des endpoints critiques

#### `POST /api/v1/auth/request-otp`

```typescript
// Body
{ "phone": "+22960000000" }

// Réponse 200
{ "data": { "message": "OTP envoyé", "expiresIn": 300 } }

// Erreur 400 — format téléphone invalide
{ "statusCode": 400, "code": "INVALID_PHONE_FORMAT" }
```

#### `POST /api/v1/auth/verify-otp`

```typescript
// Body
{ "phone": "+22960000000", "code": "847291" }

// Réponse 200
{ "data": { "accessToken": "eyJ...", "user": { "id": "...", "phone": "+22960000000" } } }

// Erreur 401 — OTP invalide ou expiré
{ "statusCode": 401, "code": "INVALID_OR_EXPIRED_OTP" }
```

#### `POST /api/v1/addresses`

```typescript
// Header: Authorization: Bearer <JWT>
// Body
{
  "zoneId": "zone_cuid",
  "steps": [
    "Partir du marché Dantokpa",
    "Prendre la 2ème rue à droite",
    "Portail bleu avec étoile jaune",
    "Entrée côté nord"
  ],
  "gpsLat": 6.3676,
  "gpsLng": 2.4252,
  "photoUrl": "https://res.cloudinary.com/adressebj/image/upload/q_auto,f_auto/adressebj/portals/xyz.jpg"
}

// Réponse 201
{
  "data": {
    "code": "AKP-7X3K",
    "assembledText": "Partir du marché Dantokpa. Prendre la 2ème rue à droite. Portail bleu avec étoile jaune. Entrée côté nord.",
    "shareUrl": "https://adressebj.vercel.app/a/AKP-7X3K",
    "whatsappUrl": "https://wa.me/?text=Mon adresse AdresseBJ : AKP-7X3K → https://adressebj.vercel.app/a/AKP-7X3K"
  }
}

// Erreur 400 — coordonnées hors périmètre
{ "statusCode": 400, "code": "COORDINATES_OUT_OF_COVERAGE" }

// Erreur 400 — steps vides ou insuffisants
{ "statusCode": 400, "code": "STEPS_REQUIRED", "message": "Au moins 2 étapes sont requises" }
```

#### `GET /api/v1/addresses/:code/resolve`

```typescript
// Header: Authorization: Bearer bj_live_xxxxxxxxxxxxxxxx

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "zone": { "id": "...", "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du marché Dantokpa", "..."],
    "assembledText": "Partir du marché Dantokpa. ...",
    "isActive": true,
    "createdAt": "2026-05-01T10:00:00Z"
  }
}

// Erreur 404
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }

// Erreur 410 — adresse désactivée (RFC 9110)
{
  "statusCode": 410,
  "code": "ADDRESS_INACTIVE",
  "message": "This address has been deactivated.",
  "address_code": "AKP-7X3K",
  "deactivated_at": "2026-03-14T10:22:00Z"
}
```

#### `GET /api/v1/addresses/:code/verify`

```typescript
// Header: Authorization: Bearer bj_live_...

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "reliabilityScore": 87,      // 0-100, réservé à l'API — le visiteur voit un badge
    "visitCount": 23,
    "isActive": true
  }
}
```

#### `GET /api/v1/addresses/:code/eta`

```typescript
// Header: Authorization: Bearer bj_live_...
// Query params: ?fromLat=6.35&fromLng=2.41

// Réponse 200 — données disponibles
{
  "data": {
    "estimatedMinutes": 12,
    "confidence": "medium",     // "low" | "medium" | "high"
    "basedOnVisits": 8
  }
}

// Réponse 200 — données insuffisantes au lancement
{
  "data": {
    "estimatedMinutes": null,
    "confidence": "none",
    "basedOnVisits": 0,
    "message": "Données insuffisantes. L'ETA sera disponible après accumulation de trajets."
  }
}
```

#### `POST /api/v1/visits/confirm`

```typescript
// Header: Authorization: Bearer bj_live_...
// Body
{
  "addressCode": "AKP-7X3K",
  "departAt": "2026-05-17T09:00:00Z",
  "arrivedAt": "2026-05-17T09:14:00Z",
  "finalPrice": 1500          // optionnel, en FCFA
}

// Réponse 201
{ "data": { "visitId": "visit_cuid", "recorded": true } }

// Erreur 400 — arrivedAt antérieur à departAt
{ "statusCode": 400, "code": "INVALID_VISIT_TIMESTAMPS" }
```

#### `GET /api/v1/zones/:id/analytics`

```typescript
// Header: Authorization: Bearer bj_live_...
// Vérifie ratio remontée >= 80% sur 30j glissants

// Réponse 200
{
  "data": {
    "zoneId": "...",
    "zoneName": "Akpakpa",
    "totalVisits": 142,
    "medianEtaMinutes": 11,
    "medianPriceFCFA": 1200,
    "peakHours": ["08:00-09:00", "17:00-18:00"],
    "successRate": 0.94,
    "period": "last_30_days"
  }
}

// Erreur 403 — quota insuffisant
{
  "statusCode": 403,
  "code": "ANALYTICS_QUOTA_INSUFFICIENT",
  "message": "Ratio de remontée insuffisant (67% < 80% requis sur 30 jours)."
}
```

#### `POST /api/v1/addresses/:code/rate`

```typescript
// Public — pas d'auth
// Body
{ "type": "CONFORM" }   // ou "NONCONFORM"
// Header utilisé pour hash anti-abus : X-Forwarded-For + User-Agent

// Réponse 201
{ "data": { "recorded": true } }

// Réponse 200 — déjà voté aujourd'hui (silencieux, pas d'erreur)
{ "data": { "recorded": false, "reason": "ALREADY_VOTED_TODAY" } }
```

#### `GET /api/v1/addresses/:code` — Endpoint public visiteur

Cet endpoint est appelé par le frontend sans clé API, y compris dans `generateMetadata` côté serveur pour les og:tags WhatsApp. Il doit exposer toutes les données nécessaires à la page de consultation.

```typescript
// Public — pas d'auth, pas de clé API

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "zone": { "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du marché Dantokpa", "..."],
    "assembledText": "Partir du marché Dantokpa. ...",
    "reliabilityScore": null,   // null si aucune donnée (score 0) → badge "non évalué" côté frontend
    "visitCount": 0,
    "isActive": true,
    "createdAt": "2026-05-01T10:00:00Z"
  }
}

// Erreur 404
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }

// Erreur 410 — adresse désactivée
{
  "statusCode": 410,
  "code": "ADDRESS_INACTIVE",
  "message": "This address has been deactivated.",
  "address_code": "AKP-7X3K",
  "deactivated_at": "2026-03-14T10:22:00Z"
}
```

Note : `reliabilityScore` est `null` (et non `0`) quand aucune donnée n'existe — le frontend l'utilise pour distinguer "pas encore évalué" de "score zéro". La valeur `0` est un score légitimement mauvais ; `null` est l'absence de données.

#### `POST /api/v1/addresses/:code/contribution`

```typescript
// Public — pas d'auth
// Body
{
  "direction": "Sens unique nord-sud",   // optionnel
  "entrySide": "Côté gauche en venant du marché"  // optionnel
}
// Au moins un des deux champs doit être présent

// Réponse 201
{ "data": { "contributionId": "contrib_cuid", "status": "PENDING" } }

// Erreur 400 — aucun champ fourni
{ "statusCode": 400, "code": "CONTRIBUTION_FIELDS_REQUIRED" }

// Erreur 404 — adresse inconnue
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }

// Erreur 410 — adresse désactivée (pas de contribution sur une adresse inactive)
{ "statusCode": 410, "code": "ADDRESS_INACTIVE" }
```

#### `GET /api/v1/admin/contributions`

```typescript
// Header: Authorization: Bearer <JWT Admin>
// Query params: ?status=PENDING (défaut) | APPROVED | REJECTED

// Réponse 200
{
  "data": [
    {
      "id": "contrib_cuid",
      "addressCode": "AKP-7X3K",
      "direction": "Sens unique nord-sud",
      "entrySide": "Côté gauche",
      "status": "PENDING",
      "createdAt": "2026-05-10T08:00:00Z",
      "address": {
        "photoUrl": "https://res.cloudinary.com/...",
        "assembledText": "Partir du marché Dantokpa. ..."
      }
    }
  ]
}
```

#### `PATCH /api/v1/admin/contributions/:id/approve`

```typescript
// Header: Authorization: Bearer <JWT Admin>
// Pas de body

// Effet : status = APPROVED, reviewedAt = now()
//         Les champs direction/entrySide approuvés sont ajoutés
//         comme nouvelles étapes dans address.steps
//         assembledText est recalculé automatiquement

// Réponse 200
{ "data": { "contributionId": "...", "status": "APPROVED" } }
```

#### `PATCH /api/v1/admin/contributions/:id/reject`

```typescript
// Header: Authorization: Bearer <JWT Admin>
// Pas de body

// Effet : status = REJECTED, reviewedAt = now() — l'adresse n'est pas modifiée

// Réponse 200
{ "data": { "contributionId": "...", "status": "REJECTED" } }
```

#### `POST /api/v1/notifications/subscribe`

```typescript
// Header: Authorization: Bearer <JWT>
// Body — shape standard de l'API Web Push
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}

// Réponse 201
{ "data": { "subscribed": true } }

// Comportement : si un PushSubscription existe déjà avec cet endpoint pour cet utilisateur,
// on le met à jour (upsert) plutôt que de créer un doublon.
```

#### `DELETE /api/v1/notifications/unsubscribe`

```typescript
// Header: Authorization: Bearer <JWT>
// Body
{ "endpoint": "https://fcm.googleapis.com/fcm/send/..." }

// Réponse 200
{ "data": { "unsubscribed": true } }

// Si l'endpoint n'existe pas : 200 silencieux (idempotent)
```

#### `DELETE /api/v1/auth/account`

```typescript
// Header: Authorization: Bearer <JWT>
// Body
{ "phone": "+22960000000" }  // confirmation : doit correspondre au compte connecté

// Comportement :
// 1. Vérifie que phone correspond à l'utilisateur du JWT
// 2. Désactive toutes les adresses de l'utilisateur (isActive = false)
// 3. Efface les données personnelles : phone → "[supprimé]", email → null
// 4. Révoque tous les OTP actifs
// 5. Supprime toutes les PushSubscriptions
// 6. Les visites, ratings et contributions sont conservés de manière anonymisée
//    (userId disassocié, données agrégées préservées pour le référentiel)

// Réponse 200
{ "data": { "deleted": true, "purgeScheduledAt": "2026-06-16T00:00:00Z" } }
// purgeScheduledAt = now() + 30 jours (conformité loi n°2017-20)

// Erreur 400 — téléphone ne correspond pas
{ "statusCode": 400, "code": "PHONE_MISMATCH" }
```

#### `GET /api/v1/admin/addresses`

```typescript
// Header: Authorization: Bearer <JWT Admin>
// Query params:
//   ?search=AKP-7X3K        (recherche par code)
//   ?search=+22960000000    (recherche par téléphone habitant)
//   ?zone=zone_cuid
//   ?status=active | inactive | reported
//   ?page=1&limit=20

// Réponse 200
{
  "data": [
    {
      "code": "AKP-7X3K",
      "zone": { "name": "Akpakpa" },
      "ownerPhone": "+229601****00",   // masqué partiellement pour l'admin
      "isActive": true,
      "reliabilityScore": 72,
      "reportCount": 0,
      "createdAt": "2026-05-01T10:00:00Z"
    }
  ],
  "meta": {
    "timestamp": "...",
    "total": 142,
    "page": 1,
    "limit": 20
  }
}
```

---

## 10. Logique métier critique

### Génération de code adresse

Le code suit le format `[PRÉFIXE-ZONE]-[SÉQUENCE-4CAR]`. La séquence est en base 32, alphabet épuré : `23456789ABCDEFGHJKMNPQRSTVWXYZ` (0, O, I, L exclus pour éviter les confusions visuelles et orales).

```typescript
// addresses.service.ts
private readonly ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

private generateSequence(): string {
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += this.ALPHABET[Math.floor(Math.random() * this.ALPHABET.length)];
  }
  return result;
}

async generateUniqueCode(zonePrefix: string): Promise<string> {
  let code: string;
  let attempts = 0;
  do {
    if (attempts > 50) throw new Error('CODE_GENERATION_EXHAUSTED');
    code = `${zonePrefix}-${this.generateSequence()}`;
    attempts++;
  } while (await this.prisma.address.findUnique({ where: { code } }));
  return code;
}
```

**Garantie de non-collision** : vérification d'unicité en base avant persistance. Le pool par zone est de 32⁴ = 1 048 576 combinaisons — zéro risque de saturation au stade prototype.

**Permanence** : un code ne change jamais après création, même si l'adresse est modifiée ou désactivée. Les migrations de zones ne réattribuent jamais un code existant.

### Assemblage du texte d'instructions

```typescript
buildAssembledText(steps: string[]): string {
  return steps.map(s => s.trim()).join('. ') + '.';
}
```

L'`assembledText` est recalculé automatiquement à chaque modification des `steps`. Il n'est jamais saisi directement.

### Calcul du score de fiabilité

Le score est un entier entre 0 et 100, calculé à la demande (pas mis en cache dans ce prototype).

```typescript
async computeReliabilityScore(addressId: string): Promise<number> {
  const [ratings, visits] = await Promise.all([
    this.prisma.rating.findMany({ where: { addressId } }),
    this.prisma.visit.findMany({ where: { addressId, arrivedAt: { not: null } } }),
  ]);

  if (ratings.length === 0 && visits.length === 0) return 0;

  const conformCount = ratings.filter(r => r.type === 'CONFORM').length;
  const ratingScore = ratings.length > 0
    ? (conformCount / ratings.length) * 100
    : 50; // neutre si aucune évaluation

  const visitScore = Math.min(visits.length * 5, 100); // plafonné à 100

  // Pondération : 60% évaluations manuelles, 40% volume de visites confirmées
  return Math.round(ratingScore * 0.6 + visitScore * 0.4);
}
```

**Niveaux d'exposition** (non négociables) :

| Destinataire | Ce qu'il reçoit |
|---|---|
| Visiteur (page publique) | Badge qualitatif uniquement (vert/orange/rouge) — calculé côté frontend à partir du score |
| Développeur tiers (API) | Score numérique brut + visitCount |
| Administrateur (dashboard) | Score + historique des signalements |

### Anti-abus sur les votes visiteurs

```typescript
buildAbuseHash(ip: string, userAgent: string, code: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const raw = `${ip}:${userAgent}:${code}:${date}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
```

Le hash est non-réversible. Il ne permet pas d'identifier l'utilisateur. Il sert uniquement de filtre anti-abus par jour et par adresse. Un vote avec un hash déjà présent en base pour aujourd'hui est silencieusement ignoré (`recorded: false`).

### Gestion des adresses désactivées

Quand une adresse est désactivée (par son créateur ou par l'admin), `isActive = false` et `deactivatedAt = now()`. Le code n'est **jamais** réattribué.

- Endpoint `GET /addresses/:code` (public) → affiche un message générique sans exposer les données.
- Endpoints API (`/resolve`, `/verify`, `/eta`) → HTTP 410 avec corps structuré.

### Déclenchement des notifications push

Les notifications push sont envoyées via la bibliothèque `web-push` en Node.js. `NotificationsService` expose une méthode `notifyOwner(userId, payload)` appelée depuis d'autres services — jamais directement depuis un controller.

```typescript
// notifications.service.ts
async notifyOwner(userId: string, payload: PushPayload): Promise<void> {
  const subscriptions = await this.prisma.pushSubscription.findMany({
    where: { userId },
  });

  const message = JSON.stringify({
    title: 'AdresseBJ',
    body: payload.message,
    data: { url: payload.url },
  });

  await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message,
      ).catch(async (err) => {
        // Endpoint expiré (410) → supprimer la souscription automatiquement
        if (err.statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      })
    )
  );
}
```

**Déclencheur 1 — Seuil intermédiaire (score < 40)** : appelé dans `AddressesService` après chaque vote ou remontée intégrateur qui fait baisser le score.

```typescript
// Dans addresses.service.ts, après computeReliabilityScore()
if (newScore < 40 && previousScore >= 40) {
  await this.notificationsService.notifyOwner(address.userId, {
    message: `Votre adresse ${address.code} a reçu des retours négatifs. Vérifiez que les informations sont à jour.`,
    url: `/dashboard/address/${address.code}/edit`,
  });
}
```

**Déclencheur 2 — Désactivation administrative** : appelé dans `AdminModule` lors d'une désactivation par l'admin.

```typescript
// Dans admin.controller.ts, après désactivation
await this.notificationsService.notifyOwner(address.userId, {
  message: `Votre adresse ${address.code} a été désactivée par un administrateur.`,
  url: `/dashboard`,
});
```

`Promise.allSettled` garantit qu'une souscription défaillante ne bloque pas les autres. Les notifications sont best-effort — leur échec ne doit jamais faire échouer l'opération principale (vote, désactivation).

### Suppression de compte — logique de purge

La suppression est en deux temps : anonymisation immédiate + purge planifiée à 30 jours.

```typescript
// auth.service.ts — deleteAccount()
async deleteAccount(userId: string): Promise<void> {
  await this.prisma.$transaction([
    // 1. Désactiver toutes les adresses
    this.prisma.address.updateMany({
      where: { userId },
      data: { isActive: false, deactivatedAt: new Date() },
    }),
    // 2. Anonymiser les données personnelles immédiatement
    this.prisma.user.update({
      where: { id: userId },
      data: { phone: `[supprimé-${userId}]`, email: null },
    }),
    // 3. Invalider tous les OTP actifs
    this.prisma.otpCode.updateMany({
      where: { userId },
      data: { used: true },
    }),
    // 4. Supprimer les souscriptions push
    this.prisma.pushSubscription.deleteMany({ where: { userId } }),
  ]);
  // Les visites, ratings et contributions sont conservés anonymisés
  // (userId existe toujours en base mais phone = "[supprimé-...]")
}
```

La purge définitive à 30 jours (suppression du User) peut être gérée par un cron NestJS (`@nestjs/schedule`) ou un job Render.com. Pour le prototype, l'anonymisation immédiate est suffisante — la purge physique est une amélioration production.

---

## 11. Tests

Les tests sont **obligatoires**. Ils sont écrits et validés avant ou avec le code, pas après. Un endpoint non testé n'est pas considéré comme terminé.

### Tests unitaires

Couvrent la logique métier pure, sans base de données.

| Unité | Ce qui est testé |
|-------|-----------------|
| `generateUniqueCode` | Zéro collision sur 1 000 codes générés en parallèle (mock Prisma) |
| `buildAssembledText` | Assemblage correct des steps, gestion des espaces, steps vides |
| `computeReliabilityScore` | Score correct pour 0 votes / 100% conformes / 50-50 / volume de visites |
| `buildAbuseHash` | Déterministe (même input → même hash), différent si date différente |
| `generateSequence` | Caractères exclus (0, O, I, L) jamais présents dans la sortie |

```bash
# Exécution
npx jest --testPathPattern=*.spec.ts --coverage
```

### Tests d'intégration

Couvrent les endpoints avec une vraie base de données (PostgreSQL de test, isolée). Utilisent `@nestjs/testing` + `supertest`.

**Endpoints obligatoirement testés avec cas nominal ET cas d'erreur :**

| Endpoint | Cas nominal | Cas d'erreur |
|----------|-------------|--------------|
| `POST /auth/request-otp` | OTP envoyé (mock AT) | Téléphone invalide → 400 |
| `POST /auth/verify-otp` | JWT retourné | OTP expiré → 401, OTP invalide → 401 |
| `DELETE /auth/account` | Compte anonymisé, adresses désactivées | Téléphone non-correspondant → 400 |
| `POST /addresses` | Adresse créée, code généré | Hors périmètre → 400, sans JWT → 401 |
| `GET /addresses/:code` | Données complètes retournées | Code inexistant → 404, désactivé → 410 |
| `GET /addresses/:code/resolve` | Données complètes | Code inexistant → 404, désactivé → 410, clé révoquée → 401 |
| `GET /addresses/:code/verify` | Score retourné | Clé invalide → 401 |
| `POST /addresses/:code/contribution` | Contribution créée PENDING | Aucun champ → 400, adresse inactive → 410 |
| `POST /visits/confirm` | Visit enregistrée | Timestamps invalides → 400 |
| `GET /zones/:id/analytics` | Analytics retournées | Quota insuffisant → 403 |
| `POST /notifications/subscribe` | Souscription créée/mise à jour | Sans JWT → 401 |
| `PATCH /admin/contributions/:id/approve` | Contribution APPROVED, steps mis à jour | Sans rôle ADMIN → 403 |
| `PATCH /admin/contributions/:id/reject` | Contribution REJECTED | Sans rôle ADMIN → 403 |

### Smoke test de démo

Script automatisé exécutable avant chaque déploiement ou démonstration :

```typescript
// scripts/smoke-test.ts
// Valide le parcours complet :
// 1. Request OTP → 200
// 2. Verify OTP → JWT
// 3. Signature Cloudinary → signature valide
// 4. Create Address → code généré
// 5. Resolve Address (avec clé API de test) → données complètes
// 6. Rate Address → recorded: true
// 7. Confirm Visit → visitId retourné
```

### Coverage cible

**≥ 70 % de couverture sur les services**. Les controllers et les guards ont une couverture minimale (tests d'intégration suffisent). Pas d'obsession du chiffre — la qualité des assertions compte plus que le pourcentage.

---

## 12. Les trois documentations vivantes

Ces trois documents sont maintenus **simultanément** à chaque nouvel endpoint ou modification. Ils vivent dans le dépôt sous `docs/`. L'IA (Cursor, Claude, etc.) les met à jour au fur et à mesure de l'implémentation. Aucun d'eux ne doit jamais être en retard sur l'état réel de l'API.

### 1. `docs/API_POSTMAN.md` — Documentation Postman

**Rôle** : permettre de tester manuellement chaque endpoint dans Postman sans aucun oubli. Dense, exhaustif, avec les requêtes exactes et les réponses attendues.

**Structure par endpoint :**
```markdown
## POST /api/v1/auth/verify-otp

**Auth** : Public
**Body** :
\`\`\`json
{ "phone": "+22960000000", "code": "847291" }
\`\`\`
**Réponse 200** :
\`\`\`json
{ "data": { "accessToken": "eyJ...", "user": { ... } } }
\`\`\`
**Cas d'erreur** :
- `401 INVALID_OR_EXPIRED_OTP` — OTP incorrect ou expiré
- `400 INVALID_PHONE_FORMAT` — format invalide
**Variables Postman** : stocker `accessToken` en `{{jwt}}`
```

### 2. `docs/API_CONTRACT.md` — Contrat de consommation frontend

**Rôle** : permettre au développeur frontend de savoir exactement quoi appeler, avec quoi, et quoi attendre — sans lire une ligne de code NestJS. C'est le document le plus important du projet.

**Principes** :
- Zéro terminologie NestJS ou Prisma.
- Zéro détail d'implémentation.
- URL de base, headers requis, shape exacte des requêtes et réponses, codes d'erreur machines à gérer, comportements spéciaux (410 vs 404).
- Un tableau de `ENV` frontend requis (base URL, etc.).
- Mis à jour avant que le frontend commence à brancher un endpoint.

### 3. `docs/DEPLOYMENT.md` — Documentation de déploiement

**Rôle** : permettre de déployer, redéployer ou diagnostiquer l'application depuis zéro en moins de 30 minutes.

**Contenu** :
- Variables d'environnement requises (sans valeurs) et leur source.
- Étapes de déploiement sur Render.com (build command, start command, PostgreSQL linking).
- Commandes de migration : `npx prisma migrate deploy`.
- Commande de seed zones OSM : `npx ts-node scripts/seed-zones.ts`.
- Configuration cron-job.org pour le réveil backend.
- Checklist de vérification post-déploiement (smoke test).
- Procédure de rollback.

---

## 13. Déploiement

### Philosophie

**Déployer tôt, déployer souvent.** Un backend qui tourne uniquement en local n'est pas un backend — c'est un brouillon. Le déploiement précoce force à découvrir les problèmes d'environnement avant qu'ils deviennent bloquants.

### Premier déploiement — déclencheur

Le premier déploiement sur Render.com est effectué **dès que ces trois conditions sont remplies et testées** :

1. `POST /auth/request-otp` et `POST /auth/verify-otp` fonctionnels (auth complète).
2. `POST /addresses` fonctionnel (création avec code généré).
3. `GET /addresses/:code/resolve` fonctionnel (résolution complète).

Tout le reste peut encore être sur mocks ou en cours. Ces trois endpoints constituent le **minimum viable** qui débloque le frontend sur son parcours critique.

### Configuration Render.com

```
Build Command  : npm install && npx prisma generate && npx prisma migrate deploy && npm run build
Start Command  : node dist/main.js
Health Check   : GET /api/health → 200
```

L'endpoint `GET /api/health` retourne simplement `{ "status": "ok", "timestamp": "..." }`. Il est utilisé par Render pour les health checks et par cron-job.org pour le réveil.

### Déploiements suivants

Chaque jalon fonctionnel testé déclenche un déploiement. Pas de "big bang" en fin de projet. La branche `main` est toujours déployable.

---

## 14. Règles de travail

### Commits

Les commits suivent le format **Conventional Commits** :

```
feat(addresses): add code generation with collision check
test(addresses): add unit tests for generateUniqueCode
fix(auth): handle expired OTP correctly
docs(api): update frontend contract with /resolve endpoint
chore(prisma): add Rating model and migration
```

**Règle absolue** : un commit = une unité fonctionnelle testée. Pas de commits "WIP", "fix", "misc". Chaque commit sur `main` doit laisser l'application dans un état déployable.

### Granularité des commits — exemples

- Ajout du modèle Prisma + migration → `chore(prisma): add Address model`
- Implémentation du service de génération de code + tests unitaires → `feat(addresses): implement code generation` + `test(addresses): zero-collision test on 1000 codes`
- Endpoint `/resolve` + tests d'intégration + mise à jour des trois docs → trois commits séparés ou un commit groupé si atomiquement liés.

### Ce qui ne passe pas en review

- Code sans test sur un endpoint critique.
- Endpoint documenté dans le Swagger mais absent de `docs/API_CONTRACT.md`.
- Migration Prisma sans le code métier correspondant dans le même commit.
- `console.log` laissé en production.
- Clés ou secrets en dur dans le code.

### Gestion des branches

- `main` — toujours déployable, toujours testé.
- `feat/<nom>` — branches de développement. Mergées dans `main` uniquement quand le jalon est complet et les tests passent.

### No over-engineering

Avant d'introduire un pattern complexe (factory, decorator custom, abstract repository, etc.), la question à se poser est : **est-ce que l'application en a besoin maintenant, ou est-ce que j'anticipe un besoin hypothétique ?** Si c'est hypothétique, on ne l'implémente pas. La complexité se rajoute quand le besoin est réel, pas avant.
