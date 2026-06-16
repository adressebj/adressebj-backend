import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiEndpoint, ApiKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Préfixe obligatoire de toute clé API émise (cf. CdC backend §9). */
export const API_KEY_PREFIX = 'bj_live_';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valide une clé brute : existence, statut ACTIVE, expiration éventuelle.
   * Lève une 401 portant un `code` machine distinct selon la cause.
   */
  async validate(rawKey: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { key: rawKey },
    });
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'API_KEY_INVALID',
        message: 'Clé API invalide.',
      });
    }
    if (apiKey.status === 'REVOKED') {
      throw new UnauthorizedException({
        code: 'API_KEY_REVOKED',
        message: 'Clé API révoquée.',
      });
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: 'API_KEY_EXPIRED',
        message: 'Clé API expirée.',
      });
    }
    return apiKey;
  }

  /** Métering : une ligne par appel facturable (ratio de remontée — cf. #F). */
  async logRequest(apiKeyId: string, endpoint: ApiEndpoint): Promise<void> {
    await this.prisma.apiRequestLog.create({ data: { apiKeyId, endpoint } });
  }

  /**
   * Ratio de remontée d'une clé sur 30 jours glissants : `CONFIRM` / `RESOLVE`.
   * Numérateur = visites confirmées remontées par l'intégrateur ; dénominateur =
   * résolutions effectuées (les navigations à reporter). `ratio = 0` si aucune
   * résolution (pas de base de remontée). Conditionne l'accès aux analytics (≥ 80 %).
   */
  async reportingRatio(apiKeyId: string): Promise<{
    confirms: number;
    resolves: number;
    ratio: number;
  }> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [confirms, resolves] = await Promise.all([
      this.prisma.apiRequestLog.count({
        where: {
          apiKeyId,
          endpoint: ApiEndpoint.CONFIRM,
          createdAt: { gte: since },
        },
      }),
      this.prisma.apiRequestLog.count({
        where: {
          apiKeyId,
          endpoint: ApiEndpoint.RESOLVE,
          createdAt: { gte: since },
        },
      }),
    ]);
    const ratio = resolves > 0 ? confirms / resolves : 0;
    return { confirms, resolves, ratio };
  }
}
