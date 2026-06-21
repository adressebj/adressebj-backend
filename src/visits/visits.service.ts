import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiEndpoint } from '@prisma/client';
import { AddressesService } from '../addresses/addresses.service';
import { API_KEY_PREFIX, ApiKeysService } from '../api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmVisitDto } from './dto/confirm-visit.dto';
import { StartVisitDto } from './dto/start-visit.dto';

export interface StartResult {
  visitId: string;
}

export interface ConfirmResult {
  visitId: string;
  recorded: true;
}

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** Départ de navigation (anonyme) : horodatage sur une adresse publiée. */
  async start(dto: StartVisitDto): Promise<StartResult> {
    const address = await this.addresses.resolvePublishedAddress(
      dto.addressCode,
    );
    const visit = await this.prisma.visit.create({
      data: { addressId: address.id, departAt: new Date(dto.departAt) },
    });
    return { visitId: visit.id };
  }

  /**
   * Confirmation d'arrivée. Le mode est déterminé par la présence d'une clé API
   * (`bj_live_…`) dans l'en-tête Authorization : avec clé → remontée intégrateur
   * (nouvelle visite + métering CONFIRM), sans clé → confirmation web.
   */
  async confirm(
    dto: ConfirmVisitDto,
    authHeader?: string,
  ): Promise<ConfirmResult> {
    const token = this.extractApiKeyToken(authHeader);
    if (token) {
      const apiKey = await this.apiKeys.validate(token);
      return this.confirmFromApi(dto, apiKey.id);
    }
    return this.confirmFromWeb(dto);
  }

  /** Mode web : met à jour la visite existante avec son horodatage d'arrivée. */
  private async confirmFromWeb(dto: ConfirmVisitDto): Promise<ConfirmResult> {
    if (!dto.visitId) {
      throw new BadRequestException({
        code: 'VISIT_ID_REQUIRED',
        message: 'visitId est requis pour confirmer une navigation web.',
      });
    }
    const visit = await this.prisma.visit.findUnique({
      where: { id: dto.visitId },
    });
    if (!visit) {
      throw new NotFoundException({
        code: 'VISIT_NOT_FOUND',
        message: 'Visite introuvable.',
      });
    }
    const arrivedAt = new Date(dto.arrivedAt);
    this.assertChronology(visit.departAt, arrivedAt);
    await this.prisma.visit.update({
      where: { id: visit.id },
      data: { arrivedAt },
    });
    return { visitId: visit.id, recorded: true };
  }

  /** Mode API : crée une visite complète (remontée intégrateur) et métère CONFIRM. */
  private async confirmFromApi(
    dto: ConfirmVisitDto,
    apiKeyId: string,
  ): Promise<ConfirmResult> {
    if (!dto.addressCode || !dto.departAt) {
      throw new BadRequestException({
        code: 'VISIT_FIELDS_REQUIRED',
        message: 'addressCode et departAt sont requis pour une remontée API.',
      });
    }
    const departAt = new Date(dto.departAt);
    const arrivedAt = new Date(dto.arrivedAt);
    this.assertChronology(departAt, arrivedAt);

    const address = await this.addresses.resolvePublishedAddress(
      dto.addressCode,
    );
    const visit = await this.prisma.visit.create({
      data: {
        addressId: address.id,
        departAt,
        arrivedAt,
        apiKeyId,
        finalPrice: dto.finalPrice ?? null,
      },
    });
    await this.apiKeys.logRequest(apiKeyId, ApiEndpoint.CONFIRM);
    return { visitId: visit.id, recorded: true };
  }

  private assertChronology(departAt: Date, arrivedAt: Date): void {
    if (arrivedAt.getTime() < departAt.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_VISIT_TIMESTAMPS',
        message: "L'arrivée ne peut pas précéder le départ.",
      });
    }
  }

  /** Retourne le token si l'en-tête porte une clé API `bj_live_…`, sinon undefined. */
  private extractApiKeyToken(authHeader?: string): string | undefined {
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice('Bearer '.length).trim();
    return token.startsWith(API_KEY_PREFIX) ? token : undefined;
  }
}
