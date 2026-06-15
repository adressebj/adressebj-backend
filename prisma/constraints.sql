-- AdresseBJ — Contraintes hors-DSL Prisma (PostgreSQL)
-- ------------------------------------------------------------------------------
-- Prisma ne sait pas exprimer ces deux contraintes dans le schema.prisma.
-- Intégration : `npx prisma migrate dev --create-only --name manual_constraints`,
-- puis coller ces instructions dans le fichier migration.sql généré, et appliquer.
-- ==============================================================================


-- ── [versioning] Au plus UNE révision en attente par adresse ───────────────────
-- Garantie logique assurée par le service (upsert findFirst). Ceci est le filet
-- anti-race au niveau base : deux soumissions concurrentes ne peuvent pas créer
-- deux révisions EN_ATTENTE_VALIDATION sur la même adresse.
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_revision_per_address
  ON "AddressRevision" ("addressId")
  WHERE status = 'EN_ATTENTE_VALIDATION';


-- ── [#2] Une adresse non désactivée DOIT avoir une localisation ────────────────
-- localisationId est nullable pour absorber le onDelete:SetNull (suppression d'une
-- localisation devenue vide). Le null ne doit JAMAIS concerner une adresse vivante :
-- il est structurellement réservé aux adresses DESACTIVEE.
ALTER TABLE "Address"
  ADD CONSTRAINT localisation_required_unless_deactivated
  CHECK (lifecycle = 'DESACTIVEE' OR "localisationId" IS NOT NULL);


-- ── [C] Un habitant VIVANT doit avoir un email ─────────────────────────────────
-- email/phone/password sont nullables UNIQUEMENT à cause de la pierre tombale
-- d'anonymisation (#E met tout à null à la suppression de compte). Pour un habitant
-- vivant (deletedAt IS NULL), email + phone + password sont obligatoires. La
-- multiplicité conceptuelle [1] diverge donc de la nullabilité physique, pour une
-- raison valable (cycle de vie d'anonymisation), pas par négligence.
ALTER TABLE "User"
  ADD CONSTRAINT habitant_alive_requires_credentials
  CHECK (
    "deletedAt" IS NOT NULL
    OR role <> 'HABITANT'
    OR ("email" IS NOT NULL AND "phone" IS NOT NULL AND "password" IS NOT NULL)
  );

-- ── [B] Un modérateur/admin VIVANT doit avoir email + password ─────────────────
ALTER TABLE "User"
  ADD CONSTRAINT staff_alive_requires_credentials
  CHECK (
    "deletedAt" IS NOT NULL
    OR role = 'HABITANT'
    OR ("email" IS NOT NULL AND "password" IS NOT NULL)
  );


-- ── [révision] Cohérence du statut REJETEE ─────────────────────────────────────
-- Un rejet est une décision de modération : il EXIGE un auteur et un motif.
-- OBSOLETE (auteur disparu / adresse désactivée) n'a ni l'un ni l'autre — d'où la
-- distinction de statut. Ce CHECK empêche un faux rejet sans traçabilité.
ALTER TABLE "AddressRevision"
  ADD CONSTRAINT rejected_revision_requires_audit
  CHECK (status <> 'REJETEE' OR ("reviewedById" IS NOT NULL AND "rejectionReason" IS NOT NULL));


-- ── [#5] Note d'évaluation bornée 1..5 ─────────────────────────────────────────
ALTER TABLE "Rating"
  ADD CONSTRAINT rating_stars_range
  CHECK (stars BETWEEN 1 AND 5);


-- ── [#5] Cohérence temporelle d'une visite ─────────────────────────────────────
ALTER TABLE "Visit"
  ADD CONSTRAINT visit_arrival_after_departure
  CHECK ("arrivedAt" IS NULL OR "arrivedAt" >= "departAt");


-- ==============================================================================
-- RAPPELS NON-DDL (logique service / cron — pas du schéma, consignés ici)
-- ==============================================================================
--
-- [#F] Élagage du journal d'appels API : supprimer les lignes ApiRequestLog
--      de plus de ~35 jours (fenêtre glissante 30j + marge). Cron @nestjs/schedule
--      ou job Render.com. Le ratio de remontée se recalcule à la volée à chaque
--      appel de zones/analytics (gate stateless, auto-réparant) :
--          ratio = count(CONFIRM) / count(RESOLVE) sur 30 jours glissants, par clé.
--          denominateur = 0  ⇒  accès AUTORISÉ (aucun trajet pris ⇒ aucune obligation).
--          ratio < 0.80      ⇒  403 ANALYTICS_QUOTA_INSUFFICIENT.
--
-- [#E] Suppression de compte habitant (DELETE /auth/account) — UNE transaction :
--        1. vérifier que phone correspond au JWT
--        2. désactiver toutes ses adresses (lifecycle=DESACTIVEE, deactivatedAt=now,
--           deactivatedById=userId)
--        3. passer ses AddressRevision encore EN_ATTENTE_VALIDATION à OBSOLETE
--           (sortie de la file de modération — pas un rejet : ni auteur ni motif)
--        4. cleanupIfEmpty sur chaque localisation devenue vide (SetNull s'occupe du reste)
--        5. SCRUB User : phone=null, email=null, password=null, firstName=null,
--           lastName=null, deletedAt=now
--           (PAS de hard-delete : la ligne devient une pierre tombale anonymisée ;
--            le cuid n'est pas une donnée personnelle ⇒ conforme loi n°2017-20)
--        6. purger PushSubscription, OtpCode actifs, ET Notification (donnée perso)
--        7. Rating / Report / Contribution CONSERVÉS (userId préservé vers la tombstone ;
--           texte libre des Report/Contribution conservé — décision assumée, couverte
--           par la politique de confidentialité)
--      Réponse : { deleted: true, anonymizedAt: <now> }  (pas de purgeScheduledAt).
--
-- [désactivation d'adresse avec révision en attente] Lorsqu'une adresse est désactivée
--      (par le propriétaire ou par la modération) alors qu'une AddressRevision est
--      EN_ATTENTE_VALIDATION, cette révision passe à OBSOLETE dans la même transaction.
--      Pas de notification séparée : la notif de désactivation d'adresse couvre le cas.
--
-- [D] Rattachement d'une localisation à un quartier (à la CRÉATION de la localisation) :
--        - si le quartier candidat possède un polygone → test point-dans-polygone
--          (le GPS de la 1re adresse tombe-t-il dans un quartier actif ?) ;
--        - si AUCUN quartier-polygone ne contient le point (cas fréquent : OSM ne
--          fournit qu'un point central, polygon = null) → repli « quartier le plus
--          proche » par distance Haversine au (centerLat, centerLng) du quartier.
--      Le quartier est porté par la LOCALISATION (pas par l'adresse) : toutes les
--      adresses d'un même point physique héritent du même quartier — donc du même
--      préfixe de code. Déterminé une seule fois, à la création de la localisation.
