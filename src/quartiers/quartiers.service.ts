import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiEndpoint } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';

export interface QuartierSummary {
  id: string;
  name: string;
  prefix: string;
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
