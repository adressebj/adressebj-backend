import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AddressCategory,
  ApiEndpoint,
  NotificationType,
  RevisionStatus,
} from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { LocalisationsService } from '../localisations/localisations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EtaSource,
  GeoPoint,
  RoutingService,
} from '../common/routing/routing.service';
import { buildAssembledText, generateSequence } from './address-code';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

const MAX_CODE_ATTEMPTS = 50;

/** Seuil de moyenne sous lequel le propriétaire est alerté d'une dégradation de fiabilité. */
const RELIABILITY_WARNING_THRESHOLD = 2.5;
/** Nombre minimal d'évaluations avant qu'une moyenne basse soit jugée significative. */
const RELIABILITY_WARNING_MIN_RATINGS = 3;

export interface CreatedAddress {
  code: string;
  lifecycle: string;
  revisionStatus: RevisionStatus;
}

export interface MyAddress {
  code: string;
  lifecycle: string;
  mapDiscoverable: boolean;
  published: boolean;
  category: string | null;
  currentRevisionStatus: RevisionStatus | null;
  createdAt: Date;
}

export interface QuartierRef {
  name: string;
  prefix: string;
}

export interface ResolvedAddress {
  code: string;
  category: string;
  quartier: QuartierRef & { id: string };
  gps: { lat: number; lng: number };
  photoUrl: string;
  steps: unknown;
  assembledText: string;
  createdAt: Date;
}

export interface RatingSummary {
  averageRating: number | null;
  ratingCount: number;
}

export interface RateResult extends RatingSummary {
  recorded: true;
}

export interface VerifyResult extends RatingSummary {
  code: string;
  published: true;
}

export interface EtaResponse {
  code: string;
  origin: GeoPoint;
  destination: GeoPoint;
  etaMinutes: number;
  distanceMeters: number;
  source: EtaSource;
}

export interface PublicAddress {
  code: string;
  category: string;
  quartier: QuartierRef;
  gps: { lat: number; lng: number };
  photoUrl: string;
  steps: unknown;
  assembledText: string;
  averageRating: number | null;
  ratingCount: number;
  fieldNotes: { message: string; createdAt: Date }[];
  createdAt: Date;
}

export interface ReportResult {
  reportId: string;
  status: 'PENDING';
}

export interface UpdatedAddress {
  code: string;
  revisionStatus: RevisionStatus;
  published: boolean;
}

export interface DiscoverableResult {
  code: string;
  mapDiscoverable: boolean;
}

export interface DeactivatedAddress {
  code: string;
  lifecycle: 'DESACTIVEE';
}

/** Une version de contenu d'une adresse, exposée au propriétaire (historique). */
export interface RevisionView {
  id: string;
  status: RevisionStatus;
  category: string;
  steps: unknown;
  assembledText: string;
  photoUrl: string;
  rejectionReason: string | null;
  isPublished: boolean;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface MapMarker {
  code: string;
  category: string;
  gps: { lat: number; lng: number };
  muted: boolean;
  preview: { photoUrl: string; code: string } | null;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  category?: string;
}

/** Identité minimale d'une adresse publiée, pour les modules tiers (contributions). */
export interface PublishedAddressRef {
  id: string;
  code: string;
  ownerId: string;
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localisations: LocalisationsService,
    private readonly apiKeys: ApiKeysService,
    private readonly routing: RoutingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Génère un code unique pour un préfixe de quartier (vérif d'unicité avant persistance). */
  async generateUniqueCode(quartierPrefix: string): Promise<string> {
    for (let attempts = 0; attempts < MAX_CODE_ATTEMPTS; attempts++) {
      const code = `${quartierPrefix}-${generateSequence()}`;
      const existing = await this.prisma.address.findUnique({
        where: { code },
      });
      if (!existing) return code;
    }
    throw new InternalServerErrorException({
      code: 'CODE_GENERATION_EXHAUSTED',
      message: 'Impossible de générer un code unique, réessayez.',
    });
  }

  /**
   * Création d'adresse : rattachement localisation (serveur), code, et révision n°1
   * EN_ATTENTE_VALIDATION — le tout dans une transaction. Pas d'état brouillon.
   */
  async create(userId: string, dto: CreateAddressDto): Promise<CreatedAddress> {
    const localisation = await this.localisations.resolveOrCreate(
      dto.gpsLat,
      dto.gpsLng,
    );

    // Une seule adresse vivante par habitant et par localisation.
    const existing = await this.prisma.address.findFirst({
      where: {
        userId,
        localisationId: localisation.id,
        lifecycle: 'ACTIVE',
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_EXISTS_AT_LOCATION',
        message: `Vous avez déjà une adresse à cet emplacement (${existing.code}).`,
        existingCode: existing.code,
      });
    }

    const quartier = await this.prisma.quartier.findUniqueOrThrow({
      where: { id: localisation.quartierId },
    });
    const code = await this.generateUniqueCode(quartier.prefix);
    const assembledText = buildAssembledText(dto.steps);

    await this.prisma.$transaction(async (tx) => {
      const address = await tx.address.create({
        data: {
          code,
          localisationId: localisation.id,
          userId,
          lifecycle: 'ACTIVE',
        },
      });
      await tx.addressRevision.create({
        data: {
          addressId: address.id,
          category: dto.category,
          steps: dto.steps,
          assembledText,
          photoUrl: dto.photoUrl,
          gpsLat: dto.gpsLat,
          gpsLng: dto.gpsLng,
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        },
      });
    });

    return {
      code,
      lifecycle: 'ACTIVE',
      revisionStatus: RevisionStatus.EN_ATTENTE_VALIDATION,
    };
  }

  /** Mes adresses + leur état (habitant). */
  async listMine(userId: string): Promise<MyAddress[]> {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        publishedRevision: { select: { category: true } },
        revisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { category: true, status: true },
        },
      },
    });

    return addresses.map((a) => {
      const latest = a.revisions[0] ?? null;
      return {
        code: a.code,
        lifecycle: a.lifecycle,
        mapDiscoverable: a.mapDiscoverable,
        published: a.publishedRevisionId != null,
        category: a.publishedRevision?.category ?? latest?.category ?? null,
        currentRevisionStatus: latest?.status ?? null,
        createdAt: a.createdAt,
      };
    });
  }

  /**
   * Surcouche carte : adresses publiées + découvrables dans une bounding box.
   * La matrice de visibilité (domicile muet / autres en clair) est appliquée
   * ICI, côté serveur — jamais déléguée au client.
   */
  async mapAddresses(bounds: MapBounds): Promise<MapMarker[]> {
    if (bounds.north < bounds.south || bounds.east < bounds.west) {
      throw new BadRequestException({
        code: 'INVALID_BOUNDING_BOX',
        message: 'La bounding box est invalide (north<south ou east<west).',
      });
    }

    const addresses = await this.prisma.address.findMany({
      where: {
        lifecycle: 'ACTIVE',
        mapDiscoverable: true,
        publishedRevisionId: { not: null },
        localisation: {
          gpsLat: { gte: bounds.south, lte: bounds.north },
          gpsLng: { gte: bounds.west, lte: bounds.east },
        },
        ...(bounds.category
          ? {
              publishedRevision: {
                category: bounds.category as AddressCategory,
              },
            }
          : {}),
      },
      select: {
        code: true,
        localisation: { select: { gpsLat: true, gpsLng: true } },
        publishedRevision: { select: { category: true, photoUrl: true } },
      },
    });

    return addresses.map((a) => {
      const rev = a.publishedRevision!;
      const muted = rev.category === AddressCategory.DOMICILE;
      return {
        code: a.code,
        category: rev.category,
        gps: { lat: a.localisation!.gpsLat, lng: a.localisation!.gpsLng },
        muted,
        preview: muted ? null : { photoUrl: rev.photoUrl, code: a.code },
      };
    });
  }

  /**
   * Résolution complète d'une adresse publiée (intégrateurs, clé API).
   * Chaque appel est météré (ApiRequestLog RESOLVE). La NAV utilise le GPS de
   * la Localisation, jamais celui de la révision.
   */
  async resolve(code: string, apiKeyId: string): Promise<ResolvedAddress> {
    const address = await this.loadResolvable(code);
    await this.apiKeys.logRequest(apiKeyId, ApiEndpoint.RESOLVE);

    const rev = address.publishedRevision!;
    const quartier = address.localisation!.quartier;
    return {
      code: address.code,
      category: rev.category,
      quartier: {
        id: quartier.id,
        name: quartier.name,
        prefix: quartier.prefix,
      },
      gps: {
        lat: address.localisation!.gpsLat,
        lng: address.localisation!.gpsLng,
      },
      photoUrl: rev.photoUrl,
      steps: rev.steps,
      assembledText: rev.assembledText,
      createdAt: address.createdAt,
    };
  }

  /** Page publique visiteur (sans auth) : contenu publié + évaluations + notes terrain. */
  async getPublicPage(code: string): Promise<PublicAddress> {
    const address = await this.loadResolvable(code);
    const { averageRating, ratingCount } = await this.aggregateRatings(
      address.id,
    );
    const fieldNotes = await this.prisma.contribution.findMany({
      where: { addressId: address.id, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: { message: true, createdAt: true },
    });

    const rev = address.publishedRevision!;
    const quartier = address.localisation!.quartier;
    return {
      code: address.code,
      category: rev.category,
      quartier: { name: quartier.name, prefix: quartier.prefix },
      gps: {
        lat: address.localisation!.gpsLat,
        lng: address.localisation!.gpsLng,
      },
      photoUrl: rev.photoUrl,
      steps: rev.steps,
      assembledText: rev.assembledText,
      averageRating,
      ratingCount,
      fieldNotes,
      createdAt: address.createdAt,
    };
  }

  /**
   * Évaluation 1–5 par un habitant (upsert sur (userId, addressId)).
   * La moyenne est recalculée immédiatement. Borne hors 1–5 → INVALID_RATING.
   */
  async rate(userId: string, code: string, stars: number): Promise<RateResult> {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new BadRequestException({
        code: 'INVALID_RATING',
        message: 'La note doit être un entier entre 1 et 5.',
      });
    }
    const address = await this.loadResolvable(code);
    const before = await this.aggregateRatings(address.id);
    await this.prisma.rating.upsert({
      where: { userId_addressId: { userId, addressId: address.id } },
      create: { userId, addressId: address.id, stars },
      update: { stars },
    });
    const summary = await this.aggregateRatings(address.id);

    await this.maybeWarnReliability(
      address.userId,
      address.id,
      code,
      before,
      summary,
    );
    return { recorded: true, ...summary };
  }

  /**
   * Alerte le propriétaire **uniquement au franchissement** du seuil de fiabilité
   * (moyenne précédente saine → moyenne désormais sous le seuil), au-delà d'un
   * minimum d'évaluations. Best-effort : ne fait jamais échouer la notation.
   */
  private async maybeWarnReliability(
    ownerId: string,
    addressId: string,
    code: string,
    before: RatingSummary,
    after: RatingSummary,
  ): Promise<void> {
    const wasHealthy =
      before.averageRating == null ||
      before.averageRating >= RELIABILITY_WARNING_THRESHOLD;
    const nowDegraded =
      after.averageRating != null &&
      after.ratingCount >= RELIABILITY_WARNING_MIN_RATINGS &&
      after.averageRating < RELIABILITY_WARNING_THRESHOLD;

    if (wasHealthy && nowDegraded) {
      await this.notifications.notifyOwner(ownerId, {
        type: NotificationType.RELIABILITY_WARNING,
        message: `La fiabilité de votre adresse ${code} a baissé (note moyenne ${after.averageRating}/5).`,
        addressId,
        url: `/dashboard/address/${code}`,
      });
    }
  }

  /**
   * Vérification (intégrateurs KYC, clé API) : moyenne et nombre d'évaluations.
   * Chaque appel est météré (ApiRequestLog VERIFY). Mêmes règles 404/410.
   */
  async verify(code: string, apiKeyId: string): Promise<VerifyResult> {
    const address = await this.loadResolvable(code);
    await this.apiKeys.logRequest(apiKeyId, ApiEndpoint.VERIFY);
    const summary = await this.aggregateRatings(address.id);
    return { code: address.code, published: true, ...summary };
  }

  /**
   * Estimation ETA (intégrateurs, clé API) depuis une origine GPS vers l'adresse publiée.
   * La destination est le GPS **figé de la Localisation** (jamais celui de la révision).
   * Délègue au RoutingService (OSRM, repli local gracieux). Chaque appel est météré (ETA).
   * Mêmes règles 404/410 que resolve/verify.
   */
  async eta(
    code: string,
    origin: GeoPoint,
    apiKeyId: string,
  ): Promise<EtaResponse> {
    const address = await this.loadResolvable(code);
    await this.apiKeys.logRequest(apiKeyId, ApiEndpoint.ETA);

    const destination: GeoPoint = {
      lat: address.localisation!.gpsLat,
      lng: address.localisation!.gpsLng,
    };
    const result = await this.routing.getEta(origin, destination);
    return {
      code: address.code,
      origin,
      destination,
      etaMinutes: result.etaMinutes,
      distanceMeters: result.distanceMeters,
      source: result.source,
    };
  }

  /** Signalement d'une adresse par un habitant (file de modération n°2). */
  async report(
    userId: string,
    code: string,
    message?: string,
  ): Promise<ReportResult> {
    const address = await this.loadResolvable(code);
    const created = await this.prisma.report.create({
      data: { addressId: address.id, userId, message: message ?? null },
    });
    return { reportId: created.id, status: 'PENDING' };
  }

  /**
   * Résout l'identité d'une adresse publiée par code (404/410 sinon).
   * Exposé pour les modules tiers (contributions) sans fuiter la logique interne.
   */
  async resolvePublishedAddress(code: string): Promise<PublishedAddressRef> {
    const address = await this.loadResolvable(code);
    return { id: address.id, code: address.code, ownerId: address.userId };
  }

  /**
   * Modification d'adresse (propriétaire) : soumet une nouvelle révision
   * EN_ATTENTE_VALIDATION. Le pointeur ne bascule qu'à l'approbation — le public
   * continue de voir l'ancienne version. Le code ne change jamais.
   */
  async update(
    userId: string,
    code: string,
    dto: UpdateAddressDto,
  ): Promise<UpdatedAddress> {
    const address = await this.loadOwnedAddress(code, userId);
    if (address.lifecycle === 'DESACTIVEE') {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_DEACTIVATED',
        message: 'Une adresse désactivée ne peut plus être modifiée.',
      });
    }

    // Filet applicatif (l'index partiel one_pending_revision_per_address garantit l'unicité).
    const pending = await this.prisma.addressRevision.findFirst({
      where: {
        addressId: address.id,
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
      },
    });
    if (pending) {
      throw new ConflictException({
        code: 'REVISION_ALREADY_PENDING',
        message: 'Une modification est déjà en attente de validation.',
      });
    }

    await this.prisma.addressRevision.create({
      data: {
        addressId: address.id,
        category: dto.category,
        steps: dto.steps,
        assembledText: buildAssembledText(dto.steps),
        photoUrl: dto.photoUrl,
        // GPS porté par la localisation figée (la NAV utilise ce point).
        gpsLat: address.localisation!.gpsLat,
        gpsLng: address.localisation!.gpsLng,
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
      },
    });

    return {
      code: address.code,
      revisionStatus: RevisionStatus.EN_ATTENTE_VALIDATION,
      published: address.publishedRevisionId != null,
    };
  }

  /** Bascule la découvrabilité cartographique (propriétaire). */
  async setDiscoverable(
    userId: string,
    code: string,
    discoverable: boolean,
  ): Promise<DiscoverableResult> {
    const address = await this.loadOwnedAddress(code, userId);
    if (address.lifecycle === 'DESACTIVEE') {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_DEACTIVATED',
        message: 'Une adresse désactivée ne peut plus être modifiée.',
      });
    }
    const updated = await this.prisma.address.update({
      where: { id: address.id },
      data: { mapDiscoverable: discoverable },
    });
    return { code: updated.code, mapDiscoverable: updated.mapDiscoverable };
  }

  /**
   * Désactivation par le propriétaire : lifecycle DESACTIVEE, révision en attente
   * → OBSOLETE (sortie de file, sans rejet/motif) — atomique. Puis nettoyage de
   * la localisation si elle devient vide. Le code n'est jamais réattribué.
   */
  async deactivate(userId: string, code: string): Promise<DeactivatedAddress> {
    const address = await this.loadOwnedAddress(code, userId);
    if (address.lifecycle === 'DESACTIVEE') {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_DEACTIVATED',
        message: 'Cette adresse est déjà désactivée.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: address.id },
        data: {
          lifecycle: 'DESACTIVEE',
          deactivatedAt: new Date(),
          deactivatedById: userId,
        },
      });
      await tx.addressRevision.updateMany({
        where: {
          addressId: address.id,
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        },
        data: { status: RevisionStatus.OBSOLETE },
      });
    });

    if (address.localisationId) {
      await this.localisations.cleanupIfEmpty(address.localisationId);
    }

    return { code: address.code, lifecycle: 'DESACTIVEE' };
  }

  /**
   * Désactivation directe par un membre du staff (admin), sans signalement préalable.
   * Cœur identique à la désactivation propriétaire (DESACTIVEE, révision en attente
   * → OBSOLETE, cleanupIfEmpty) + notification du propriétaire (motif optionnel).
   */
  async deactivateByStaff(
    code: string,
    actorId: string,
    reason?: string,
  ): Promise<DeactivatedAddress> {
    const address = await this.prisma.address.findUnique({ where: { code } });
    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Adresse introuvable.',
      });
    }
    if (address.lifecycle === 'DESACTIVEE') {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_DEACTIVATED',
        message: 'Cette adresse est déjà désactivée.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: address.id },
        data: {
          lifecycle: 'DESACTIVEE',
          deactivatedAt: new Date(),
          deactivatedById: actorId,
          deactivationReason: reason ?? null,
        },
      });
      await tx.addressRevision.updateMany({
        where: {
          addressId: address.id,
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        },
        data: { status: RevisionStatus.OBSOLETE },
      });
    });

    if (address.localisationId) {
      await this.localisations.cleanupIfEmpty(address.localisationId);
    }

    await this.notifications.notifyOwner(address.userId, {
      type: NotificationType.ADDRESS_DEACTIVATED,
      message: reason
        ? `Votre adresse ${address.code} a été désactivée par la modération. Motif : ${reason}`
        : `Votre adresse ${address.code} a été désactivée par la modération.`,
      addressId: address.id,
      url: `/dashboard/address/${address.code}`,
    });

    return { code: address.code, lifecycle: 'DESACTIVEE' };
  }

  /**
   * Historique des versions de contenu d'une adresse (propriétaire uniquement).
   * Sert à la vue propriétaire : afficher le contenu d'une version en attente ou
   * rejetée (avec motif), ainsi que la version actuellement publiée. Plus récentes d'abord.
   */
  async listRevisions(userId: string, code: string): Promise<RevisionView[]> {
    const address = await this.loadOwnedAddress(code, userId);
    const revisions = await this.prisma.addressRevision.findMany({
      where: { addressId: address.id },
      orderBy: { createdAt: 'desc' },
    });
    return revisions.map((r) => ({
      id: r.id,
      status: r.status,
      category: r.category,
      steps: r.steps,
      assembledText: r.assembledText,
      photoUrl: r.photoUrl,
      rejectionReason: r.rejectionReason,
      isPublished: r.id === address.publishedRevisionId,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Charge une adresse détenue par l'utilisateur : inexistante → 404,
   * détenue par un autre → 403 (le code est public, mais pas son administration).
   */
  private async loadOwnedAddress(code: string, userId: string) {
    const address = await this.prisma.address.findUnique({
      where: { code },
      include: { localisation: { select: { gpsLat: true, gpsLng: true } } },
    });
    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Adresse introuvable.',
      });
    }
    if (address.userId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_ADDRESS_OWNER',
        message: "Vous n'êtes pas le propriétaire de cette adresse.",
      });
    }
    return address;
  }

  /**
   * Charge une adresse résolvable publiquement, ou lève l'erreur idoine :
   * inexistante / jamais publiée → 404 (existence non exposée),
   * désactivée → 410.
   */
  private async loadResolvable(code: string) {
    const address = await this.prisma.address.findUnique({
      where: { code },
      include: {
        publishedRevision: true,
        localisation: { include: { quartier: true } },
      },
    });

    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Adresse introuvable.',
      });
    }
    if (address.lifecycle === 'DESACTIVEE') {
      throw new GoneException({
        code: 'ADDRESS_INACTIVE',
        message: 'This address has been deactivated.',
        address_code: address.code,
        deactivated_at: address.deactivatedAt,
      });
    }
    if (!address.publishedRevisionId || !address.publishedRevision) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Adresse introuvable.',
      });
    }
    return address;
  }

  /** Score de fiabilité = moyenne des notes 1–5 arrondie au dixième, null si aucune. */
  private async aggregateRatings(addressId: string): Promise<RatingSummary> {
    const agg = await this.prisma.rating.aggregate({
      where: { addressId },
      _avg: { stars: true },
      _count: { stars: true },
    });
    const avg = agg._avg.stars;
    return {
      averageRating: avg == null ? null : Math.round(avg * 10) / 10,
      ratingCount: agg._count.stars,
    };
  }
}
