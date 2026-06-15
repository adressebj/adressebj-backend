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
}
