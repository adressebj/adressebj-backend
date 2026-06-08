# AdresseBJ — Cahier des Charges Technique · Backend

> **Destinataire** : Développeur backend (BADAROU Mouwafic)
> **Rôle** : Concevoir, implémenter, tester et déployer l'API REST d'AdresseBJ, ainsi que maintenir les trois documentations vivantes du projet.
> **Relation avec le frontend** : Le backend définit le contrat. Le frontend s'y adapte. Tout changement de contrat doit être répercuté immédiatement dans la documentation de consommation.
> **Version** : 2.0 — alignée sur CDC principal v4

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

AdresseBJ est une infrastructure d'adressage numérique. Le backend est le cœur du système : il génère les codes adresse, orchestre l'authentification, expose l'API REST consommée à la fois par le frontend et par les développeurs tiers, et maintient la fiabilité du référentiel.

Le backend ne gère pas le routage cartographique (délégué à OSRM public), ni le stockage des photos (délégué à Cloudinary). Il orchestre, il ne stocke pas ce qu'il n'a pas besoin de stocker.

**Quatre responsabilités spécifiques :**

- **Génération de codes uniques** sans collision, déterministes dans leur format, permanents dans le temps.
- **Gestion du cycle de vie des adresses** : machine à états, re-validation sur modification, modération à quatre files.
- **Contrôle d'accès à trois niveaux** : JWT avec rôles (HABITANT / MODERATOR / ADMIN) pour les comptes, clé API pour les intégrateurs tiers.
- **Maintien de trois documentations vivantes** à chaque nouvelle implémentation.

---

## 2. Stack technique

Toutes les versions sont vérifiées au **17 mai 2026**. Aucune ne doit être substituée sans justification explicite.

|
 Rôle 
|
 Technologie 
|
 Version cible 
|
|
------
|
-------------
|
---------------
|
|
 Framework 
|
 NestJS 
|
**
11.x
**
 (11.1.9+) 
|
|
 Langage 
|
 TypeScript 
|
 5.x 
|
|
 ORM 
|
 Prisma 
|
**
7.x
**
 (7.7+) 
|
|
 Base de données 
|
 PostgreSQL 
|
 16+ (Render.com) 
|
|
 Validation 
|
 class-validator + class-transformer 
|
 std NestJS 11 
|
|
 Authentification 
|
 @nestjs/jwt + @nestjs/passport + bcrypt 
|
 std NestJS 11 
|
|
 Tests 
|
 Jest (natif NestJS) 
|
 std NestJS 11 
|
|
 OTP SMS 
|
 Africa's Talking SDK 
|
 dernière stable 
|
|
 Upload photos 
|
 Cloudinary SDK (Node) 
|
 dernière stable 
|
|
 Documentation API 
|
 Swagger via @nestjs/swagger 
|
 std NestJS 11 
|
|
 Déploiement 
|
 Render.com (plan gratuit) 
|
 — 
|
|
 Réveil backend 
|
 cron-job.org (ping HTTP, 7h–23h) 
|
 — 
|

**Ce qu'on n'utilise pas et pourquoi :**

- Pas de Redis : aucun besoin de cache distribué ou de session à ce stade.
- Pas de CQRS, pas d'Event Sourcing : sur-ingénierie injustifiée pour ce périmètre.
- Pas de microservices : une application monolithique modulaire est exactement ce qu'il faut ici.
- Pas de TypeORM : Prisma 7 offre un meilleur DX, une type-safety native, des migrations propres.

---

## 3. Architecture applicative

### Principe général

L'architecture suit le pattern standard NestJS : **Controller → Service → Repository (Prisma)**. Chaque module encapsule sa propre responsabilité. Pas de fuite de logique entre couches.

```
src/
├── main.ts
├── app.module.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts      # /auth/* (register, login, verify-otp, forgot-password, etc.)
│   ├── auth.service.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   └── guards/
│       ├── jwt-auth.guard.ts
│       ├── roles.guard.ts      # vérifie le rôle dans le JWT payload
│       └── api-key.guard.ts
├── addresses/
│   ├── addresses.module.ts
│   ├── addresses.controller.ts
│   ├── addresses.service.ts
│   └── dto/
│       ├── create-address.dto.ts
│       ├── update-address.dto.ts
│       └── rate-address.dto.ts
├── rattachements/
│   ├── rattachements.module.ts
│   ├── rattachements.controller.ts
│   └── rattachements.service.ts
├── propositions/
│   ├── propositions.module.ts
│   ├── propositions.controller.ts  # /addresses/:code/propositions + /addresses/:code/propositions/:id/integrate|decline
│   └── propositions.service.ts
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
├── moderation/
│   ├── moderation.module.ts
│   └── moderation.controller.ts  # /moderation/* — MODERATOR + ADMIN
├── admin/
│   ├── admin.module.ts
│   └── admin.controller.ts       # /admin/* — ADMIN uniquement
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.controller.ts  # /notifications/* — lecture en app + push subscribe
│   └── notifications.service.ts     # stockage en base + envoi push (web-push)
├── upload/
│   ├── upload.module.ts
│   └── upload.service.ts
└── common/
    ├── filters/
    │   └── http-exception.filter.ts
    ├── interceptors/
    │   └── transform.interceptor.ts
    └── decorators/
        ├── current-user.decorator.ts
        └── roles.decorator.ts        # @Roles(Role.ADMIN, Role.MODERATOR)
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

### Variables d'environnement

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_EXPIRES_IN=7d

AT_USERNAME=...
AT_API_KEY=...
AT_SENDER_ID=AdresseBJ

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://adressebj.vercel.app

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

// ─── Utilisateurs ────────────────────────────────────────────────────────────

model User {
  id               String    @id @default(cuid())
  phone            String?   @unique       // Habitant uniquement
  email            String?   @unique       // Modérateur/Admin obligatoire ; Habitant optionnel
  firstName        String?
  lastName         String?
  passwordHash     String?                 // bcrypt — Habitant et Mod/Admin
  role             Role      @default(HABITANT)
  isPhoneVerified  Boolean   @default(false)
  suspendedAt      DateTime?
  suspensionReason String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  addresses         Address[]
  rattachements     Rattachement[]
  ratings           Rating[]
  reports           Report[]
  contributions     ContributionTerrain[]
  propositions      PropositionModification[] @relation("contributorPropositions")
  otpCodes          OtpCode[]
  pushSubscriptions PushSubscription[]
  notifications     Notification[]
}

enum Role {
  HABITANT
  MODERATOR
  ADMIN
}

model OtpCode {
  id        String   @id @default(cuid())
  phone     String
  code      String
  purpose   OtpPurpose @default(REGISTRATION)
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  user   User?   @relation(fields: [userId], references: [id])
  userId String?

  @@index([phone])
}

enum OtpPurpose {
  REGISTRATION     // vérification numéro à l'inscription
  PHONE_CHANGE     // re-vérification lors du changement de numéro
}

// ─── Zones ───────────────────────────────────────────────────────────────────

model Zone {
  id        String   @id @default(cuid())
  name      String
  prefix    String   @unique   // "AKP", "CAD", "FID"...
  polygon   Json?              // GeoJSON polygon OSM
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  addresses Address[]
}

// ─── Adresses ────────────────────────────────────────────────────────────────

model Address {
  id              String        @id @default(cuid())
  code            String        @unique  // "AKP-7X3K"
  zoneId          String
  userId          String
  status          AddressStatus @default(DRAFT)
  rejectionReason String?

  // Version publiée courante (ou dernière version avant re-validation)
  steps           Json          // string[]
  assembledText   String
  gpsLat          Float
  gpsLng          Float
  photoUrl        String

  // Version en attente lors d'une re-validation (null si aucune en cours)
  // Champ JSON : { steps?, assembledText?, gpsLat?, gpsLng?, photoUrl? }
  pendingUpdate   Json?

  deactivatedAt   DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  zone          Zone                    @relation(fields: [zoneId], references: [id])
  user          User                    @relation(fields: [userId], references: [id])
  visits        Visit[]
  ratings       Rating[]
  reports       Report[]
  contributions ContributionTerrain[]
  rattachements Rattachement[]
  propositions  PropositionModification[]

  @@index([code])
  @@index([zoneId])
  @@index([status])
}

enum AddressStatus {
  DRAFT               // brouillon — invisible publiquement
  PENDING_VALIDATION  // en attente — invisible publiquement
  PUBLISHED           // publiée — accessible publiquement
  REJECTED            // rejetée — invisible publiquement, le créateur peut corriger
  DEACTIVATED         // désactivée — code non réattribuable, page informative
}

// ─── Rattachements ───────────────────────────────────────────────────────────

model Rattachement {
  id        String   @id @default(cuid())
  userId    String
  addressId String
  createdAt DateTime @default(now())

  user         User                    @relation(fields: [userId], references: [id])
  address      Address                 @relation(fields: [addressId], references: [id])
  propositions PropositionModification[]

  @@unique([userId, addressId])
  @@index([userId])
  @@index([addressId])
}

// ─── Propositions de modification (contributeurs rattachés) ──────────────────

model PropositionModification {
  id              String            @id @default(cuid())
  rattachementId  String
  contributorId   String
  addressId       String
  type            PropositionType
  // { photoUrl? } | { steps?, assembledText? } | { gpsLat?, gpsLng? }
  proposedData    Json
  status          PropositionStatus @default(PENDING)
  moderatorId     String?
  rejectionReason String?           // renseigné si MODERATOR_REJECTED
  reviewedAt      DateTime?
  ownerDecidedAt  DateTime?
  createdAt       DateTime          @default(now())

  rattachement Rattachement @relation(fields: [rattachementId], references: [id])
  contributor  User         @relation("contributorPropositions", fields: [contributorId], references: [id])
  address      Address      @relation(fields: [addressId], references: [id])

  @@index([addressId])
  @@index([status])
}

enum PropositionType {
  PHOTO
  INSTRUCTIONS
  GPS
}

enum PropositionStatus {
  PENDING              // en attente du modérateur
  MODERATOR_APPROVED   // approuvée par modérateur, en attente de décision du propriétaire
  MODERATOR_REJECTED   // rejetée par modérateur (raison transmise au contributeur)
  OWNER_INTEGRATED     // intégrée par le propriétaire
  OWNER_DECLINED       // ignorée par le propriétaire
}

// ─── Visites ─────────────────────────────────────────────────────────────────

model Visit {
  id         String      @id @default(cuid())
  addressId  String
  departAt   DateTime
  arrivedAt  DateTime?
  source     VisitSource @default(WEB)
  apiKeyId   String?
  finalPrice Float?      // remonté par intégrateur (FCFA)
  createdAt  DateTime    @default(now())

  address Address  @relation(fields: [addressId], references: [id])
  apiKey  ApiKey?  @relation(fields: [apiKeyId], references: [id])

  @@index([addressId])
}

enum VisitSource {
  WEB
  API
}

// ─── Évaluations (notation 5 étoiles) ────────────────────────────────────────

model Rating {
  id        String   @id @default(cuid())
  addressId String
  userId    String                   // JWT requis — évaluation authentifiée
  stars     Int                      // 1 à 5
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  address Address @relation(fields: [addressId], references: [id])
  user    User    @relation(fields: [userId], references: [id])

  @@unique([userId, addressId])      // une seule évaluation par habitant par adresse
  @@index([addressId])
}

// ─── Signalements ────────────────────────────────────────────────────────────

model Report {
  id         String       @id @default(cuid())
  addressId  String
  userId     String                   // JWT requis — signalement authentifié
  message    String?
  status     ReportStatus @default(PENDING)
  resolvedAt DateTime?
  createdAt  DateTime     @default(now())

  address Address @relation(fields: [addressId], references: [id])
  user    User    @relation(fields: [userId], references: [id])

  @@index([addressId])
  @@index([status])
}

enum ReportStatus {
  PENDING
  RESOLVED
  IGNORED
}

// ─── Contributions terrain ────────────────────────────────────────────────────

model ContributionTerrain {
  id              String             @id @default(cuid())
  addressId       String
  userId          String             // JWT requis — contribution authentifiée
  content         String             // texte libre (ex: "sens unique nord-sud, portail côté gauche")
  status          ContributionStatus @default(PENDING)
  rejectionReason String?
  reviewedAt      DateTime?
  createdAt       DateTime           @default(now())

  address Address @relation(fields: [addressId], references: [id])
  user    User    @relation(fields: [userId], references: [id])

  @@index([addressId])
  @@index([status])
}

enum ContributionStatus {
  PENDING
  APPROVED
  REJECTED
}

// ─── Notifications en application ────────────────────────────────────────────

model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  message   String
  data      Json?            // { addressCode?, reason?, propositionId? }
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([readAt])
}

enum NotificationType {
  ADDRESS_VALIDATED
  ADDRESS_REJECTED
  ADDRESS_DEACTIVATED_BY_MODERATOR
  SCORE_DEGRADED
  PROPOSITION_MODERATOR_APPROVED    // notifié au propriétaire pour décision
  PROPOSITION_MODERATOR_REJECTED    // notifié au contributeur
  PROPOSITION_OWNER_INTEGRATED      // notifié au contributeur
  PROPOSITION_OWNER_DECLINED        // notifié au contributeur
  RATTACHMENT_ADDRESS_DEACTIVATED   // notifié aux contributeurs rattachés
  ACCOUNT_SUSPENDED
}

// ─── Clés API ─────────────────────────────────────────────────────────────────

model ApiKey {
  id        String       @id @default(cuid())
  key       String       @unique  // "bj_live_[16car]"
  label     String
  status    ApiKeyStatus @default(ACTIVE)
  expiresAt DateTime?
  createdAt DateTime     @default(now())
  revokedAt DateTime?

  visits Visit[]

  @@index([key])
}

enum ApiKeyStatus {
  ACTIVE
  REVOKED
}

// ─── Souscriptions push ───────────────────────────────────────────────────────

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
- Jamais de `prisma db push` en production : uniquement `prisma migrate deploy`.

---

## 5. Modules NestJS

### AuthModule

Responsabilités : inscription et connexion par rôle, vérification OTP (inscription + changement de numéro), émission de JWT.

**Endpoints :**

|
 Route 
|
 Usage 
|
|
-------
|
-------
|
|
`POST /auth/register`
|
 Inscription Habitant : phone + password + name optionnel → envoi OTP 
|
|
`POST /auth/verify-otp`
|
 Vérifie OTP inscription ou changement de numéro → active le compte ou met à jour le numéro 
|
|
`POST /auth/login`
|
 Connexion Habitant : phone + password → JWT 
|
|
`POST /auth/admin/login`
|
 Connexion Modérateur/Admin : email + password → JWT 
|
|
`POST /auth/request-otp`
|
 Demande OTP pour changement de numéro (JWT requis) 
|
|
`POST /auth/forgot-password`
|
 Demande reset mdp Modérateur/Admin (email → lien reset) 
|
|
`POST /auth/reset-password`
|
 Nouveau mdp avec token de reset 
|
|
`DELETE /auth/account`
|
 Suppression de compte Habitant 
|

**Durée de vie OTP** : 5 minutes. Un seul OTP actif par numéro/purpose à la fois.

**Passwords** : hashés avec bcrypt (cost factor 12). Jamais stockés en clair.

**JWT payload** : `{ sub: userId, role, iat, exp }`.

**Suspension** : `JwtAuthGuard` ou `RolesGuard` vérifie `user.suspendedAt`. Si suspendu, retourne `403 USER_SUSPENDED` sur toute route qui modifie des données. La lecture publique n'est pas affectée.

### AddressesModule

Responsabilités : machine à états (DRAFT → PENDING_VALIDATION → PUBLISHED / REJECTED / DEACTIVATED), génération de code, calcul de score, gestion des rattachements.

**Points critiques :**

- Toute soumission passe à `PENDING_VALIDATION`. Le modérateur valide ou rejette.
- Toute modification d'une adresse PUBLISHED soumet `pendingUpdate` et repasse à `PENDING_VALIDATION`. Les champs principaux (version publiée) restent inchangés jusqu'à validation.
- Sur approbation d'une modification : les champs de `pendingUpdate` sont appliqués aux champs principaux et `pendingUpdate` est remis à `null`.
- Sur rejet d'une modification : `pendingUpdate` est effacé, statut revient à `PUBLISHED`, version précédente reste active.

### RattementsModule

Responsabilités : création et suppression de rattachements. Vérification préalable : l'adresse doit être PUBLISHED.

Un Habitant suspendu ne peut pas créer de nouveau rattachement.

### PropositionsModule

Responsabilités : soumission de propositions de modification par les contributeurs rattachés, décision du propriétaire (intégrer ou décliner).

Vérification préalable à toute soumission : un `Rattachement` actif doit exister pour le couple `(userId, addressId)`.

**Flow de validation en deux temps :**

1. Modérateur approuve → statut `MODERATOR_APPROVED` → notification au propriétaire.
2. Propriétaire intègre (`OWNER_INTEGRATED`) : les données proposées sont appliquées à l'adresse. Propriétaire décline (`OWNER_DECLINED`) : aucune modification.

Dans les deux cas, le contributeur est notifié.

### ModerationModule

Route prefix : `/moderation`. Accessible à `Role.MODERATOR` et `Role.ADMIN`.

Quatre files indépendantes :

|
 File 
|
 Route 
|
 Description 
|
|
------
|
-------
|
-------------
|
|
 Adresses en attente 
|
`GET /moderation/addresses?status=PENDING_VALIDATION`
|
 Adresses soumises par des Habitants 
|
|
 Signalements en attente 
|
`GET /moderation/reports?status=PENDING`
|
 Signalements sur adresses publiées 
|
|
 Contributions terrain en attente 
|
`GET /moderation/contributions?status=PENDING`
|
 Contributions soumises après navigation 
|
|
 Propositions en attente 
|
`GET /moderation/propositions?status=PENDING`
|
 Modifications proposées par des contributeurs rattachés 
|

Le Modérateur agit sur le contenu, jamais sur la visibilité finale d'une adresse — sauf désactivation sur signalement, qui lui est accordée.

### AdminModule

Route prefix : `/admin`. Accessible à `Role.ADMIN` uniquement.

Fonctionnalités au-delà de la modération :

- Gestion des zones géographiques (création, édition, activation/désactivation).
- Gestion des comptes Modérateurs (création, désactivation, réactivation, reset mdp).
- Suspension et levée de suspension des comptes Habitants.
- Gestion des clés API (création, révocation).
- Supervision du référentiel (recherche par code, zone, téléphone habitant).

### ZonesModule

Responsabilités : liste des zones actives, analytics par zone.

Le script `scripts/seed-zones.ts` importe les quartiers depuis l'API Overpass une seule fois.

### VisitsModule

Responsabilités : enregistrement des départs de navigation, confirmation d'arrivée, remontée de données intégrateurs.

### NotificationsModule

Responsabilités : stockage en base des notifications (historique consultable dans l'app), envoi push via `web-push`.

`NotificationsService` expose `notify(userId, type, message, data?)` qui :

1. Crée un enregistrement `Notification` en base.
2. Tente l'envoi push sur toutes les `PushSubscription` de l'utilisateur (best-effort, `Promise.allSettled`).
3. Purge automatiquement les souscriptions expirées (erreur 410 de l'endpoint push).

Ce service est appelé depuis `AddressesService`, `ModerationService`, `PropositionsService` et `AdminService`. Jamais directement depuis un controller.

### UploadModule

Responsabilités : génération de signature Cloudinary côté serveur. Aucune manipulation de données binaires.

---

## 6. Authentification

### Flux inscription Habitant

```
Frontend                              Backend                        Africa's Talking
   |                                     |                                |
   |-- POST /auth/register ------------->|                                |
   |   { phone, password, firstName? }   |                                |
   |                                     |-- hash password (bcrypt)       |
   |                                     |-- crée User (isPhoneVerified=false)
   |                                     |-- génère OTP 6 chiffres        |
   |                                     |-- SMS API ---------------------->
   |<-- 200 { message: "OTP envoyé" } ---|                                |
   |                                     |                                |
   |-- POST /auth/verify-otp ----------->|                                |
   |   { phone, code }                   |                                |
   |                                     |-- vérifie OtpCode              |
   |                                     |-- isPhoneVerified = true       |
   |<-- 200 { accessToken } -------------|                                |
```

### Flux connexion Habitant

```
POST /auth/login
Body: { phone, password }

→ vérifie phone en base
→ compare password avec passwordHash (bcrypt.compare)
→ vérifie isPhoneVerified = true
→ retourne JWT { sub, role }
```

### Flux connexion Modérateur / Admin

```
POST /auth/admin/login
Body: { email, password }

→ vérifie email en base, rôle MODERATOR ou ADMIN
→ compare password avec passwordHash
→ retourne JWT { sub, role }
```

### Flux changement de numéro Habitant

```
POST /auth/request-otp (JWT requis)
→ OTP envoyé au nouveau numéro (fourni dans le body)

POST /auth/verify-otp
Body: { phone: newPhone, code, purpose: "PHONE_CHANGE" }
→ met à jour User.phone
→ invalide toutes les sessions actives (JWT précédents expireront naturellement)
```

### JWT

- Payload : `{ sub: userId, role, iat, exp }`.
- Expiration : 7 jours. Pas de refresh token pour le prototype.
- `JwtAuthGuard` : valide la signature et l'expiration.
- `RolesGuard` : vérifie `user.role` via le décorateur `@Roles(Role.MODERATOR, Role.ADMIN)`. Vérifie également `user.suspendedAt` pour les mutations.

### Garde API Key

Les endpoints tiers (`/resolve`, `/verify`, `/eta`, `POST /visits/confirm`, `GET /zones/:id/analytics`) requièrent le header `Authorization: Bearer bj_live_[16car]`. `ApiKeyGuard` valide la clé en base, vérifie `ACTIVE` et expiration.

**Clé révoquée** : HTTP 401 `{ "code": "API_KEY_REVOKED" }`.

---

## 7. Gestion des clés API

Format : `bj_live_` + 16 caractères alphanumériques base62. Stockée en clair (pas une donnée sensible équivalente à un mot de passe).

**Quota analytique** : `GET /zones/:id/analytics` conditionné à un ratio `visits/confirm` ≥ 80 % sur 30 jours glissants par clé. Calculé à la demande : `confirmedVisits / totalVisits` sur `Visit` WHERE `createdAt >= NOW() - INTERVAL '30 days' AND apiKeyId = $1`.

---

## 8. Upload photos — Cloudinary

### Flux : upload direct depuis le frontend (signature backend)

Le backend génère une signature sécurisée. Le frontend uploade directement vers Cloudinary. Le backend ne manipule jamais de données binaires.

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

La transformation `q_auto,f_auto` réduit le poids moyen de ~500 Ko à ~80–120 Ko.

---

## 9. Endpoints API

Tous les endpoints sont préfixés `/api/v1/`. Le Swagger est disponible sur `/api/docs`.

### Vue d'ensemble

|
 Méthode 
|
 Route 
|
 Auth 
|
 Description 
|
|
---------
|
-------
|
------
|
-------------
|
|
 POST 
|
`/auth/register`
|
 Public 
|
 Inscription Habitant 
|
|
 POST 
|
`/auth/verify-otp`
|
 Public 
|
 Vérification OTP inscription ou changement de numéro 
|
|
 POST 
|
`/auth/login`
|
 Public 
|
 Connexion Habitant (phone + password) 
|
|
 POST 
|
`/auth/admin/login`
|
 Public 
|
 Connexion Modérateur/Admin (email + password) 
|
|
 POST 
|
`/auth/request-otp`
|
 JWT 
|
 Demande OTP pour changement de numéro 
|
|
 POST 
|
`/auth/forgot-password`
|
 Public 
|
 Reset mdp Modérateur/Admin 
|
|
 POST 
|
`/auth/reset-password`
|
 Public 
|
 Confirm reset mdp 
|
|
 DELETE 
|
`/auth/account`
|
 JWT 
|
 Suppression compte Habitant 
|
|
 POST 
|
`/upload/signature`
|
 JWT 
|
 Signature Cloudinary 
|
|
 POST 
|
`/addresses`
|
 JWT 
|
 Création d'adresse (DRAFT ou soumission directe) 
|
|
 POST 
|
`/addresses/:code/submit`
|
 JWT (propriétaire) 
|
 Soumettre brouillon en PENDING_VALIDATION 
|
|
 PATCH 
|
`/addresses/:code`
|
 JWT (propriétaire) 
|
 Modification → re-validation 
|
|
 DELETE 
|
`/addresses/:code`
|
 JWT (propriétaire) 
|
 Désactivation par le propriétaire 
|
|
 GET 
|
`/addresses/:code`
|
 Public 
|
 Consultation publique (version publiée) 
|
|
 GET 
|
`/addresses/mine`
|
 JWT 
|
 Liste des adresses du propriétaire 
|
|
 GET 
|
`/addresses/:code/resolve`
|
 API Key 
|
 Résolution complète 
|
|
 GET 
|
`/addresses/:code/verify`
|
 API Key 
|
 Score de fiabilité (moyenne/5 + comptage) 
|
|
 GET 
|
`/addresses/:code/eta`
|
 API Key 
|
 Estimation ETA 
|
|
 POST 
|
`/addresses/:code/ratings`
|
 JWT 
|
 Évaluer une adresse (1–5 étoiles) 
|
|
 PATCH 
|
`/addresses/:code/ratings`
|
 JWT 
|
 Modifier son évaluation 
|
|
 DELETE 
|
`/addresses/:code/ratings`
|
 JWT 
|
 Supprimer son évaluation 
|
|
 POST 
|
`/addresses/:code/reports`
|
 JWT 
|
 Signaler un problème 
|
|
 POST 
|
`/addresses/:code/contributions`
|
 JWT 
|
 Contribuer terrain (texte libre) 
|
|
 POST 
|
`/addresses/:code/rattachements`
|
 JWT 
|
 Se rattacher à une adresse 
|
|
 DELETE 
|
`/addresses/:code/rattachements`
|
 JWT 
|
 Se détacher 
|
|
 POST 
|
`/addresses/:code/propositions`
|
 JWT (rattaché) 
|
 Proposer une modification 
|
|
 PATCH 
|
`/addresses/:code/propositions/:id/integrate`
|
 JWT (propriétaire) 
|
 Intégrer une proposition 
|
|
 PATCH 
|
`/addresses/:code/propositions/:id/decline`
|
 JWT (propriétaire) 
|
 Décliner une proposition 
|
|
 POST 
|
`/visits/confirm`
|
 API Key 
|
 Remontée données intégrateur 
|
|
 GET 
|
`/zones`
|
 Public 
|
 Liste des zones actives 
|
|
 GET 
|
`/zones/:id/analytics`
|
 API Key + quota 
|
 Analytics de zone 
|
|
 GET 
|
`/notifications`
|
 JWT 
|
 Historique des notifications 
|
|
 PATCH 
|
`/notifications/:id/read`
|
 JWT 
|
 Marquer notification comme lue 
|
|
 PATCH 
|
`/notifications/read-all`
|
 JWT 
|
 Tout marquer comme lu 
|
|
 POST 
|
`/notifications/subscribe`
|
 JWT 
|
 Enregistrer endpoint push 
|
|
 DELETE 
|
`/notifications/unsubscribe`
|
 JWT 
|
 Se désinscrire des notifications push 
|
|
 GET 
|
`/moderation/addresses`
|
 JWT MODERATOR\|ADMIN 
|
 Adresses en attente de validation 
|
|
 PATCH 
|
`/moderation/addresses/:code/approve`
|
 JWT MODERATOR\|ADMIN 
|
 Valider adresse 
|
|
 PATCH 
|
`/moderation/addresses/:code/reject`
|
 JWT MODERATOR\|ADMIN 
|
 Rejeter adresse (motif obligatoire) 
|
|
 GET 
|
`/moderation/reports`
|
 JWT MODERATOR\|ADMIN 
|
 Signalements en attente 
|
|
 PATCH 
|
`/moderation/reports/:id/resolve`
|
 JWT MODERATOR\|ADMIN 
|
 Marquer signalement résolu 
|
|
 PATCH 
|
`/moderation/reports/:id/deactivate`
|
 JWT MODERATOR\|ADMIN 
|
 Désactiver adresse signalée 
|
|
 PATCH 
|
`/moderation/reports/:id/ignore`
|
 JWT MODERATOR\|ADMIN 
|
 Ignorer signalement 
|
|
 GET 
|
`/moderation/contributions`
|
 JWT MODERATOR\|ADMIN 
|
 Contributions terrain en attente 
|
|
 PATCH 
|
`/moderation/contributions/:id/approve`
|
 JWT MODERATOR\|ADMIN 
|
 Publier contribution 
|
|
 PATCH 
|
`/moderation/contributions/:id/reject`
|
 JWT MODERATOR\|ADMIN 
|
 Rejeter contribution 
|
|
 GET 
|
`/moderation/propositions`
|
 JWT MODERATOR\|ADMIN 
|
 Propositions contributeurs en attente 
|
|
 PATCH 
|
`/moderation/propositions/:id/approve`
|
 JWT MODERATOR\|ADMIN 
|
 Approuver proposition (→ notif owner) 
|
|
 PATCH 
|
`/moderation/propositions/:id/reject`
|
 JWT MODERATOR\|ADMIN 
|
 Rejeter proposition 
|
|
 GET 
|
`/admin/zones`
|
 JWT ADMIN 
|
 Liste zones (admin) 
|
|
 POST 
|
`/admin/zones`
|
 JWT ADMIN 
|
 Création zone manuelle 
|
|
 PATCH 
|
`/admin/zones/:id`
|
 JWT ADMIN 
|
 Modification zone 
|
|
 GET 
|
`/admin/addresses`
|
 JWT ADMIN 
|
 Supervision référentiel 
|
|
 PATCH 
|
`/admin/addresses/:code/deactivate`
|
 JWT ADMIN 
|
 Désactivation admin 
|
|
 GET 
|
`/admin/api-keys`
|
 JWT ADMIN 
|
 Liste clés API 
|
|
 POST 
|
`/admin/api-keys`
|
 JWT ADMIN 
|
 Création clé API 
|
|
 DELETE 
|
`/admin/api-keys/:id`
|
 JWT ADMIN 
|
 Révocation clé API 
|
|
 POST 
|
`/admin/moderators`
|
 JWT ADMIN 
|
 Créer compte Modérateur 
|
|
 GET 
|
`/admin/moderators`
|
 JWT ADMIN 
|
 Liste des Modérateurs 
|
|
 PATCH 
|
`/admin/moderators/:id/deactivate`
|
 JWT ADMIN 
|
 Désactiver Modérateur 
|
|
 PATCH 
|
`/admin/moderators/:id/reactivate`
|
 JWT ADMIN 
|
 Réactiver Modérateur 
|
|
 PATCH 
|
`/admin/moderators/:id/reset-password`
|
 JWT ADMIN 
|
 Reset mdp Modérateur 
|
|
 PATCH 
|
`/admin/habitants/:id/suspend`
|
 JWT ADMIN 
|
 Suspendre un Habitant 
|
|
 PATCH 
|
`/admin/habitants/:id/unsuspend`
|
 JWT ADMIN 
|
 Lever une suspension 
|

---

### Détail des endpoints critiques

#### `POST /api/v1/auth/register`

```typescript
// Body
{ "phone": "+22960000000", "password": "monMotDePasse123", "firstName": "Mouwafic" }

// Réponse 200
{ "data": { "message": "OTP envoyé", "expiresIn": 300 } }

// Erreur 409 — numéro déjà utilisé
{ "statusCode": 409, "code": "PHONE_ALREADY_REGISTERED" }

// Erreur 400 — format téléphone invalide
{ "statusCode": 400, "code": "INVALID_PHONE_FORMAT" }
```

#### `POST /api/v1/auth/verify-otp`

```typescript
// Body
{ "phone": "+22960000000", "code": "847291", "purpose": "REGISTRATION" | "PHONE_CHANGE" }

// Réponse 200 — inscription
{ "data": { "accessToken": "eyJ..." } }

// Réponse 200 — changement de numéro
{ "data": { "message": "Numéro mis à jour" } }

// Erreur 401
{ "statusCode": 401, "code": "INVALID_OR_EXPIRED_OTP" }
```

#### `POST /api/v1/auth/login`

```typescript
// Body
{ "phone": "+22960000000", "password": "monMotDePasse123" }

// Réponse 200
{ "data": { "accessToken": "eyJ..." } }

// Erreur 401
{ "statusCode": 401, "code": "INVALID_CREDENTIALS" }

// Erreur 403 — numéro non vérifié (OTP non confirmé)
{ "statusCode": 403, "code": "PHONE_NOT_VERIFIED" }
```

#### `POST /api/v1/addresses`

```typescript
// Header: Authorization: Bearer 
// Body
{
  "zoneId": "zone_cuid",
  "steps": ["Partir du marché Dantokpa", "2ème rue à droite", "Portail bleu"],
  "gpsLat": 6.3676,
  "gpsLng": 2.4252,
  "photoUrl": "https://res.cloudinary.com/...",
  "submitNow": true   // false → DRAFT, true → PENDING_VALIDATION
}

// Réponse 201
{
  "data": {
    "code": "AKP-7X3K",
    "status": "PENDING_VALIDATION",
    "assembledText": "Partir du marché Dantokpa. 2ème rue à droite. Portail bleu.",
    "shareUrl": "https://adressebj.vercel.app/a/AKP-7X3K"
  }
}

// Erreur 400 — coordonnées hors périmètre
{ "statusCode": 400, "code": "COORDINATES_OUT_OF_COVERAGE" }

// Erreur 403 — compte suspendu
{ "statusCode": 403, "code": "USER_SUSPENDED" }
```

#### `POST /api/v1/addresses/:code/ratings`

```typescript
// Header: Authorization: Bearer 
// Body
{ "stars": 4 }  // 1 à 5

// Réponse 201 — première évaluation
{ "data": { "recorded": true, "stars": 4 } }

// Réponse 200 — évaluation mise à jour (PATCH /addresses/:code/ratings)
{ "data": { "updated": true, "stars": 4 } }

// Erreur 400 — stars hors plage
{ "statusCode": 400, "code": "INVALID_STARS_VALUE", "message": "stars must be between 1 and 5" }

// Erreur 401 — non authentifié
{ "statusCode": 401, "code": "UNAUTHORIZED" }
```

#### `POST /api/v1/addresses/:code/reports`

```typescript
// Header: Authorization: Bearer 
// Body
{ "message": "Le portail n'existe plus à cet endroit." }  // optionnel

// Réponse 201
{ "data": { "reportId": "report_cuid", "status": "PENDING" } }

// Erreur 401 — non authentifié
{ "statusCode": 401, "code": "UNAUTHORIZED" }
```

#### `POST /api/v1/addresses/:code/rattachements`

```typescript
// Header: Authorization: Bearer 
// Pas de body

// Réponse 201
{ "data": { "rattachementId": "ratt_cuid" } }

// Erreur 409 — déjà rattaché
{ "statusCode": 409, "code": "ALREADY_RATTACHED" }

// Erreur 400 — impossible de se rattacher à sa propre adresse
{ "statusCode": 400, "code": "CANNOT_ATTACH_OWN_ADDRESS" }

// Erreur 400 — adresse non publiée
{ "statusCode": 400, "code": "ADDRESS_NOT_PUBLISHED" }
```

#### `POST /api/v1/addresses/:code/propositions`

```typescript
// Header: Authorization: Bearer  — doit être un contributeur rattaché
// Body
{
  "type": "PHOTO",        // "PHOTO" | "INSTRUCTIONS" | "GPS"
  "proposedData": {
    "photoUrl": "https://res.cloudinary.com/..."    // pour PHOTO
    // ou "steps": ["étape 1", "étape 2"]           // pour INSTRUCTIONS
    // ou { "gpsLat": 6.37, "gpsLng": 2.43 }        // pour GPS
  }
}

// Réponse 201
{ "data": { "propositionId": "prop_cuid", "status": "PENDING" } }

// Erreur 403 — n'est pas contributeur rattaché
{ "statusCode": 403, "code": "NOT_RATTACHED" }
```

#### `PATCH /api/v1/addresses/:code/propositions/:id/integrate`

```typescript
// Header: Authorization: Bearer  — doit être le propriétaire de l'adresse
// Pas de body

// Effet : applique proposedData aux champs de l'adresse (selon type)
//         status = OWNER_INTEGRATED, ownerDecidedAt = now()
//         notification push + in-app au contributeur

// Réponse 200
{ "data": { "integrated": true } }

// Erreur 403 — n'est pas le propriétaire
{ "statusCode": 403, "code": "NOT_ADDRESS_OWNER" }

// Erreur 400 — proposition non dans l'état MODERATOR_APPROVED
{ "statusCode": 400, "code": "PROPOSITION_NOT_READY_FOR_OWNER" }
```

#### `PATCH /api/v1/moderation/addresses/:code/approve`

```typescript
// Header: Authorization: Bearer 
// Pas de body

// Effet :
//   - Si status = PENDING_VALIDATION (création initiale) : status = PUBLISHED
//   - Si status = PENDING_VALIDATION (re-validation) : applique pendingUpdate → champs principaux, pendingUpdate = null, status = PUBLISHED
// Notification au propriétaire (ADDRESS_VALIDATED)

// Réponse 200
{ "data": { "code": "AKP-7X3K", "status": "PUBLISHED" } }
```

#### `PATCH /api/v1/moderation/addresses/:code/reject`

```typescript
// Header: Authorization: Bearer 
// Body — motif obligatoire
{ "reason": "Photo non conforme : image floue, portail non visible." }

// Effet :
//   - status = REJECTED (création initiale)
//   - ou status = PUBLISHED + pendingUpdate = null (re-validation rejetée : version précédente reste active)
// Notification au propriétaire (ADDRESS_REJECTED, data.reason)
// rejectionReason stocké sur l'adresse

// Réponse 200
{ "data": { "code": "AKP-7X3K", "status": "REJECTED" } }

// Erreur 400 — motif manquant
{ "statusCode": 400, "code": "REJECTION_REASON_REQUIRED" }
```

#### `PATCH /api/v1/moderation/propositions/:id/approve`

```typescript
// Header: Authorization: Bearer 
// Pas de body

// Effet : status = MODERATOR_APPROVED
//         Notification au propriétaire (PROPOSITION_MODERATOR_APPROVED)
//         Le propriétaire peut maintenant intégrer ou décliner

// Réponse 200
{ "data": { "propositionId": "...", "status": "MODERATOR_APPROVED" } }
```

#### `GET /api/v1/addresses/:code/verify`

```typescript
// Header: Authorization: Bearer bj_live_...

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "averageRating": 3.7,    // sur 5, arrondi au dixième — null si aucune évaluation
    "ratingCount": 14,
    "isActive": true
  }
}
```

#### `GET /api/v1/addresses/:code`

```typescript
// Public

// Réponse 200
{
  "data": {
    "code": "AKP-7X3K",
    "zone": { "name": "Akpakpa", "prefix": "AKP" },
    "gps": { "lat": 6.3676, "lng": 2.4252 },
    "photoUrl": "https://res.cloudinary.com/...",
    "steps": ["..."],
    "assembledText": "...",
    "averageRating": 3.7,   // null si aucune évaluation (affichage "Aucune évaluation" côté frontend)
    "ratingCount": 14,
    "isActive": true,
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

#### `GET /api/v1/notifications`

```typescript
// Header: Authorization: Bearer 

// Réponse 200
{
  "data": [
    {
      "id": "notif_cuid",
      "type": "ADDRESS_VALIDATED",
      "message": "Votre adresse AKP-7X3K a été validée et publiée.",
      "data": { "addressCode": "AKP-7X3K" },
      "readAt": null,
      "createdAt": "2026-05-17T10:00:00Z"
    }
  ]
}
```

#### `PATCH /api/v1/admin/habitants/:id/suspend`

```typescript
// Header: Authorization: Bearer 
// Body
{ "reason": "Spam d'adresses fictives — 15 adresses en 24h." }

// Effet : User.suspendedAt = now(), User.suspensionReason = reason
//         Notification in-app + push (ACCOUNT_SUSPENDED)
//         Les adresses restent publiquement accessibles
//         Les rattachements et contributions futurs sont gelés

// Réponse 200
{ "data": { "userId": "...", "suspendedAt": "2026-05-17T..." } }
```

---

## 10. Logique métier critique

### Génération de code adresse

Le code suit le format `[PRÉFIXE-ZONE]-[SÉQUENCE-4CAR]`. Alphabet base32 épuré : `23456789ABCDEFGHJKMNPQRSTVWXYZ` (O, 0, I, L exclus).

```typescript
private readonly ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

private generateSequence(): string {
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += this.ALPHABET[Math.floor(Math.random() * this.ALPHABET.length)];
  }
  return result;
}

async generateUniqueCode(zonePrefix: string): Promise {
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

**Permanence** : un code ne change jamais, même si l'adresse est modifiée, désactivée ou si des zones sont restructurées.

### Assemblage du texte d'instructions

```typescript
buildAssembledText(steps: string[]): string {
  return steps.map(s => s.trim()).join('. ') + '.';
}
```

L'`assembledText` est recalculé automatiquement à chaque modification des `steps`. Il n'est jamais saisi directement.

### Calcul du score de fiabilité

Le score est la moyenne des étoiles attribuées par les Habitants authentifiés, arrondie au dixième.

```typescript
async computeAverageRating(addressId: string): Promise {
  const ratings = await this.prisma.rating.findMany({
    where: { addressId },
    select: { stars: true },
  });

  if (ratings.length === 0) {
    return { averageRating: null, ratingCount: 0 };
  }

  const sum = ratings.reduce((acc, r) => acc + r.stars, 0);
  const avg = Math.round((sum / ratings.length) * 10) / 10;
  return { averageRating: avg, ratingCount: ratings.length };
}
```

**`null` signifie "aucune évaluation"** — différent d'un score de 0 qui serait un score légitimement mauvais.

**Seuil de notification** : si `averageRating < 3.0` après une nouvelle évaluation ou modification, et que la valeur précédente était ≥ 3.0, déclencher `SCORE_DEGRADED`.

**Niveaux d'exposition** :

|
 Destinataire 
|
 Ce qu'il reçoit 
|
|
---
|
---
|
|
 Visiteur (page publique) 
|
`averageRating: N.N \| null`
 + 
`ratingCount`
|
|
 Développeur tiers (API 
`/verify`
) 
|
`averageRating: N.N \| null`
 + 
`ratingCount`
|
|
 Administrateur (dashboard) 
|
 Idem + historique des signalements 
|

### Machine à états des adresses

```
DRAFT ──────────────────────────────> PENDING_VALIDATION
                  (submit)                    │
                                    ┌─────────┴─────────┐
                                    │                   │
                                  approve             reject
                                    │                   │
                                    ▼                   ▼
                                PUBLISHED           REJECTED ──> (corrige) ──> PENDING_VALIDATION
                                    │
                          ┌─────────┼──────────────────┐
                          │         │                  │
                        modify   deactivate       (signalement)
                          │         │                  │
                          ▼         ▼                  ▼
                   PENDING_VALIDATION  DEACTIVATED   DEACTIVATED
                 (pendingUpdate défini ;
                 version publiée reste active)
```

**Cas re-validation rejetée** : `status` retourne à `PUBLISHED`, `pendingUpdate` est effacé. La version précédente reste active.

### Gestion de la suspension Habitant

Un Habitant suspendu peut :
- Consulter les adresses publiques (accès lecture inchangé).

Un Habitant suspendu ne peut pas :
- Créer, modifier ou désactiver une adresse.
- Créer un rattachement.
- Soumettre une contribution, un signalement, une évaluation.
- Soumettre une proposition de modification.

Implémentation : le `JwtAuthGuard` injecte le `User` complet. `RolesGuard` (ou un guard dédié `SuspensionGuard`) vérifie `user.suspendedAt` sur les routes de mutation.

### Notifications push

```typescript
async notify(userId: string, type: NotificationType, message: string, data?: object): Promise {
  // 1. Stocker en base (historique consultable)
  await this.prisma.notification.create({
    data: { userId, type, message, data },
  });

  // 2. Envoi push best-effort
  const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
  const payload = JSON.stringify({ title: 'AdresseBJ', body: message, data });

  await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ).catch(async (err) => {
        if (err.statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      })
    )
  );
}
```

**Déclencheurs** :

|
 Événement 
|
 Destinataire 
|
 Type 
|
|
-----------
|
-------------
|
------
|
|
 Adresse validée 
|
 Propriétaire 
|
`ADDRESS_VALIDATED`
|
|
 Adresse rejetée 
|
 Propriétaire 
|
`ADDRESS_REJECTED`
|
|
 Score < 3.0 (quand il était ≥ 3.0) 
|
 Propriétaire 
|
`SCORE_DEGRADED`
|
|
 Adresse désactivée par Mod/Admin 
|
 Propriétaire 
|
`ADDRESS_DEACTIVATED_BY_MODERATOR`
|
|
 Adresse désactivée 
|
 Contributeurs rattachés 
|
`RATTACHMENT_ADDRESS_DEACTIVATED`
|
|
 Proposition approuvée par Modérateur 
|
 Propriétaire 
|
`PROPOSITION_MODERATOR_APPROVED`
|
|
 Proposition rejetée par Modérateur 
|
 Contributeur 
|
`PROPOSITION_MODERATOR_REJECTED`
|
|
 Propriétaire intègre 
|
 Contributeur 
|
`PROPOSITION_OWNER_INTEGRATED`
|
|
 Propriétaire décline 
|
 Contributeur 
|
`PROPOSITION_OWNER_DECLINED`
|
|
 Compte suspendu 
|
 Habitant concerné 
|
`ACCOUNT_SUSPENDED`
|

### Suppression de compte — logique de purge

```typescript
async deleteAccount(userId: string): Promise {
  await this.prisma.$transaction([
    // Désactiver toutes les adresses → notifier les contributeurs rattachés
    this.prisma.address.updateMany({
      where: { userId },
      data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
    }),
    // Anonymiser immédiatement
    this.prisma.user.update({
      where: { id: userId },
      data: { phone: `[supprimé-${userId}]`, email: null, passwordHash: null, firstName: null, lastName: null },
    }),
    // Invalider tous les OTP
    this.prisma.otpCode.updateMany({ where: { userId }, data: { used: true } }),
    // Supprimer souscriptions push
    this.prisma.pushSubscription.deleteMany({ where: { userId } }),
  ]);
  // Les visites, ratings, reports, contributions sont conservés anonymisés
  // Les notifications de l'utilisateur peuvent être supprimées immédiatement
  await this.prisma.notification.deleteMany({ where: { userId } });
}
```

La notification des contributeurs rattachés (adresses désactivées suite à la suppression) est envoyée avant le début de la transaction.

---

## 11. Tests

Les tests sont **obligatoires**. Endpoint non testé = endpoint non terminé.

### Tests unitaires

|
 Unité 
|
 Ce qui est testé 
|
|
-------
|
--------------------
|
|
`generateUniqueCode`
|
 Zéro collision sur 1 000 codes en parallèle (mock Prisma) 
|
|
`buildAssembledText`
|
 Assemblage correct, espaces, steps vides 
|
|
`computeAverageRating`
|
 null si 0 ratings ; arrondi correct ; calcul correct 3 ratings 
|
|
`generateSequence`
|
 O, 0, I, L jamais présents dans la sortie 
|
|
`buildAssembledText`
 après 
`pendingUpdate`
|
 L'assembled text de la version publiée reste inchangé jusqu'à approbation 
|

### Tests d'intégration

|
 Endpoint 
|
 Cas nominal 
|
 Cas d'erreur 
|
|
----------
|
-------------
|
--------------
|
|
`POST /auth/register`
|
 Compte créé + OTP envoyé (mock AT) 
|
 Téléphone dupliqué → 409 
|
|
`POST /auth/verify-otp`
|
 JWT retourné 
|
 OTP expiré → 401 
|
|
`POST /auth/login`
|
 JWT retourné 
|
 Mauvais mdp → 401, non vérifié → 403 
|
|
`POST /auth/admin/login`
|
 JWT retourné avec rôle MODERATOR/ADMIN 
|
 Rôle HABITANT → 403 
|
|
`DELETE /auth/account`
|
 Compte anonymisé, adresses désactivées 
|
 Phone mismatch → 400 
|
|
`POST /addresses`
|
 Adresse créée, code généré 
|
 Hors périmètre → 400, suspendu → 403 
|
|
`PATCH /addresses/:code`
|
 pendingUpdate défini, status PENDING_VALIDATION 
|
 Pas propriétaire → 403 
|
|
`GET /addresses/:code`
|
 Données publiées retournées 
|
 404, 410 
|
|
`POST /addresses/:code/ratings`
|
 Rating créé 
|
 Stars invalides → 400, non auth → 401 
|
|
`PATCH /addresses/:code/ratings`
|
 Rating mis à jour 
|
 Rating inexistant → 404 
|
|
`POST /addresses/:code/reports`
|
 Report créé 
|
 Non auth → 401 
|
|
`POST /addresses/:code/rattachements`
|
 Rattachement créé 
|
 Déjà rattaché → 409, adresse non publiée → 400 
|
|
`POST /addresses/:code/propositions`
|
 Proposition PENDING 
|
 Non rattaché → 403 
|
|
`PATCH /addresses/:code/propositions/:id/integrate`
|
 Champs appliqués 
|
 Non propriétaire → 403, mauvais état → 400 
|
|
`GET /addresses/:code/resolve`
|
 Données complètes 
|
 404, 410, clé révoquée → 401 
|
|
`GET /addresses/:code/verify`
|
 averageRating + ratingCount 
|
 Clé invalide → 401 
|
|
`PATCH /moderation/addresses/:code/approve`
|
 status PUBLISHED, notif propriétaire 
|
 Pas Modérateur → 403 
|
|
`PATCH /moderation/addresses/:code/reject`
|
 status REJECTED, raison stockée 
|
 Raison absente → 400 
|
|
`PATCH /moderation/propositions/:id/approve`
|
 MODERATOR_APPROVED, notif propriétaire 
|
 Pas Modérateur → 403 
|
|
`PATCH /admin/habitants/:id/suspend`
|
 suspendedAt défini, notif Habitant 
|
 Pas Admin → 403 
|
|
`POST /admin/moderators`
|
 Compte Modérateur créé 
|
 Pas Admin → 403 
|
|
`GET /zones/:id/analytics`
|
 Analytics retournées 
|
 Quota insuffisant → 403 
|

### Smoke test de démo

```typescript
// scripts/smoke-test.ts — parcours complet
// 1. Inscription Habitant → OTP → JWT
// 2. Signature Cloudinary → signature valide
// 3. Création adresse → code généré
// 4. Approbation modération (mock ou compte Mod de test)
// 5. Resolve via API Key → données complètes
// 6. Rating adresse (JWT) → recorded
// 7. Confirm Visit → visitId retourné
// 8. Rattachement → rattachementId
// 9. Proposition → propositionId PENDING
```

### Coverage cible

≥ 70 % de couverture sur les services. La qualité des assertions prime sur le chiffre.

---

## 12. Les trois documentations vivantes

Ces trois documents vivent dans `docs/`. Mis à jour **simultanément** à chaque nouvel endpoint ou modification.

### `docs/API_POSTMAN.md`

Documentation Postman exhaustive : requêtes exactes, réponses attendues, cas d'erreur, variables d'environnement (`{{jwt}}`, `{{api_key}}`, `{{moderator_jwt}}`).

### `docs/API_CONTRACT.md`

Contrat de consommation frontend. Zéro terminologie NestJS/Prisma. URL de base, headers requis, shapes des requêtes et réponses, codes d'erreur machines, comportements spéciaux (410 vs 404, `averageRating: null` vs score 0). Mis à jour **avant** que le frontend commence à brancher un endpoint.

### `docs/DEPLOYMENT.md`

Déploiement depuis zéro en moins de 30 minutes : variables d'environnement, étapes Render.com, commandes migration, seed zones OSM, cron-job.org, checklist post-déploiement, procédure de rollback.

---

## 13. Déploiement

### Philosophie

**Déployer tôt, déployer souvent.** Un backend qui tourne uniquement en local n'est pas un backend.

### Premier déploiement — déclencheur

Dès que ces trois conditions sont remplies :

1. `POST /auth/register`, `POST /auth/verify-otp`, `POST /auth/login` fonctionnels.
2. `POST /addresses` fonctionnel (création avec code généré).
3. `GET /addresses/:code/resolve` fonctionnel.

### Configuration Render.com

```
Build Command : npm install && npx prisma generate && npx prisma migrate deploy && npm run build
Start Command : node dist/main.js
Health Check  : GET /api/health → 200
```

L'endpoint `GET /api/health` retourne `{ "status": "ok", "timestamp": "..." }`.

---

## 14. Règles de travail

### Commits

Format Conventional Commits :

```
feat(auth): implement phone+password login for Habitants
feat(addresses): add PENDING_VALIDATION state with pendingUpdate
feat(rattachements): create rattachement model and endpoints
feat(propositions): two-step moderation flow for contributor modifications
feat(ratings): 5-star authenticated rating replacing binary vote
test(auth): login flow with bcrypt password validation
fix(moderation): return 400 when rejection reason is missing
docs(api): update contract with new rating and report endpoints
chore(prisma): add Rattachement, PropositionModification, Notification models
```

Un commit = une unité fonctionnelle testée. Chaque commit sur `main` est déployable.

### Ce qui ne passe pas

- Endpoint critique sans test.
- Endpoint dans Swagger absent de `docs/API_CONTRACT.md`.
- Migration Prisma sans le code métier correspondant.
- `console.log` laissé en production.
- Secret ou clé en dur dans le code.
- Route Modérateur/Admin sans guard de rôle.

### No over-engineering

Avant d'introduire un pattern complexe, la question : **est-ce que l'application en a besoin maintenant ?** Si la réponse est hypothétique, on ne l'implémente pas.
