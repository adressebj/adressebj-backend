import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface QuartierSummary {
  id: string;
  name: string;
  prefix: string;
}

@Injectable()
export class QuartiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liste des quartiers actifs (référentiel public). */
  async listActive(): Promise<QuartierSummary[]> {
    const quartiers = await this.prisma.quartier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, prefix: true },
    });
    return quartiers;
  }
}
