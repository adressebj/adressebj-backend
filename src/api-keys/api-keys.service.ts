import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiEndpoint, ApiKey } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Préfixe obligatoire de toute clé API émise (cf. CdC backend §9). */
export const API_KEY_PREFIX = 'bj_live_';

/** Alphabet du secret (sans 0/O/I/l pour la lisibilité), 16 caractères. */
const KEY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KEY_SECRET_LENGTH = 16;

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

  /**
   * Crée une clé API (admin). Génère `bj_live_` + 16 caractères aléatoires.
   * La clé en clair n'existe que dans la réponse de création — elle est stockée telle quelle
   * (ce n'est pas un secret type mot de passe, cf. CdC §9) mais n'est jamais réaffichée ailleurs.
   */
  async createKey(label: string, expiresAt?: string): Promise<ApiKey> {
    const key = API_KEY_PREFIX + this.generateSecret();
    return this.prisma.apiKey.create({
      data: {
        key,
        label,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
  }

  /** Révoque une clé API (admin) : statut REVOKED + horodatage. Idempotent côté statut. */
  async revokeKey(id: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'Clé API introuvable.',
      });
    }
    return this.prisma.apiKey.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }

  private generateSecret(): string {
    const bytes = randomBytes(KEY_SECRET_LENGTH);
    let out = '';
    for (let i = 0; i < KEY_SECRET_LENGTH; i++) {
      out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
    }
    return out;
  }
}
