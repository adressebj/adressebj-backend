# AdresseBJ — Cahier des Charges Technique · Backend

> **Destinataire** : Développeur backend (BADAROU Mouwafic)
> **Rôle** : Concevoir, implémenter, tester et déployer l'API REST d'AdresseBJ, ainsi que maintenir les trois documentations vivantes du projet.
> **Relation avec le frontend** : Le backend définit le contrat. Le frontend s'y adapte. Tout changement de contrat doit être répercuté immédiatement dans la documentation de consommation.
> **Source de vérité fonctionnelle** : le cahier des charges fonctionnel AdresseBJ (v5) prime sur ce document en cas de divergence. Ce document en est la traduction technique.

---

## Table des matières

1. [Contexte et rôle du backend](#1-contexte-et-rôle-du-backend)
2. [Modèle conceptuel : Localisation et Adresse](#2-modèle-conceptuel--localisation-et-adresse)
3. [Stack technique](#3-stack-technique)
4. [Architecture applicative](#4-architecture-applicative)
5. [Schéma de base de données](#5-schéma-de-base-de-données)
6. [Modules NestJS](#6-modules-nestjs)
7. [Rôles et contrôle d'accès](#7-rôles-et-contrôle-daccès)
8. [Authentification](#8-authentification)
9. [Gestion des clés API](#9-gestion-des-clés-api)
10. [Upload photos — Cloudinary](#10-upload-photos--cloudinary)
11. [Endpoints API](#11-endpoints-api)
12. [Logique métier critique](#12-logique-métier-critique)
13. [Tests](#13-tests)
14. [Les trois documentations vivantes](#14-les-trois-documentations-vivantes)
15. [Déploiement](#15-déploiement)
16. [Règles de travail](#16-règles-de-travail)

---

## 1. Contexte et rôle du backend

AdresseBJ est une infrastructure d'adressage numérique. Le backend est le cœur du système : il génère les codes adresse, orchestre l'authentification (OTP de vérification + mot de passe), gère le cycle de validation des adresses, expose l'API REST consommée à la fois par le frontend et par les développeurs tiers, et maintient la fiabilité du référentiel.

Le backend n'est pas un simple CRUD. Il porte cinq responsabilités spécifiques qui le distinguent :

- **Gestion du modèle Quartier / Localisation / Adresse** : rattachement automatique d'une localisation à son quartier (point-dans-polygone ou quartier le plus proche), rattachement automatique d'une adresse à une localisation selon un rayon de tolérance, et garantie d'unicité d'une adresse par habitant et par localisation.
- **Génération de codes uniques** sans collision, déterministes dans leur format, permanents dans le temps.
- **Workflow de modération** : deux axes — cycle de vie de l'entité adresse (`ACTIVE` / `DESACTIVEE`) et statut de chaque version de contenu via `AddressRevision` (en attente → publiée / rejetée / obsolète) — et trois files de modération distinctes.
- **Calcul de fiabilité** des adresses à partir des évaluations des habitants authentifiés.
- **Contrôle d'accès à trois niveaux humains** (Habitant, Modérateur, Administrateur) plus un niveau machine (clé API intégrateur).

Le backend ne gère pas le routage cartographique (délégué à OSRM public), ni le géocodage (délégué à Nominatim public), ni le stockage des photos (délégué à Cloudinary). Il orchestre, il ne stocke pas ce qu'il n'a pas besoin de stocker.

---

## 2. Modèle conceptuel : Localisation et Adresse

Cette distinction est le socle de tout le schéma de données. Elle doit être comprise avant toute implémentation.

Une **localisation** est un point physique unique, défini par des coordonnées GPS et un **rayon de tolérance** (15 m par défaut). Deux points GPS distants de moins de 15 m sont réputés désigner la même localisation. Les coordonnées d'une localisation sont fixées par son premier créateur et **ne changent jamais**, même si ce créateur disparaît.

Une **adresse** est la représentation qu'un habitant donne d'une localisation : une photographie, des instructions d'accès, une catégorie et un code unique partageable. **Le code identifie l'adresse, jamais la localisation.**

Règles structurantes, traduites en contraintes techniques :

| Règle métier | Traduction technique |
|--------------|----------------------|
| Une localisation porte une ou plusieurs adresses | Relation `Localisation 1—N Address`. |
| Un habitant ne dispose que d'une seule adresse par localisation | Contrainte d'unicité composite `@@unique([userId, localisationId])` sur `Address`. |
| Une localisation n'existe jamais vide | Créée avec sa première adresse ; **supprimée** physiquement de la base quand sa dernière adresse passe à `désactivée`. |
| Le rattachement à une localisation est automatique et interne | À la création, le service recherche une localisation dont le centre est à ≤ 15 m du GPS fourni. Trouvée → rattachement. Sinon → création d'une nouvelle localisation. Jamais exposé à l'habitant. |
| Le score, les évaluations et les signalements portent sur l'adresse | Toutes les relations `Rating`, `Report` pointent vers `Address`, jamais vers `Localisation`. |

**Conséquence directe** : il n'existe aucune notion de « contributeur rattaché », de « proposition de modification » ni de fusion de doublons. Plusieurs adresses sur une même localisation ne sont **pas** un doublon — c'est le fonctionnement nominal.

---

## 3. Stack technique

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

**Services externes consommés (tous encapsulés derrière un service interne) :**

- **OSRM public** (`router.project-osrm.org`) — routage, pour l'ETA. Encapsulé derrière `RoutingService`. Fallback gracieux si indisponible.
- **Nominatim public** (`nominatim.openstreetmap.org`) — géocodage texte libre de la recherche frontend. Le frontend l'appelle directement ; le backend ne le proxifie pas dans ce prototype. Même profil de risque que l'OSRM public (quota, disponibilité non garantis), documenté comme dette technique.
- **API Overpass** (OpenStreetMap) — import initial des quartiers et requête des repères avoisinants à la création. Voir section 12.

---

## 4. Architecture applicative

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
│   ├── auth.controller.ts      # request-otp, register, login (habitant + mod/admin), phone, account
│   ├── auth.service.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   └── guards/
│       ├── jwt-auth.guard.ts
│       ├── roles.guard.ts      # contrôle MODERATEUR / ADMIN
│       └── api-key.guard.ts
├── localisations/
│   ├── localisations.module.ts
│   └── localisations.service.ts  # rattachement par rayon, cycle de vie
├── addresses/
│   ├── addresses.module.ts
│   ├── addresses.controller.ts
│   ├── addresses.service.ts
│   └── dto/
│       ├── create-address.dto.ts
│       ├── update-address.dto.ts
│       └── rate-address.dto.ts
├── moderation/
│   ├── moderation.module.ts
│   ├── moderation.controller.ts  # 3 files : adresses, signalements, contributions
│   └── moderation.service.ts
├── quartiers/
│   ├── quartiers.module.ts
│   ├── quartiers.controller.ts
│   └── quartiers.service.ts
├── visits/
│   ├── visits.module.ts
│   ├── visits.controller.ts
│   └── visits.service.ts
├── api-keys/
│   ├── api-keys.module.ts
│   └── api-keys.service.ts
├── admin/
│   ├── admin.module.ts
│   └── admin.controller.ts     # quartiers, clés API, comptes modérateurs, suspension habitant
├── contributions/
│   ├── contributions.module.ts
│   ├── contributions.controller.ts  # POST /addresses/:code/contribution
│   └── contributions.service.ts
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.controller.ts  # subscribe / unsubscribe
│   └── notifications.service.ts     # Web Push + déclencheurs
├── upload/
│   ├── upload.module.ts
│   └── upload.service.ts       # Génération signature Cloudinary
└── common/
    ├── filters/
    │   └── http-exception.filter.ts
    ├── interceptors/
    │   └── transform.interceptor.ts  # Enveloppe toutes les réponses en { data, meta }
    └── decorators/
        ├── current-user.decorator.ts
        └── roles.decorator.ts         # @Roles(Role.MODERATEUR, Role.ADMIN)
```

### Conventions de réponse API

Toutes les réponses réussies sont enveloppées via `TransformInterceptor` :

```json
{
  "data": { },
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

# Rattachement localisation
LOCALISATION_RADIUS_METERS=15

# Web Push (VAPID) — générer avec: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contact@adressebj.bj
```

---

## 5. Schéma de base de données

Le schéma Prisma est l'unique source de vérité sur la structure des données. Il est versionné avec le code, jamais modifié manuellement en base.

```prisma
// prisma/schema.prisma — AdresseBJ · MLD consolidé (post-revue de modèle)
//
// Décisions intégrées (voir tags "← #x" en fin de ligne) :
//   versioning  : Address (contenu vivant) + AddressRevision (contenu candidat en re-validation)
//   #2          : suppression de localisation -> localisationId nullable + onDelete SetNull + CHECK
//   #3          : lastSessionAt déplacé de Address vers User
//   #G          : index redondants supprimés (Address.code, ApiKey.key)
//   #A          : modèle Notification (journal habitant) — distinct de PushSubscription (transport)
//   #F          : modèle ApiRequestLog (couche métering) — calcul du ratio de remontée
//   #E          : suppression de compte = pierre tombale anonymisée (User.deletedAt, jamais de hard-delete)
//   #J          : audit de modération en ligne (reviewedById / deactivatedById)
//   #H          : Visit.source supprimé (la nullité de apiKeyId EST la source)
//
// Contraintes hors-DSL : voir prisma/migrations/manual/constraints.sql

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Utilisateurs ─────────────────────────────────────────────────────────────

model User {
  id              String     @id @default(cuid())
  phone           String?    @unique   // Habitant : identifiant de connexion (+ OTP à l'inscription). Nullable = tombstone (#E)
  email           String?    @unique   // Modérateur/Admin : identifiant de connexion. Habitant : obligatoire à la création (invariante OCL), nullable = tombstone
  password        String?              // bcrypt — TOUS les rôles. Nullable = tombstone (#E) ; obligatoire à la création
  firstName       String?
  lastName        String?
  role            Role       @default(HABITANT)
  status          UserStatus @default(ACTIVE)
  suspendedReason String?
  lastSessionAt   DateTime?            // ← #3 : déplacé depuis Address (MAJ à chaque auth réussie)
  deletedAt       DateTime?            // ← #E : pierre tombale anonymisée (jamais de hard-delete)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  addresses             Address[]         @relation("AddressOwner")
  otpCodes              OtpCode[]
  ratings               Rating[]
  reports               Report[]          @relation("ReportAuthor")
  contributions         Contribution[]    @relation("ContributionAuthor")
  pushSubscriptions     PushSubscription[]
  notifications         Notification[]                                   // ← #A

  reviewedReports       Report[]          @relation("ReportReviewer")      // ┐ audit
  reviewedContributions Contribution[]    @relation("ContributionReviewer")// │ modération
  reviewedRevisions     AddressRevision[] @relation("RevisionReviewer")    // ┘ (#J)
  deactivatedAddresses  Address[]         @relation("AddressDeactivator")  // désactivation d'entité
}

enum Role {
  HABITANT
  MODERATEUR
  ADMIN
}

enum UserStatus {
  ACTIVE
  SUSPENDED // habitant suspendu par un admin (durée indéterminée)
  DEACTIVATED // compte modérateur désactivé par un admin (réactivable)
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

// ─── Quartiers ────────────────────────────────────────────────────────────────
// Correspond au « quartier de ville », dernier niveau du découpage béninois
// (Département → Commune → Arrondissement → Quartier). polygon optionnel : OSM
// fournit souvent un simple point central, pas une frontière (cf. règle de
// rattachement « quartier le plus proche » dans constraints.sql / cahiers).

model Quartier {
  id        String   @id @default(cuid())
  name      String
  prefix    String   @unique
  polygon   Json?    // GeoJSON ; null si OSM ne fournit qu'un point (centerLat/centerLng servent alors au rattachement)
  centerLat Float?   // centre du quartier (point OSM ou barycentre) — repli de rattachement sans polygone
  centerLng Float?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  localisations Localisation[]
}

// ─── Localisations (point physique partagé) ───────────────────────────────────

model Localisation {
  id          String   @id @default(cuid())
  quartierId  String              // déterminé À LA CRÉATION de la localisation (point-dans-polygone, ou quartier le plus proche si pas de polygone)
  gpsLat      Float // figées par le premier créateur, immuables
  gpsLng      Float
  createdAt   DateTime @default(now())

  quartier  Quartier  @relation(fields: [quartierId], references: [id])
  addresses Address[]

  @@index([quartierId])
  // Recherche par rayon : filtrage applicatif (prototype) — ST_DWithin/PostGIS en prod.
}

// ─── Adresses (identité stable + pointeur vers la version publiée) ────────────
// Décision A : le contenu (catégorie, steps, photo, GPS) ne vit PAS ici mais
// dans AddressRevision. Address ne porte que l'identité permanente et le
// cycle de vie de l'entité (ACTIVE / DESACTIVEE). La première publication
// comme les modifications sont des révisions — un seul mécanisme, une seule file.

model Address {
  id                  String           @id @default(cuid())
  code                String           @unique          // identité permanente, jamais réattribuée
  localisationId      String? // ← #2 : nullable, réservé aux DESACTIVEE (CHECK)
  userId              String
  lifecycle           AddressLifecycle @default(ACTIVE)  // cycle de vie de l'ENTITÉ
  publishedRevisionId String?          @unique           // révision actuellement publique (null = jamais publiée)
  mapDiscoverable     Boolean          @default(true)
  deactivatedAt       DateTime?
  deactivatedById     String? // ← #J : acteur désactivation (≠ userId ⇒ modération)
  deactivationReason  String? // ← #J : motif (optionnel ; aussi dans la notif)
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  localisation      Localisation?     @relation(fields: [localisationId], references: [id], onDelete: SetNull) // ← #2
  user              User              @relation("AddressOwner", fields: [userId], references: [id])
  deactivatedBy     User?             @relation("AddressDeactivator", fields: [deactivatedById], references: [id])
  publishedRevision AddressRevision?  @relation("PublishedRevision", fields: [publishedRevisionId], references: [id])
  revisions         AddressRevision[] @relation("AddressRevisions")
  visits            Visit[]
  ratings           Rating[]
  reports           Report[]
  contributions     Contribution[]
  notifications     Notification[] // ← #A

  @@unique([userId, localisationId])
  @@index([localisationId])
  @@index([lifecycle])
  // @@index([code]) non requis — ← #G (redondant avec @unique)
}

enum AddressLifecycle {
  ACTIVE
  DESACTIVEE
}

enum AddressCategory {
  DOMICILE
  COMMERCE
  RESTAURATION
  SANTE
  EDUCATION
  ADMINISTRATION
  LOISIR
  AUTRE
}

// ─── Révisions d'adresse (unique porteur du contenu, versionné) ───────────────
// La 1re publication = révision n°1. Le pointeur Address.publishedRevisionId ne
// bascule qu'à l'APPROBATION : pendant une re-validation, l'ancienne version
// reste publique. Un rejet ne touche jamais le pointeur.

model AddressRevision {
  id              String          @id @default(cuid())
  addressId       String
  category        AddressCategory // ┐
  steps           Json //            │ contenu VERSIONNÉ
  assembledText   String //          │ (string[] assemblé)
  photoUrl        String //          │
  gpsLat          Float //           │ GPS porté par cette version
  gpsLng          Float //           ┘ (sert au rattachement ; la NAV utilise le GPS Localisation)
  status          RevisionStatus  @default(EN_ATTENTE_VALIDATION)
  rejectionReason String? // obligatoire si REJETEE (CHECK constraints.sql)
  reviewedById    String? // ← #J : modérateur ayant statué
  reviewedAt      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt // éditable tant qu'EN_ATTENTE_VALIDATION

  address      Address  @relation("AddressRevisions", fields: [addressId], references: [id])
  publishedFor Address? @relation("PublishedRevision")                 // back-relation du pointeur
  reviewedBy   User?    @relation("RevisionReviewer", fields: [reviewedById], references: [id])

  @@index([addressId])
  @@index([status])
  // unicité « ≤ 1 révision EN_ATTENTE_VALIDATION par adresse » → index partiel SQL (constraints.sql)
}

enum RevisionStatus {
  EN_ATTENTE_VALIDATION
  PUBLIEE
  REJETEE     // décision de modération : exige reviewedById + rejectionReason
  OBSOLETE    // terminal non-décisionnel : auteur disparu (suppression compte) OU adresse parente désactivée
}

// ─── Visites ─────────────────────────────────────────────────────────────────

model Visit {
  id         String    @id @default(cuid())
  addressId  String
  departAt   DateTime
  arrivedAt  DateTime?
  apiKeyId   String? // ← #H : la nullité EST la source (web ⟺ null, API ⟺ non-null)
  finalPrice Float?
  corridor   Json?
  createdAt  DateTime  @default(now())

  address Address @relation(fields: [addressId], references: [id])
  apiKey  ApiKey? @relation(fields: [apiKeyId], references: [id])

  @@index([addressId])
}

// enum VisitSource supprimé — ← #H

// ─── Évaluations ──────────────────────────────────────────────────────────────

model Rating {
  id        String   @id @default(cuid())
  addressId String
  userId    String
  stars     Int // 1..5
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  address Address @relation(fields: [addressId], references: [id])
  user    User    @relation(fields: [userId], references: [id])

  @@unique([userId, addressId])
  @@index([addressId])
}

// ─── Signalements ─────────────────────────────────────────────────────────────

model Report {
  id           String       @id @default(cuid())
  addressId    String
  userId       String
  message      String?
  status       ReportStatus @default(PENDING)
  reviewedById String? // ← #J
  reviewedAt   DateTime?
  createdAt    DateTime     @default(now())

  address  Address @relation(fields: [addressId], references: [id])
  user     User    @relation("ReportAuthor", fields: [userId], references: [id])
  reviewer User?   @relation("ReportReviewer", fields: [reviewedById], references: [id])

  @@index([addressId])
  @@index([status])
}

enum ReportStatus {
  PENDING
  RESOLVED
  ACTIONED
}

// ─── Clés API ────────────────────────────────────────────────────────────────

model ApiKey {
  id        String       @id @default(cuid())
  key       String       @unique
  label     String
  status    ApiKeyStatus @default(ACTIVE)
  expiresAt DateTime?
  createdAt DateTime     @default(now())
  revokedAt DateTime?

  visits      Visit[]
  requestLogs ApiRequestLog[] // ← #F

  // @@index([key]) supprimé — ← #G (redondant avec @unique)
}

enum ApiKeyStatus {
  ACTIVE
  REVOKED
}

// ─── Journal d'appels API (couche métering — ratio de remontée) ────────── ← #F

model ApiRequestLog {
  id        String      @id @default(cuid())
  apiKeyId  String
  endpoint  ApiEndpoint
  createdAt DateTime    @default(now())

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id])

  @@index([apiKeyId, endpoint, createdAt])
}

enum ApiEndpoint {
  RESOLVE
  VERIFY
  ETA
  CONFIRM
  ANALYTICS
}

// ─── Contributions terrain ────────────────────────────────────────────────────

model Contribution {
  id           String             @id @default(cuid())
  addressId    String
  userId       String
  message      String
  status       ContributionStatus @default(PENDING)
  reviewedById String? // ← #J
  reviewedAt   DateTime?
  createdAt    DateTime           @default(now())

  address  Address @relation(fields: [addressId], references: [id])
  user     User    @relation("ContributionAuthor", fields: [userId], references: [id])
  reviewer User?   @relation("ContributionReviewer", fields: [reviewedById], references: [id])

  @@index([addressId])
  @@index([status])
}

enum ContributionStatus {
  PENDING
  APPROVED
  REJECTED
}

// ─── Souscriptions push (transport Web Push) ─────────────────────────────────

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

// ─── Notifications (journal habitant — distinct du transport push) ──────── ← #A

model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  message   String // texte rendu (fr) — == ce qui a été poussé
  addressId String? // adresse concernée le cas échéant
  readAt    DateTime? // null = non lue
  createdAt DateTime         @default(now())

  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  address Address? @relation(fields: [addressId], references: [id], onDelete: SetNull) // ← #4

  @@index([userId, createdAt])
}

enum NotificationType {
  ADDRESS_VALIDATED
  ADDRESS_REJECTED
  RELIABILITY_WARNING
  ADDRESS_DEACTIVATED
}
```

### Note importante sur les contributions terrain

Une contribution **approuvée n'est jamais injectée dans les `steps` de l'adresse**. Le propriétaire est seul maître du contenu de son adresse (règle du cahier v5 : *« le Modérateur a le dernier mot sur la visibilité, jamais sur le contenu »*). Une contribution approuvée est publiée comme **information terrain complémentaire** rattachée à l'adresse (affichée à part, en lecture seule). Si le propriétaire souhaite l'intégrer à ses instructions, il le fait lui-même via une modification d'adresse classique.

### Règles de migration

- Chaque modification de schéma déclenche une migration Prisma nommée : `prisma migrate dev --name <description-courte>`.
- Les migrations sont commitées avec le code qui les nécessite, dans le même commit.
- Jamais de `prisma db push` en production — uniquement `prisma migrate deploy`.

### Contraintes hors-DSL Prisma (`constraints.sql`)

Certaines contraintes d'intégrité ne sont pas exprimables dans le schéma Prisma et vivent dans `prisma/migrations/manual/constraints.sql`, intégrées via une migration `--create-only`. Elles sont **partie intégrante du modèle**, pas optionnelles :

- **`one_pending_revision_per_address`** (index unique partiel) : au plus une `AddressRevision` en `EN_ATTENTE_VALIDATION` par adresse — filet anti-race contre deux soumissions concurrentes.
- **`localisation_required_unless_deactivated`** (CHECK) : une adresse non désactivée doit avoir une localisation (`lifecycle = 'DESACTIVEE' OR localisationId IS NOT NULL`). Le `null` est structurellement réservé aux adresses désactivées dont la localisation a été purgée (`onDelete: SetNull`).
- **`rejected_revision_requires_audit`** (CHECK) : une révision `REJETEE` exige un auteur (`reviewedById`) et un motif (`rejectionReason`) — ce qui la distingue d'une révision `OBSOLETE`, terminale et sans décision.
- **`rating_stars_range`** (CHECK) : `stars BETWEEN 1 AND 5`.
- **`visit_arrival_after_departure`** (CHECK) : `arrivedAt IS NULL OR arrivedAt >= departAt`.

---

## 6. Modules NestJS

### AuthModule

Responsabilités : authentification des trois profils.

- **Habitant — inscription** : `POST /api/v1/auth/request-otp` (crée un `OtpCode`, envoie le SMS) puis `POST /api/v1/auth/register` (vérifie le code OTP, **définit le mot de passe et l'email obligatoires**, crée le `User` de rôle `HABITANT`, retourne un JWT). L'OTP ne sert qu'à prouver la possession du numéro.
- **Habitant — connexion courante** : `POST /api/v1/auth/login` avec `{ phone, password }` (vérification bcrypt, retourne un JWT). **Pas d'OTP à la connexion.**
- **Habitant — changement de numéro** : `PATCH /api/v1/auth/phone` re-déclenche un OTP sur le nouveau numéro (preuve de possession), sans toucher au mot de passe.
- **Modérateur / Administrateur** : `POST /api/v1/auth/login` avec `{ email, password }` (vérification bcrypt). `POST /api/v1/auth/password-reset` pour la réinitialisation par email.

> `POST /auth/login` accepte donc soit `{ phone, password }` (habitant) soit `{ email, password }` (mod/admin) : un identifiant + mot de passe, l'identifiant variant selon le rôle. L'OTP n'est **jamais** un moyen de connexion — uniquement une vérification de numéro à l'inscription et au changement de numéro.

**Durée de vie OTP** : 5 minutes. Un seul OTP actif par numéro à la fois. L'OTP précédent est invalidé dès qu'un nouveau est demandé.

**Format du SMS** : `Votre code AdresseBJ : 847291. Valable 5 minutes.`

### LocalisationsModule

Service uniquement — pas de controller public. Porte la logique de rattachement par rayon et le cycle de vie des localisations (voir section 12). Consommé par `AddressesService` à la création et à la désactivation.

### AddressesModule

Responsabilités : création (avec rattachement localisation + génération de code), modification (avec re-validation), désactivation, consultation publique, résolution API, évaluation, signalement.

Le `AddressesService` porte la machine à états des adresses, la génération de code, et le calcul du score de fiabilité.

### ModerationModule

Responsabilités : exposer les **trois files de modération** au Modérateur et à l'Administrateur, et traiter les décisions.

- **File 1 — Révisions en attente** : `AddressRevision` en `EN_ATTENTE_VALIDATION` (qu'il s'agisse d'une première publication ou d'une modification — un seul mécanisme). Action : valider (→ la révision devient `PUBLIEE` et le pointeur `Address.publishedRevisionId` bascule sur elle) ou rejeter (→ `REJETEE` avec motif + auteur obligatoires ; le pointeur ne bouge pas). La file lit **une seule table**.
- **File 2 — Signalements en attente** : `Report` en `PENDING`. Action : marquer résolu, ou désactiver l'adresse signalée.
- **File 3 — Contributions terrain en attente** : `Contribution` en `PENDING`. Action : approuver (publiée comme info terrain) ou rejeter.

Toutes les routes de ce module sont protégées par `RolesGuard` avec `@Roles(Role.MODERATEUR, Role.ADMIN)`.

### QuartiersModule

Responsabilités : liste des quartiers actifs, analytics par quartier.

Un script d'initialisation `scripts/seed-quartiers.ts` importe les quartiers depuis l'API Overpass (OpenStreetMap), renseigne leur polygone si disponible (sinon leur point central) et génère les préfixes automatiquement. Exécuté une seule fois à l'initialisation, pas à chaque démarrage.

### VisitsModule

Responsabilités : enregistrement des départs de navigation (horodatage), confirmation d'arrivée, remontée de données intégrateurs. Les visites alimentent l'ETA et les analytics de quartier — **jamais le score de fiabilité** (qui ne dépend que des évaluations habitants).

### ApiKeysModule

Service uniquement — pas de controller public. Les clés sont créées et révoquées exclusivement par l'administrateur via l'`AdminModule`.

### UploadModule

Responsabilités : générer une signature Cloudinary côté serveur pour permettre un upload direct depuis le frontend. Ce module n'interagit jamais avec des fichiers binaires. Il produit uniquement un `{ signature, timestamp, apiKey, cloudName, folder, transformation }`.

### AdminModule

Routes protégées par `RolesGuard` + rôle `ADMIN` (strictement, pas Modérateur). Fonctionnalités exclusives à l'administrateur :

- Gestion des quartiers (création manuelle, ajustement de périmètre, renommage, activation/désactivation).
- Gestion des clés API (création, révocation).
- **Gestion des comptes Modérateurs** : création manuelle, désactivation/réactivation, réinitialisation de mot de passe.
- **Suspension d'un compte Habitant** (et levée de suspension).
- Supervision du référentiel (recherche + filtres).

> Toutes les capacités de modération (les 3 files) sont **héritées** par l'Administrateur via le `RolesGuard` : `@Roles(Role.MODERATEUR, Role.ADMIN)` accepte les deux. Les capacités ci-dessus sont en plus, réservées à `@Roles(Role.ADMIN)`.

### ContributionsModule

Responsabilités : réception des contributions terrain (champ texte libre) soumises par les **habitants authentifiés** après une navigation. Soumission en `PENDING`. La validation/rejet se fait dans le `ModerationModule`. Une contribution approuvée devient une information terrain complémentaire de l'adresse — **elle ne modifie jamais les `steps`**.

### NotificationsModule

Responsabilités : gestion des souscriptions push des habitants et envoi des notifications via l'API Web Push (`web-push`).

**Déclencheurs de notification** (tous via `NotificationsService.notifyOwner()`, jamais depuis un controller) :

- **Validation d'adresse** : adresse passée en `PUBLIEE` par la modération.
- **Rejet d'adresse** : adresse passée en `REJETEE`, avec motif obligatoire.
- **Dégradation du score** (seuil intermédiaire) : la moyenne des évaluations passe sous un seuil bas (ex : moyenne < 2.5/5) après une nouvelle évaluation.
- **Désactivation par modération** : adresse désactivée par un Modérateur ou un Administrateur, avec motif.

Toutes les notifications sont **persistées** (consultables depuis l'espace personnel de l'habitant), en plus de l'envoi push best-effort. Les clés VAPID sont générées une seule fois et stockées en variables d'environnement.

---

## 7. Rôles et contrôle d'accès

Trois rôles humains + un accès machine. La hiérarchie n'est pas un simple niveau croissant : Habitant et Modérateur ont des périmètres **disjoints**, l'Administrateur cumule Modérateur + ses propres prérogatives.

| Acteur | Authentification | Périmètre |
|--------|------------------|-----------|
| **Habitant** | Téléphone + OTP (inscription/changement n°), puis téléphone + mot de passe | Créer/modifier/désactiver ses adresses ; évaluer, signaler, contribuer sur les adresses publiées ; gérer son compte. |
| **Modérateur** | Email + mot de passe (compte créé par un Admin) | Les 3 files de modération, exclusivement. Aucune gestion de quartier, clé API ou compte. |
| **Administrateur** | Email + mot de passe (compte créé manuellement) | Tout le périmètre Modérateur **+** quartiers, clés API, comptes Modérateurs, suspension d'Habitants, supervision. |
| **Développeur tiers** | Clé API `bj_live_[16car]` | Endpoints `/resolve`, `/verify`, `/eta`, `/visits/confirm`, `/quartiers/:id/analytics`. |

### Implémentation des gardes

- `JwtAuthGuard` — valide le JWT, peuple `request.user` avec `{ sub, role, ... }`.
- `RolesGuard` + décorateur `@Roles(...)` — vérifie que `request.user.role` figure dans la liste autorisée. Routes de modération : `@Roles(Role.MODERATEUR, Role.ADMIN)`. Routes d'administration pure : `@Roles(Role.ADMIN)`.
- `ApiKeyGuard` — valide le header `Authorization: Bearer bj_live_...`, statut `ACTIVE`, expiration éventuelle.

### Effet de la suspension d'un Habitant

Un Habitant en `status = SUSPENDED` : ses adresses publiées **restent visibles**, mais sa capacité à créer une adresse, évaluer, signaler ou contribuer est **gelée** (vérifiée dans les services concernés). Levée manuellement par un Admin.

---

## 8. Authentification

### Flux d'inscription Habitant (OTP de vérification, puis mot de passe)

```
Frontend                         Backend                        Africa's Talking
   |                                |                                  |
   |-- POST /auth/request-otp ----->|                                  |
   |   { phone: "+22960000000" }    |                                  |
   |                                |-- SMS API (OTP 6 chiffres) ----->|
   |                                |<- confirmation envoi ------------|
   |<-- 200 { message: "OTP sent" } |                                  |
   |                                |                                  |
   |-- POST /auth/register -------->|                                  |
   |   { phone, code,               |-- vérifie OtpCode, hash bcrypt,  |
   |     password, email }          |   crée le User HABITANT          |
   |<-- 201 { accessToken, user } --|   (email + password obligatoires)|
```

> L'OTP **vérifie le numéro**, il ne connecte pas. Le compte n'est créé qu'à `/register`, avec mot de passe et email. Sans `register`, aucun compte n'existe.

### Connexion (Habitant, Modérateur, Administrateur)

```
Frontend                         Backend
   |-- POST /auth/login ----------->|
   |   habitant : { phone, password }   |-- bcrypt.compare, vérifie role + status
   |   mod/admin: { email, password }   |   (identifiant selon le rôle)
   |<-- 200 { accessToken, user } --|
```
```

### JWT

- Payload minimal : `{ sub: userId, role }` (+ `phone` pour habitant, `email` pour mod/admin).
- Expiration : 7 jours. Pas de refresh token pour le prototype.
- Tout endpoint qui modifie des données requiert un JWT valide via `JwtAuthGuard`, plus `RolesGuard` le cas échéant.

### Garde API Key

Les endpoints `/resolve`, `/verify`, `/eta`, `POST /visits/confirm`, `GET /quartiers/:id/analytics` requièrent le header `Authorization: Bearer bj_live_[16car]`. La garde `ApiKeyGuard` valide la clé, son statut `ACTIVE`, son expiration si présente.

**Clé révoquée** : HTTP 401 avec corps `{ "code": "API_KEY_REVOKED" }`.

---

## 9. Gestion des clés API

**Format** : `bj_live_` suivi de 16 caractères alphanumériques aléatoires (base 62).

**Génération** : côté backend, par l'administrateur uniquement. Stockée en clair dans `key` (ce ne sont pas des données sensibles type mot de passe). Identifiable dans les logs par son préfixe sans exposer le reste.

**Quota analytique** : l'accès à `GET /quartiers/:id/analytics` est conditionné à un ratio de remontée `visits/confirm` ≥ 80 % sur 30 jours glissants. Ratio calculé à la demande, pas stocké : `confirmedVisits / totalVisits` sur `Visit` WHERE `createdAt >= NOW() - INTERVAL '30 days'` AND `apiKeyId = $1`. L'endpoint `resolve` reste toujours accessible quel que soit le ratio.

---

## 10. Upload photos — Cloudinary

### Flux : upload direct depuis le frontend (signature backend)

Le backend ne manipule jamais de données binaires. Il génère une signature sécurisée que le frontend utilise pour uploader directement vers Cloudinary.

```
Frontend                              Backend                    Cloudinary
   |-- POST /upload/signature ---------->|                           |
   |   Header: Authorization Bearer JWT  |-- génère signature HMAC   |
   |<-- 200 { signature, timestamp,      |                           |
   |          apiKey, cloudName,         |                           |
   |          folder, transformation } --|                           |
   |-- POST (direct Cloudinary) -------------------------------------->|
   |   FormData { file, signature, timestamp, api_key, folder, transformation }
   |<------------------------------------------------- { secure_url } |
   |-- POST /addresses { ..., photoUrl: secure_url } ---------------->|
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

La transformation `q_auto,f_auto` réduit le poids moyen de ~500 Ko à ~80–120 Ko sans perte visuelle perceptible.

---

## 11. Endpoints API

Tous les endpoints sont préfixés `/api/v1/`. Le Swagger est disponible sur `/api/docs`.

### Vue d'ensemble

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/request-otp` | Public | Demande d'OTP SMS (vérification numéro habitant) |
| POST | `/auth/register` | Public | Inscription habitant : vérifie OTP + définit mot de passe & email → JWT |
| POST | `/auth/login` | Public | Connexion : `{phone,password}` (habitant) ou `{email,password}` (mod/admin) → JWT |
| POST | `/auth/password-reset` | Public | Réinitialisation mot de passe mod/admin |
| PATCH | `/auth/profile` | JWT | Modifier nom/prénom/email (habitant) |
| PATCH | `/auth/phone` | JWT | Changer de numéro (re-vérification OTP) |
| DELETE | `/auth/account` | JWT | Suppression de compte (anonymisation immédiate) |
| POST | `/upload/signature` | JWT | Signature Cloudinary |
| POST | `/addresses` | JWT (habitant) | Création d'adresse (rattachement localisation auto) |
| GET | `/addresses/mine` | JWT (habitant) | Mes adresses + leur état |
| PATCH | `/addresses/:code` | JWT (propriétaire) | Modification adresse (→ re-validation) |
| PATCH | `/addresses/:code/discoverable` | JWT (propriétaire) | Toggle découverte cartographique |
| DELETE | `/addresses/:code` | JWT (propriétaire) | Désactivation adresse |
| GET | `/addresses/:code` | Public | Page publique (visiteur) |
| GET | `/addresses/:code/resolve` | API Key | Résolution complète |
| GET | `/addresses/:code/verify` | API Key | Moyenne des évaluations |
| GET | `/addresses/:code/eta` | API Key | Estimation ETA |
| POST | `/addresses/:code/rate` | JWT (habitant) | Évaluation 5 étoiles (upsert) |
| POST | `/addresses/:code/report` | JWT (habitant) | Signalement |
| POST | `/addresses/:code/contribution` | JWT (habitant) | Contribution terrain (texte libre) |
| GET | `/map/addresses` | Public | Surcouche carte : adresses publiées + découvrables (bbox) |
| POST | `/visits/start` | Public | Horodatage de départ navigation (anonyme) |
| POST | `/visits/confirm` | Public ou API Key | Confirmation arrivée / remontée intégrateur |
| GET | `/quartiers` | Public | Liste des quartiers actifs |
| GET | `/quartiers/:id/analytics` | API Key + quota | Analytics de quartier |
| GET | `/moderation/revisions` | JWT Mod/Admin | File 1 : révisions en attente (créations + modifications) |
| PATCH | `/moderation/revisions/:id/approve` | JWT Mod/Admin | Valider une révision (devient PUBLIEE, bascule le pointeur) |
| PATCH | `/moderation/revisions/:id/reject` | JWT Mod/Admin | Rejeter une révision (motif obligatoire, pointeur inchangé) |
| GET | `/moderation/reports` | JWT Mod/Admin | File 2 : signalements en attente |
| PATCH | `/moderation/reports/:id/resolve` | JWT Mod/Admin | Marquer signalement résolu |
| PATCH | `/moderation/reports/:id/deactivate` | JWT Mod/Admin | Désactiver l'adresse signalée |
| GET | `/moderation/contributions` | JWT Mod/Admin | File 3 : contributions en attente |
| PATCH | `/moderation/contributions/:id/approve` | JWT Mod/Admin | Approuver une contribution |
| PATCH | `/moderation/contributions/:id/reject` | JWT Mod/Admin | Rejeter une contribution |
| POST | `/admin/quartiers` | JWT Admin | Création quartier manuelle |
| PATCH | `/admin/quartiers/:id` | JWT Admin | Modification / activation quartier |
| GET | `/admin/addresses` | JWT Admin | Supervision référentiel (recherche + filtres) |
| POST | `/admin/moderators` | JWT Admin | Créer un compte Modérateur |
| PATCH | `/admin/moderators/:id` | JWT Admin | Désactiver/réactiver/réinitialiser un Modérateur |
| PATCH | `/admin/users/:id/suspend` | JWT Admin | Suspendre un Habitant (motif) |
| PATCH | `/admin/users/:id/unsuspend` | JWT Admin | Lever la suspension |
| POST | `/admin/api-keys` | JWT Admin | Création clé API |
| DELETE | `/admin/api-keys/:id` | JWT Admin | Révocation clé API |
| POST | `/notifications/subscribe` | JWT | Enregistrer endpoint push |
| DELETE | `/notifications/unsubscribe` | JWT | Se désinscrire |
| GET | `/notifications` | JWT (habitant) | Historique des notifications |

---

### Détail des endpoints critiques

#### `POST /api/v1/auth/register` (inscription habitant)

```typescript
// Body — email et password obligatoires
{ "phone": "+22960000000", "code": "847291", "password": "...", "email": "habitant@example.bj" }

// Réponse 201
{ "data": { "accessToken": "eyJ...", "user": { "id": "...", "phone": "+22960000000", "email": "habitant@example.bj", "role": "HABITANT" } } }

// Erreur 401 — OTP invalide/expiré
{ "statusCode": 401, "code": "INVALID_OR_EXPIRED_OTP" }
// Erreur 400 — email ou mot de passe manquant
{ "statusCode": 400, "code": "EMAIL_AND_PASSWORD_REQUIRED" }
// Erreur 409 — numéro déjà inscrit
{ "statusCode": 409, "code": "PHONE_ALREADY_REGISTERED" }
```

#### `POST /api/v1/auth/login` (habitant, modérateur, administrateur)

```typescript
// Body habitant
{ "phone": "+22960000000", "password": "..." }
// Body mod/admin
{ "email": "moderateur@adressebj.bj", "password": "..." }

// Réponse 200
{ "data": { "accessToken": "eyJ...", "user": { "id": "...", "role": "HABITANT" } } }

// Erreur 401
{ "statusCode": 401, "code": "INVALID_CREDENTIALS" }
// Erreur 403 — compte modérateur désactivé
{ "statusCode": 403, "code": "ACCOUNT_DEACTIVATED" }
```

#### `POST /api/v1/addresses`

Ni le `localisationId`, ni le `quartierId` ne sont fournis par le client. Le backend les détermine seul à partir du GPS : d'abord la localisation (rattachement par rayon de 15 m), puis — à la création d'une nouvelle localisation — son quartier (point-dans-polygone, ou quartier le plus proche si le quartier n'a pas de polygone). Le client n'a conscience que de créer son adresse.

```typescript
// Header: Authorization: Bearer <JWT habitant>
// Body
{
  "category": "DOMICILE",
  "steps": [
    "Partir du marché Dantokpa",
    "Prendre la 2ème rue à droite",
    "Portail bleu avec étoile jaune",
    "Entrée côté nord"
  ],
  "gpsLat": 6.3676,
  "gpsLng": 2.4252,
  "photoUrl": "https://res.cloudinary.com/adressebj/.../xyz.jpg"
}

// Réponse 201 — adresse créée (lifecycle ACTIVE), révision n°1 en EN_ATTENTE_VALIDATION
{
  "data": {
    "code": "AKP-7X3K",
    "lifecycle": "ACTIVE",
    "revisionStatus": "EN_ATTENTE_VALIDATION",
    "published": false,
    "category": "DOMICILE",
    "assembledText": "Partir du marché Dantokpa. Prendre la 2ème rue à droite. Portail bleu avec étoile jaune. Entrée côté nord.",
    "shareUrl": "https://adressebj.vercel.app/a/AKP-7X3K",
    "whatsappUrl": "https://wa.me/?text=Mon adresse AdresseBJ : AKP-7X3K → https://adressebj.vercel.app/a/AKP-7X3K"
  }
}

// Erreur 400 — coordonnées hors périmètre
{ "statusCode": 400, "code": "COORDINATES_OUT_OF_COVERAGE" }
// Erreur 400 — steps insuffisants
{ "statusCode": 400, "code": "STEPS_REQUIRED", "message": "Au moins 2 étapes sont requises" }
// Erreur 400 — catégorie manquante ou invalide
{ "statusCode": 400, "code": "CATEGORY_REQUIRED" }
// Erreur 409 — l'habitant a déjà une adresse sur cette localisation
{ "statusCode": 409, "code": "ADDRESS_ALREADY_EXISTS_AT_LOCATION",
  "message": "Vous avez déjà une adresse à cet endroit. Modifiez-la plutôt que d'en créer une seconde.",
  "existingCode": "AKP-7X3K" }
```

> **Note** : une adresse fraîchement créée a `published: false` (aucune révision encore publiée), donc **non résolvable publiquement ni via API** tant qu'un Modérateur/Admin n'a pas validé sa révision n°1. Le `shareUrl` est retourné mais ne donnera accès au contenu qu'après publication.

#### `GET /api/v1/addresses/:code/resolve`

```typescript
// Header: Authorization: Bearer bj_live_xxxxxxxxxxxxxxxx

// Réponse 200 (uniquement si lifecycle = ACTIVE ET une révision est publiée).
// Le contenu servi est celui de la révision pointée par publishedRevisionId.
{
  "data": {
    "code": "AKP-7X3K",
    "category": "DOMICILE",
    "quartier": { "id": "...", "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du marché Dantokpa", "..."],
    "assembledText": "Partir du marché Dantokpa. ...",
    "createdAt": "2026-05-01T10:00:00Z"
  }
}

// Erreur 404 — inexistante OU jamais publiée (existence non exposée)
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }

// Erreur 410 — désactivée
{
  "statusCode": 410, "code": "ADDRESS_INACTIVE",
  "message": "This address has been deactivated.",
  "address_code": "AKP-7X3K", "deactivated_at": "2026-03-14T10:22:00Z"
}
```

#### `GET /api/v1/addresses/:code/verify`

```typescript
// Header: Authorization: Bearer bj_live_...

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "averageRating": 3.7,        // moyenne /5, arrondie au dixième — null si aucune évaluation
    "ratingCount": 12,
    "published": true
  }
}
```

> Conçu pour les cas d'usage de vérification (KYC fintech, banques, assurances). `averageRating` à `null` signifie « aucune évaluation », à distinguer d'une note basse.

#### `GET /api/v1/addresses/:code` — Endpoint public visiteur

Appelé par le frontend sans clé API, y compris dans `generateMetadata` (og:tags WhatsApp). Expose tout le nécessaire à la page de consultation.

```typescript
// Public — pas d'auth, pas de clé API

// Réponse 200 (uniquement si lifecycle = ACTIVE ET une révision est publiée ;
// gps = coordonnées de la LOCALISATION, pas de la révision)
{
  "data": {
    "code": "AKP-7X3K",
    "category": "DOMICILE",
    "quartier": { "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["Partir du marché Dantokpa", "..."],
    "assembledText": "Partir du marché Dantokpa. ...",
    "averageRating": 3.7,        // null si aucune évaluation
    "ratingCount": 12,
    "fieldNotes": [              // contributions terrain approuvées (lecture seule)
      { "message": "Sens unique le matin, entrer par le nord", "createdAt": "..." }
    ],
    "createdAt": "2026-05-01T10:00:00Z"
  }
}

// Erreur 404 — inexistante ou jamais publiée
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }
// Erreur 410 — désactivée
{ "statusCode": 410, "code": "ADDRESS_INACTIVE", "address_code": "AKP-7X3K", "deactivated_at": "..." }
```

> `averageRating` est `null` (et non `0`) quand aucune évaluation n'existe. Le frontend affiche alors « Aucune évaluation pour le moment ».

#### `GET /api/v1/map/addresses` — Surcouche carte browsable

Retourne les adresses publiées **et** découvrables (`mapDiscoverable = true`) dans une aire géographique (bounding box). Le niveau de détail dépend de la catégorie (matrice de visibilité du cahier v5).

```typescript
// Public — query params: ?north=6.40&south=6.34&east=2.46&west=2.40&category=COMMERCE (optionnel)

// Réponse 200
{
  "data": [
    {
      "code": "CAD-3M9P",
      "category": "COMMERCE",
      "gps": { "lat": 6.366, "lng": 2.421 },
      "muted": false,                 // commerce → marqueur en clair
      "preview": { "photoUrl": "https://res.cloudinary.com/...", "code": "CAD-3M9P" }
    },
    {
      "code": "AKP-7X3K",
      "category": "DOMICILE",
      "gps": { "lat": 6.367, "lng": 2.425 },
      "muted": true,                  // domicile → marqueur muet
      "preview": null                 // aucun aperçu ; contenu seulement à l'ouverture (= consultation)
    }
  ]
}
```

> **Règle de visibilité** (appliquée côté backend, jamais déléguée au client) :
> - `category = DOMICILE` → `muted: true`, `preview: null`. Le contenu n'est accessible qu'en appelant `GET /addresses/:code` (acte de consultation).
> - toute autre catégorie → `muted: false`, `preview` rempli (photo + code).
> - Une adresse avec `mapDiscoverable = false` n'est **jamais** retournée par cet endpoint, quelle que soit sa catégorie. Sa résolution par code reste possible.

#### `POST /api/v1/addresses/:code/rate`

```typescript
// Header: Authorization: Bearer <JWT habitant>
// Body
{ "stars": 4 }    // entier 1..5

// Réponse 200 — upsert sur (userId, addressId), recalcul immédiat de la moyenne
{ "data": { "recorded": true, "averageRating": 3.8, "ratingCount": 13 } }

// Erreur 400 — note hors bornes
{ "statusCode": 400, "code": "INVALID_RATING" }
// Erreur 403 — habitant suspendu
{ "statusCode": 403, "code": "ACCOUNT_SUSPENDED" }
// Erreur 404 — adresse non publiée
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }
```

> Un habitant ne peut soumettre qu'**une** évaluation par adresse. Une nouvelle soumission **remplace** la précédente (upsert sur la contrainte `@@unique([userId, addressId])`). Modifiable à tout moment.

#### `POST /api/v1/addresses/:code/contribution`

```typescript
// Header: Authorization: Bearer <JWT habitant>
// Body
{ "message": "Le portail a été repeint en vert, l'étoile a disparu." }

// Réponse 201
{ "data": { "contributionId": "contrib_cuid", "status": "PENDING" } }

// Erreur 400 — message vide
{ "statusCode": 400, "code": "CONTRIBUTION_MESSAGE_REQUIRED" }
// Erreur 404 — adresse non publiée
{ "statusCode": 404, "code": "ADDRESS_NOT_FOUND" }
```

#### `POST /api/v1/visits/start` et `POST /api/v1/visits/confirm`

```typescript
// POST /visits/start — Public (anonyme), au lancement de la navigation
// Body
{ "addressCode": "AKP-7X3K", "departAt": "2026-05-17T09:00:00Z" }
// Réponse 201
{ "data": { "visitId": "visit_cuid" } }

// POST /visits/confirm — Public (bouton « J'y suis ») OU API Key (intégrateur)
// Body (web)    : { "visitId": "visit_cuid", "arrivedAt": "2026-05-17T09:14:00Z" }
// Body (API key): { "addressCode": "AKP-7X3K", "departAt": "...", "arrivedAt": "...", "finalPrice": 1500 }
// Réponse 201
{ "data": { "visitId": "visit_cuid", "recorded": true } }

// Erreur 400
{ "statusCode": 400, "code": "INVALID_VISIT_TIMESTAMPS" }
```

> Les visites alimentent l'ETA et les analytics de quartier. **Elles n'entrent pas dans le calcul du score de fiabilité.**

#### `GET /api/v1/quartiers/:id/analytics`

```typescript
// Header: Authorization: Bearer bj_live_...  (+ ratio remontée >= 80% / 30j)

// Réponse 200
{
  "data": {
    "quartierId": "...", "quartierName": "Akpakpa",
    "totalVisits": 142, "medianEtaMinutes": 11, "medianPriceFCFA": 1200,
    "peakHours": ["08:00-09:00", "17:00-18:00"], "successRate": 0.94,
    "period": "last_30_days"
  }
}

// Erreur 403 — quota insuffisant
{ "statusCode": 403, "code": "ANALYTICS_QUOTA_INSUFFICIENT",
  "message": "Ratio de remontée insuffisant (67% < 80% requis sur 30 jours)." }
```

#### File de modération — exemples

```typescript
// GET /api/v1/moderation/revisions — Header: JWT Mod/Admin
// Réponse 200 : révisions en EN_ATTENTE_VALIDATION (créations ET modifications)
{ "data": [ {
    "id": "rev_cuid",
    "addressCode": "AKP-7X3K",
    "kind": "CREATION",            // "CREATION" (1re publication) | "MODIFICATION"
    "category": "DOMICILE",
    "photoUrl": "...", "assembledText": "...",
    "quartier": { "name": "Akpakpa" },
    "createdAt": "..."
} ] }

// PATCH /api/v1/moderation/revisions/:id/approve
// → révision devient PUBLIEE, Address.publishedRevisionId bascule sur elle, notification habitant
{ "data": { "revisionId": "rev_cuid", "addressCode": "AKP-7X3K", "status": "PUBLIEE", "published": true } }

// PATCH /api/v1/moderation/revisions/:id/reject — Body { "reason": "Photo illisible" } (obligatoire)
// → révision REJETEE (reviewedById + rejectionReason enregistrés) ; le pointeur ne bouge pas,
//   la version en ligne précédente (s'il y en a une) reste publique.
{ "data": { "revisionId": "rev_cuid", "status": "REJETEE", "rejectionReason": "Photo illisible" } }
// Erreur 400 si motif absent
{ "statusCode": 400, "code": "REJECTION_REASON_REQUIRED" }
```

#### `DELETE /api/v1/auth/account`

```typescript
// Header: Authorization: Bearer <JWT habitant>
// Body
{ "phone": "+22960000000" }   // confirmation : doit correspondre au compte connecté

// Comportement (transaction) :
// 1. Vérifie que phone correspond à l'utilisateur du JWT.
// 2. Désactive toutes ses adresses (lifecycle = DESACTIVEE, deactivatedAt = now(), deactivatedById = userId).
// 3. Passe ses AddressRevision encore EN_ATTENTE_VALIDATION à OBSOLETE (sortie de la file de modération).
// 4. Pour chaque localisation dont il retire la dernière adresse → suppression de la localisation.
//    Les localisations portant encore d'autres adresses ne sont pas touchées.
// 5. Anonymise immédiatement : phone → null, email → null, prénom/nom → null, deletedAt = now()
//    (pierre tombale ; PAS de hard-delete — préserve l'intégrité des évaluations/signalements/contributions).
// 6. Révoque les OTP actifs, supprime PushSubscriptions ET Notifications (donnée perso).
// 7. Évaluations, signalements, contributions conservés (userId préservé vers la tombstone anonyme ;
//    textes libres conservés — couverts par la politique de confidentialité).

// Réponse 200
{ "data": { "deleted": true, "anonymizedAt": "2026-05-17T10:00:00Z" } }

// Erreur 400 — téléphone ne correspond pas
{ "statusCode": 400, "code": "PHONE_MISMATCH" }
```

---

## 12. Logique métier critique

### Rattachement à une localisation (cœur du modèle)

À la création d'une adresse, le système ne reçoit jamais de `localisationId`. Il le détermine seul :

```typescript
// localisations.service.ts
private readonly RADIUS_M = Number(process.env.LOCALISATION_RADIUS_METERS ?? 15);

// Distance approchée (Haversine) entre deux points GPS, en mètres.
private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Détermine le quartier d'un point : point-dans-polygone si dispo, sinon le plus proche.
async resolveQuartier(lat: number, lng: number): Promise<Quartier> {
  const quartiers = await this.prisma.quartier.findMany({ where: { isActive: true } });
  // 1) quartier dont le polygone contient le point (point-in-polygon applicatif)
  const containing = quartiers.find(q => q.polygon && pointInPolygon([lng, lat], q.polygon));
  if (containing) return containing;
  // 2) repli : quartier le plus proche de son centre (centerLat/centerLng)
  const withCenter = quartiers.filter(q => q.centerLat != null && q.centerLng != null);
  if (withCenter.length === 0) throw new BadRequestException('COORDINATES_OUT_OF_COVERAGE');
  return withCenter.reduce((best, q) =>
    this.distanceMeters(lat, lng, q.centerLat!, q.centerLng!) <
    this.distanceMeters(lat, lng, best.centerLat!, best.centerLng!) ? q : best);
}

// Retourne la localisation existante dans le rayon, ou en crée une nouvelle
// (en lui attribuant son quartier au passage).
async resolveOrCreate(lat: number, lng: number): Promise<Localisation> {
  // Prototype : filtrage applicatif. (Production : PostGIS ST_DWithin.)
  const candidates = await this.prisma.localisation.findMany();
  const match = candidates.find(
    (l) => this.distanceMeters(lat, lng, l.gpsLat, l.gpsLng) <= this.RADIUS_M,
  );
  if (match) return match;                                   // rattachement : quartier déjà fixé
  const quartier = await this.resolveQuartier(lat, lng);     // nouvelle localisation → on fixe son quartier
  return this.prisma.localisation.create({
    data: { quartierId: quartier.id, gpsLat: lat, gpsLng: lng },
  });
}
```

**Règles associées, vérifiées dans `AddressesService.create()` :**

1. `resolveOrCreate(lat, lng)` → obtenir la localisation (rattachement à une existante, ou création d'une nouvelle avec résolution de son quartier). Si aucun quartier ne peut être déterminé → `COORDINATES_OUT_OF_COVERAGE`.
2. Le quartier (et donc le préfixe de code) est celui de la localisation — jamais fourni par le client.
3. Vérifier la contrainte `@@unique([userId, localisationId])` : si l'habitant a déjà une adresse sur cette localisation → `409 ADDRESS_ALREADY_EXISTS_AT_LOCATION` avec le code existant.
4. Générer le code (préfixe = quartier de la localisation), créer l'`Address` (`lifecycle = ACTIVE`, `publishedRevisionId = null`) et sa révision n°1 (`EN_ATTENTE_VALIDATION`) dans la même transaction. Il n'y a pas d'état brouillon : une adresse incomplète n'est tout simplement pas soumise (validation des conditions minimales côté service).

> Les coordonnées d'une localisation sont **figées par le premier créateur**. Une adresse rattachée n'écrase jamais le GPS de la localisation ; son propre `gpsLat/gpsLng` fourni ne sert qu'au calcul de proximité, puis est ignoré (la navigation utilise le GPS de la localisation).

### Cycle de vie d'une localisation

- **Naissance** : à la première adresse rattachée.
- **Mort** : quand sa **dernière** adresse passe à `DESACTIVEE`, la localisation est **supprimée** physiquement. Vérification systématique après toute désactivation :

```typescript
async cleanupIfEmpty(localisationId: string): Promise<void> {
  const remaining = await this.prisma.address.count({
    where: { localisationId, lifecycle: { not: 'DESACTIVEE' } },
  });
  if (remaining === 0) {
    await this.prisma.localisation.delete({ where: { id: localisationId } });
  }
}
```

### Machine à états (deux axes : entité + contenu)

Le modèle sépare le cycle de vie de l'**entité adresse** (`Address.lifecycle`) de celui de chaque **version de contenu** (`AddressRevision.status`). La première publication comme les modifications passent par une révision — un seul mécanisme.

**Axe entité — `Address.lifecycle`**

| État | Visible public / API | Transition | Acteur |
|------|:---:|---|--------|
| `ACTIVE` | selon `publishedRevisionId` | → `DESACTIVEE` | Habitant / Mod / Admin |
| `DESACTIVEE` | ✗ (410) | terminal — code jamais réattribué | — |

Une adresse `ACTIVE` est consultable publiquement **si et seulement si** `publishedRevisionId IS NOT NULL` (une version a déjà été publiée). Une adresse active sans révision publiée (juste créée, première validation en attente) renvoie `404` (son existence n'est pas exposée).

**Axe contenu — `AddressRevision.status`**

| État | Rôle | Transition | Acteur |
|------|------|------------|--------|
| `EN_ATTENTE_VALIDATION` | Version soumise (création ou modification), en file de modération. | → `PUBLIEE` (validation) / → `REJETEE` (rejet + motif) / → `OBSOLETE` (caduque) | Mod / Admin (validation, rejet) ; système (obsolescence) |
| `PUBLIEE` | Version actuellement servie au public. Pointée par `Address.publishedRevisionId`. | remplacée par une nouvelle version publiée | — |
| `REJETEE` | Version refusée, motif + auteur obligatoires (CHECK). Le créateur peut soumettre une nouvelle version. | terminal | — |
| `OBSOLETE` | Version rendue caduque sans décision : compte supprimé ou adresse parente désactivée. Ni auteur ni motif. | terminal | — |

**Bascule du pointeur — règle centrale.** `Address.publishedRevisionId` ne change qu'à une **approbation** :

- Validation d'une révision → l'ancienne révision publiée (s'il y en a une) passe d'état `PUBLIEE` à archivée, la nouvelle devient `PUBLIEE`, et `publishedRevisionId` pointe sur elle. Atomique (transaction).
- **Rejet** d'une révision → `publishedRevisionId` ne bouge pas. La version en ligne reste exactement celle d'avant. La révision passe `REJETEE`, le créateur est notifié du motif.

> Conséquence : pendant la re-validation d'une modification, le public continue de voir l'ancienne version, sans interruption ni exposition de la version candidate. Le code de l'adresse ne change jamais.

**Première publication** : `POST /addresses` crée l'`Address` (`lifecycle = ACTIVE`, `publishedRevisionId = null`) **et** sa révision n°1 (`EN_ATTENTE_VALIDATION`) dans la même transaction. À la validation, le pointeur passe sur la révision n°1.

### Génération de code adresse

Format `[PRÉFIXE-QUARTIER]-[SÉQUENCE-4CAR]`. Séquence base 32, alphabet épuré `23456789ABCDEFGHJKMNPQRSTVWXYZ` (0, O, I, L exclus).

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

async generateUniqueCode(quartierPrefix: string): Promise<string> {
  let code: string, attempts = 0;
  do {
    if (attempts > 50) throw new Error('CODE_GENERATION_EXHAUSTED');
    code = `${quartierPrefix}-${this.generateSequence()}`;
    attempts++;
  } while (await this.prisma.address.findUnique({ where: { code } }));
  return code;
}
```

**Non-collision** : vérification d'unicité avant persistance. Pool de 32⁴ = 1 048 576 par quartier. **Permanence** : un code ne change jamais, même après modification ou désactivation, et n'est jamais réattribué.

### Assemblage du texte d'instructions

```typescript
buildAssembledText(steps: string[]): string {
  return steps.map(s => s.trim()).filter(Boolean).join('. ') + '.';
}
```

Recalculé automatiquement à chaque modification des `steps`. Jamais saisi directement.

### Calcul du score de fiabilité

Le score est la **moyenne simple des évaluations 5 étoiles** des habitants authentifiés. Les visites n'y entrent pas (elles alimentent l'ETA et les analytics). Calculé à la demande.

```typescript
async computeReliability(addressId: string): Promise<{ average: number | null; count: number }> {
  const ratings = await this.prisma.rating.findMany({ where: { addressId } });
  if (ratings.length === 0) return { average: null, count: 0 };
  const sum = ratings.reduce((acc, r) => acc + r.stars, 0);
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length }; // arrondi au dixième
}
```

**Niveaux d'exposition** (cahier v5, Besoin 8) :

| Destinataire | Ce qu'il reçoit |
|---|---|
| Visiteur (page publique) | Moyenne /5 (ex : « 3.7/5 ») + nombre d'évaluations. « Aucune évaluation » si `average === null`. |
| Développeur tiers (API `verify`) | `averageRating` (/5) + `ratingCount` |
| Administrateur (dashboard) | Moyenne + nombre + historique des signalements |

> L'historique des signalements n'est **jamais** exposé sur la page publique ni via l'API — uniquement au dashboard admin.

### Unicité et modification d'une évaluation

Contrainte `@@unique([userId, addressId])`. L'endpoint `rate` fait un **upsert** : une nouvelle note remplace la précédente. La moyenne est recalculée immédiatement. C'est le seul mécanisme — pas de hash anti-abus, l'authentification habitant suffit.

### Gestion des adresses désactivées

Désactivation (par le propriétaire, un Modérateur ou un Admin) : `lifecycle = DESACTIVEE`, `deactivatedAt = now()`, `deactivatedById` renseigné. Si une `AddressRevision` de cette adresse était `EN_ATTENTE_VALIDATION`, elle passe à `OBSOLETE` dans la même transaction (sortie de la file de modération — ni rejet ni motif). Puis `cleanupIfEmpty(localisationId)`. Le code n'est jamais réattribué.

- `GET /addresses/:code` (public) → 410 avec message générique sans exposer les données.
- Endpoints API (`/resolve`, `/verify`, `/eta`) → 410 avec corps structuré.

### Propriétaire inactif (aide à la décision modération)

Un signalement sur une adresse dont le propriétaire n'a pas eu de session depuis plus de **90 jours** (`lastSessionAt`) est présenté au Modérateur avec une présomption de validité. **Ce n'est pas un déclencheur automatique** : le Modérateur décide. `lastSessionAt` est mis à jour à chaque authentification réussie de l'habitant.

### Déclenchement des notifications push

`NotificationsService.notifyOwner(userId, payload)` appelé depuis les services, jamais depuis un controller. Best-effort (`Promise.allSettled`) : un échec push ne fait jamais échouer l'opération principale. Une souscription renvoyant 410 est supprimée automatiquement. **Chaque notification est aussi persistée** pour consultation depuis l'espace personnel.

Déclencheurs :

```typescript
// Validation
notifyOwner(address.userId, { message: `Votre adresse ${code} a été validée et est maintenant publique.`, url: `/dashboard/address/${code}` });
// Rejet
notifyOwner(address.userId, { message: `Votre adresse ${code} a été rejetée. Motif : ${reason}`, url: `/dashboard/address/${code}/edit` });
// Dégradation du score (moyenne < 2.5/5 après nouvelle évaluation)
notifyOwner(address.userId, { message: `Votre adresse ${code} a reçu des retours négatifs. Vérifiez que les informations sont à jour.`, url: `/dashboard/address/${code}/edit` });
// Désactivation par modération
notifyOwner(address.userId, { message: `Votre adresse ${code} a été désactivée par la modération. Motif : ${reason}`, url: `/dashboard` });
```

### Suppression de compte — anonymisation immédiate

**Pas de purge différée.** À la suppression (`DELETE /auth/account`), l'anonymisation est **immédiate** et le compte devient une **pierre tombale** : le `User` n'est jamais hard-deleted (sinon les évaluations/signalements/contributions perdraient leur intégrité référentielle), mais toutes ses données personnelles sont effacées sur-le-champ. Le `cuid` résiduel n'est pas une donnée personnelle. C'est plus protecteur qu'une purge à 30 jours (qui laisserait les données en clair pendant un mois) et conforme à la loi n°2017-20. Détail transactionnel : voir endpoint `DELETE /auth/account` (section 11) et la procédure `#E` de `constraints.sql`.

### Repères avoisinants à la création (Overpass)

À l'étape « instructions » de la création, le frontend demande des repères connus autour du GPS de l'habitant. Le backend expose ce service (ou le frontend interroge Overpass directement — décision d'implémentation laissée ouverte, mais l'encapsulation backend est préférable pour maîtriser le quota). Requête Overpass sur les POI proches (`amenity`, `shop`, etc.). Si aucun repère dans un rayon raisonnable → réponse vide, et le frontend bascule en rédaction libre. Ce cas est **normal** dans les quartiers peu cartographiés, pas une erreur.

---

## 13. Tests

Les tests sont **obligatoires**. Écrits avant ou avec le code. Un endpoint non testé n'est pas terminé.

### Tests unitaires

| Unité | Ce qui est testé |
|-------|-----------------|
| `generateUniqueCode` | Zéro collision sur 1 000 codes générés (mock Prisma) |
| `generateSequence` | Caractères exclus (0, O, I, L) jamais présents |
| `buildAssembledText` | Assemblage correct, gestion des espaces et steps vides |
| `distanceMeters` | Distance Haversine correcte sur points connus |
| `resolveOrCreate` | Rattachement si ≤ 15 m, création si > 15 m |
| Unicité création | Blocage de la 2ᵉ adresse du même habitant sur une localisation (409) |
| `computeReliability` | `null` si 0 évaluation ; moyenne arrondie au dixième sinon |
| `cleanupIfEmpty` | Localisation supprimée quand sa dernière adresse est désactivée, conservée sinon |
| Machine à états | Transitions valides acceptées, invalides rejetées |

### Tests d'intégration

Vraie base PostgreSQL de test isolée. `@nestjs/testing` + `supertest`.

| Endpoint | Cas nominal | Cas d'erreur |
|----------|-------------|--------------|
| `POST /auth/register` | JWT retourné, compte créé | OTP expiré/invalide → 401, email/mdp manquant → 400 |
| `POST /auth/login` | JWT (habitant via phone, mod/admin via email) | Identifiants faux → 401, compte désactivé → 403 |
| `POST /addresses` | Adresse créée, localisation rattachée, code généré | Hors périmètre → 400, 2ᵉ adresse même localisation → 409, sans JWT → 401 |
| `GET /addresses/:code` | Données si PUBLIEE | Non publiée/inexistante → 404, désactivée → 410 |
| `GET /addresses/:code/resolve` | Données | En attente → 404, désactivée → 410, clé révoquée → 401 |
| `GET /addresses/:code/verify` | Moyenne /5 | Clé invalide → 401 |
| `GET /map/addresses` | Domicile muet, autres en clair, non-découvrables exclues | — |
| `POST /addresses/:code/rate` | Upsert, moyenne recalculée | Note hors bornes → 400, suspendu → 403 |
| `POST /addresses/:code/contribution` | Contribution PENDING | Message vide → 400, adresse non publiée → 404 |
| `PATCH /moderation/revisions/:id/approve` | Révision PUBLIEE, pointeur basculé, notif | Sans rôle Mod/Admin → 403 |
| `PATCH /moderation/revisions/:id/reject` | Révision REJETEE, pointeur inchangé | Motif absent → 400, sans rôle → 403 |
| `GET /quartiers/:id/analytics` | Analytics | Quota insuffisant → 403 |
| `DELETE /auth/account` | Compte anonymisé, adresses désactivées, localisations vides supprimées | Téléphone non-correspondant → 400 |

### Smoke test de démo

```typescript
// scripts/smoke-test.ts — parcours complet avant chaque déploiement :
// 1. Request + Verify OTP → JWT habitant
// 2. Signature Cloudinary → valide
// 3. Create Address → code généré, EN_ATTENTE_VALIDATION
// 4. Login modérateur → JWT, approve révision n°1 → PUBLIEE + pointeur basculé
// 5. Resolve (clé API) → données complètes
// 6. Rate (JWT habitant) → moyenne recalculée
// 7. Visit start + confirm → recorded
// 8. Désactivation → 410 sur resolve, localisation nettoyée si vide
```

### Coverage cible

**≥ 70 % sur les services.** Controllers et guards : couverture minimale (intégration suffit). La qualité des assertions prime sur le pourcentage.

---

## 14. Les trois documentations vivantes

Maintenues **simultanément** à chaque endpoint/modification, sous `docs/`. Jamais en retard sur l'API réelle.

### 1. `docs/API_POSTMAN.md` — Documentation Postman
Tester manuellement chaque endpoint sans oubli. Requêtes exactes, réponses attendues, codes d'erreur, variables (`{{jwt}}`, `{{jwtMod}}`, `{{apiKey}}`).

### 2. `docs/API_CONTRACT.md` — Contrat de consommation frontend
Le document le plus important. Zéro terminologie NestJS/Prisma, zéro détail d'implémentation. URL de base, headers, shape exacte des requêtes/réponses, codes d'erreur machines, comportements spéciaux (404 vs 410, états d'adresse, matrice de visibilité carte). Mis à jour **avant** que le frontend branche un endpoint.

### 3. `docs/DEPLOYMENT.md` — Documentation de déploiement
Déployer/diagnostiquer depuis zéro en < 30 min. Variables d'env (sans valeurs) et leur source, étapes Render.com, migrations (`npx prisma migrate deploy`), seed quartiers (`npx ts-node scripts/seed-quartiers.ts`), config cron-job.org, checklist post-déploiement, rollback.

---

## 15. Déploiement

### Philosophie
**Déployer tôt, déployer souvent.** Un backend qui ne tourne qu'en local est un brouillon.

### Premier déploiement — déclencheur
Dès que ces conditions sont testées :
1. `request-otp` + `register` (inscription habitant) + `login` (connexion).
2. `POST /addresses` (création + rattachement localisation + code).
3. Login mod + `moderation/revisions/:id/approve` (publication de la révision n°1).
4. `GET /addresses/:code/resolve` (résolution complète d'une adresse publiée).

Ces quatre points constituent le minimum viable qui débloque le frontend sur son parcours critique (création → validation → consultation).

### Configuration Render.com
```
Build Command  : npm install && npx prisma generate && npx prisma migrate deploy && npm run build
Start Command  : node dist/main.js
Health Check   : GET /api/health → 200
```
`GET /api/health` → `{ "status": "ok", "timestamp": "..." }`. Utilisé par Render et cron-job.org.

### Déploiements suivants
Chaque jalon testé déclenche un déploiement. Pas de big bang. `main` toujours déployable.

---

## 16. Règles de travail

### Commits — Conventional Commits
```
feat(localisations): add radius-based attachment service
feat(addresses): creation with localisation + quartier attachment
test(addresses): block second address on same localisation (409)
feat(moderation): three-queue moderation endpoints
chore(prisma): add Localisation model, Address/AddressRevision split, AddressLifecycle enum
docs(api): update frontend contract with map/addresses endpoint
```
Un commit = une unité fonctionnelle testée. Chaque commit fusionné dans `main` (via `release/*` ou `hotfix/*`) est déployable.

### Ce qui ne passe pas en review
- Code sans test sur un endpoint critique.
- Endpoint dans le Swagger mais absent de `docs/API_CONTRACT.md`.
- Migration Prisma sans le code métier correspondant dans le même commit.
- `localisationId` accepté depuis le client à la création (faille du modèle — il doit être résolu côté serveur).
- Score de fiabilité incluant les visites (le score est la seule moyenne des évaluations).
- Contribution approuvée injectée dans les `steps` d'une adresse (le propriétaire seul modifie son contenu).
- `console.log` ou secrets en dur.

### Gestion des branches — Gitflow classique (obligatoire)
Un Gitflow rigoureux est en place sur toute la durée du projet et respecté sans exception. Tout merge passe par une PR ; aucun commit direct sur une branche protégée.
- `main` — production uniquement. Ne reçoit que des merges de `release/*` et `hotfix/*`. Render déploie depuis `main`. Chaque merge est taggé (`vX.Y.Z`).
- `develop` — branche d'intégration où atterrissent les fonctionnalités. Toujours verte (tests au vert).
- `feature/<nom>` — partent de `develop`, y sont fusionnées quand le jalon est complet et testé (ex. `feature/addresses-creation`).
- `release/<version>` — partent de `develop` pour stabiliser une version (tests finaux, synchro docs, bump de version), puis fusionnées dans `main` (taggée) **et** dans `develop`.
- `hotfix/<nom>` — partent de `main` pour un correctif de production, fusionnées dans `main` (taggée) **et** dans `develop`.

### No over-engineering
Avant un pattern complexe : **l'application en a-t-elle besoin maintenant, ou est-ce un besoin hypothétique ?** Si hypothétique, on ne l'implémente pas. Exception explicitement tolérée et documentée : le filtrage applicatif du rattachement par rayon (au lieu de PostGIS) est un choix prototype assumé, à remplacer par `ST_DWithin` en production.
