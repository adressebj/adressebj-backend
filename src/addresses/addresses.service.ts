import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { RevisionStatus } from '@prisma/client';
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

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localisations: LocalisationsService,
  ) {}

  /** Génère un code unique pour un préfixe de quartier (vérif d'unicité avant persistance). */
  async generateUniqueCode(quartierPrefix: string): Promise<string> {
    for (let attempts = 0; attempts < MAX_CODE_ATTEMPTS; attempts++) {
      const code = `${quartierPrefix}-${generateSequence()}`;
      const existing = await this.prisma.address.findUnique({ where: { code } });
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
}
