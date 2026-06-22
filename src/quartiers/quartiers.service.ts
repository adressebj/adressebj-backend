import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiEndpoint, Prisma, Quartier } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuartierDto } from './dto/create-quartier.dto';
import { UpdateQuartierDto } from './dto/update-quartier.dto';

export interface QuartierSummary {
  id: string;
  name: string;
  prefix: string;
}

/** Vue admin d'un quartier : tous statuts, centre/polygone, et nombre d'adresses rattachées. */
export interface AdminQuartierRow {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  centerLat: number | null;
  centerLng: number | null;
  hasPolygon: boolean;
  addressCount: number;
  createdAt: Date;
}

export interface QuartierAnalytics {
  quartierId: string;
  quartierName: string;
  totalVisits: number;
  medianEtaMinutes: number | null;
  medianPriceFCFA: number | null;
  peakHours: string[];
  successRate: number | null;
  period: 'last_30_days';
}

/** Seuil minimal du ratio de remontée pour accéder aux analytics (cf. CdC §8). */
const ANALYTICS_RATIO_THRESHOLD = 0.8;
/** Nombre de tranches horaires de pointe retournées. */
const PEAK_HOURS_COUNT = 2;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Médiane d'une liste de nombres (liste non vide), sinon `null`. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

@Injectable()
export class QuartiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** Création manuelle d'un quartier (admin). Préfixe unique. */
  async createQuartier(dto: CreateQuartierDto): Promise<Quartier> {
    const existing = await this.prisma.quartier.findUnique({
      where: { prefix: dto.prefix },
    });
    if (existing) {
      throw new ConflictException({
        code: 'QUARTIER_PREFIX_TAKEN',
        message: 'Ce préfixe de quartier est déjà utilisé.',
      });
    }
    return this.prisma.quartier.create({
      data: {
        name: dto.name,
        prefix: dto.prefix,
        centerLat: dto.centerLat ?? null,
        centerLng: dto.centerLng ?? null,
        polygon: (dto.polygon ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  /** Modification d'un quartier (admin) : nom, préfixe, centre, polygone, activation. */
  async updateQuartier(id: string, dto: UpdateQuartierDto): Promise<Quartier> {
    const quartier = await this.prisma.quartier.findUnique({ where: { id } });
    if (!quartier) {
      throw new NotFoundException({
        code: 'QUARTIER_NOT_FOUND',
        message: 'Quartier introuvable.',
      });
    }
    if (dto.prefix !== undefined && dto.prefix !== quartier.prefix) {
      const taken = await this.prisma.quartier.findUnique({
        where: { prefix: dto.prefix },
      });
      if (taken) {
        throw new ConflictException({
          code: 'QUARTIER_PREFIX_TAKEN',
          message: 'Ce préfixe de quartier est déjà utilisé.',
        });
      }
    }

    const data: Prisma.QuartierUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.prefix !== undefined) data.prefix = dto.prefix;
    if (dto.centerLat !== undefined) data.centerLat = dto.centerLat;
    if (dto.centerLng !== undefined) data.centerLng = dto.centerLng;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.polygon !== undefined) {
      data.polygon = dto.polygon as Prisma.InputJsonValue;
    }

    return this.prisma.quartier.update({ where: { id }, data });
  }

  /** Liste admin de tous les quartiers (actifs et inactifs) avec compteur d'adresses. */
  async listAllForAdmin(): Promise<AdminQuartierRow[]> {
    const quartiers = await this.prisma.quartier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { localisations: true } } },
    });
    // Le compteur d'adresses vivantes par quartier (via localisations).
    const counts = await this.prisma.address.groupBy({
      by: ['localisationId'],
      where: { lifecycle: { not: 'DESACTIVEE' }, localisationId: { not: null } },
      _count: { _all: true },
    });
    const locToAddrCount = new Map<string, number>();
    for (const c of counts) {
      if (c.localisationId) locToAddrCount.set(c.localisationId, c._count._all);
    }
    const localisations = await this.prisma.localisation.findMany({
      select: { id: true, quartierId: true },
    });
    const quartierAddrCount = new Map<string, number>();
    for (const loc of localisations) {
      const n = locToAddrCount.get(loc.id) ?? 0;
      quartierAddrCount.set(
        loc.quartierId,
        (quartierAddrCount.get(loc.quartierId) ?? 0) + n,
      );
    }

    return quartiers.map((q) => ({
      id: q.id,
      name: q.name,
      prefix: q.prefix,
      isActive: q.isActive,
      centerLat: q.centerLat,
      centerLng: q.centerLng,
      hasPolygon: q.polygon !== null,
      addressCount: quartierAddrCount.get(q.id) ?? 0,
      createdAt: q.createdAt,
    }));
  }

  /** Liste des quartiers actifs (référentiel public). */
  async listActive(): Promise<QuartierSummary[]> {
    const quartiers = await this.prisma.quartier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, prefix: true },
    });
    return quartiers;
  }

  /**
   * Analytics de quartier (intégrateurs, clé API) sur les 30 derniers jours.
   * Accès conditionné au ratio de remontée de la clé (`CONFIRM`/`RESOLVE` ≥ 80 %).
   * Métré (`ANALYTICS`) une fois le quota satisfait. Les visites n'entrent jamais
   * dans le score de fiabilité — elles n'alimentent qu'ici (et l'ETA).
   */
  async analytics(
    quartierId: string,
    apiKeyId: string,
  ): Promise<QuartierAnalytics> {
    const quartier = await this.prisma.quartier.findUnique({
      where: { id: quartierId },
      select: { id: true, name: true },
    });
    if (!quartier) {
      throw new NotFoundException({
        code: 'QUARTIER_NOT_FOUND',
        message: 'Quartier introuvable.',
      });
    }

    // Quota de remontée : dénominateur nul (aucune résolution sur 30 j) ⇒ accès
    // autorisé — aucun trajet pris, donc aucune obligation de remontée (cf. #F).
    const { ratio, resolves } = await this.apiKeys.reportingRatio(apiKeyId);
    if (resolves > 0 && ratio < ANALYTICS_RATIO_THRESHOLD) {
      const pct = Math.round(ratio * 100);
      throw new ForbiddenException({
        code: 'ANALYTICS_QUOTA_INSUFFICIENT',
        message: `Ratio de remontée insuffisant (${pct}% < 80% requis sur 30 jours).`,
      });
    }

    await this.apiKeys.logRequest(apiKeyId, ApiEndpoint.ANALYTICS);

    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const visits = await this.prisma.visit.findMany({
      where: {
        createdAt: { gte: since },
        address: { localisation: { quartierId } },
      },
      select: { departAt: true, arrivedAt: true, finalPrice: true },
    });

    return {
      quartierId: quartier.id,
      quartierName: quartier.name,
      ...this.aggregate(visits),
      period: 'last_30_days',
    };
  }

  /** Agrège une liste de visites en métriques analytiques (calcul applicatif, prototype). */
  private aggregate(
    visits: {
      departAt: Date;
      arrivedAt: Date | null;
      finalPrice: number | null;
    }[],
  ): Omit<QuartierAnalytics, 'quartierId' | 'quartierName' | 'period'> {
    const totalVisits = visits.length;
    if (totalVisits === 0) {
      return {
        totalVisits: 0,
        medianEtaMinutes: null,
        medianPriceFCFA: null,
        peakHours: [],
        successRate: null,
      };
    }

    const confirmed = visits.filter((v) => v.arrivedAt !== null);
    const etaMinutes = confirmed.map(
      (v) => (v.arrivedAt!.getTime() - v.departAt.getTime()) / 60000,
    );
    const prices = visits
      .map((v) => v.finalPrice)
      .filter((p): p is number => p !== null);

    const medEta = median(etaMinutes);
    const medPrice = median(prices);

    return {
      totalVisits,
      medianEtaMinutes: medEta === null ? null : Math.round(medEta),
      medianPriceFCFA: medPrice === null ? null : Math.round(medPrice),
      peakHours: this.peakHours(visits.map((v) => v.departAt)),
      successRate: Math.round((confirmed.length / totalVisits) * 100) / 100,
    };
  }

  /** Tranches horaires les plus fréquentées (heure de départ, UTC), triées par heure. */
  private peakHours(departures: Date[]): string[] {
    const counts = new Array<number>(24).fill(0);
    for (const d of departures) counts[d.getUTCHours()]++;

    return counts
      .map((count, hour) => ({ count, hour }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count || a.hour - b.hour)
      .slice(0, PEAK_HOURS_COUNT)
      .sort((a, b) => a.hour - b.hour)
      .map((b) => `${pad(b.hour)}:00-${pad((b.hour + 1) % 24)}:00`);
  }
}

const pad = (n: number): string => n.toString().padStart(2, '0');
