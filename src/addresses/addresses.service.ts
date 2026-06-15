import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ApiEndpoint, RevisionStatus } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { LocalisationsService } from '../localisations/localisations.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildAssembledText, generateSequence } from './address-code';
import { CreateAddressDto } from './dto/create-address.dto';

const MAX_CODE_ATTEMPTS = 50;

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

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localisations: LocalisationsService,
    private readonly apiKeys: ApiKeysService,
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
    await this.prisma.rating.upsert({
      where: { userId_addressId: { userId, addressId: address.id } },
      create: { userId, addressId: address.id, stars },
      update: { stars },
    });
    const summary = await this.aggregateRatings(address.id);
    return { recorded: true, ...summary };
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
