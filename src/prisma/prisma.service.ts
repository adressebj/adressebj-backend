import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma singleton. Prisma 7 : la connexion directe passe par le driver
 * adapter @prisma/adapter-pg, construit depuis DATABASE_URL (cf. docs/DECISIONS.md).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg(config.getOrThrow<string>('DATABASE_URL')),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion à la base de données établie.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
