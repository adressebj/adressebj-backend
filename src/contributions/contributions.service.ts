import { BadRequestException, Injectable } from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ContributionResult {
  contributionId: string;
  status: 'PENDING';
}

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
  ) {}

  /**
   * Soumission d'une contribution terrain (PENDING). Validée/rejetée plus tard
   * par la modération. Une contribution approuvée devient une info terrain
   * complémentaire — elle ne modifie JAMAIS les `steps` de l'adresse.
   */
  async create(
    userId: string,
    code: string,
    message: string,
  ): Promise<ContributionResult> {
    if (!message || message.trim().length === 0) {
      throw new BadRequestException({
        code: 'CONTRIBUTION_MESSAGE_REQUIRED',
        message: 'Le message de la contribution est requis.',
      });
    }
    const address = await this.addresses.resolvePublishedAddress(code);
    const created = await this.prisma.contribution.create({
      data: { addressId: address.id, userId, message: message.trim() },
    });
    return { contributionId: created.id, status: 'PENDING' };
  }
}
