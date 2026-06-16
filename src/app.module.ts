import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AddressesModule } from './addresses/addresses.module';
import { AdminModule } from './admin/admin.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { ContributionsModule } from './contributions/contributions.module';
import { HealthModule } from './health/health.module';
import { LocalisationsModule } from './localisations/localisations.module';
import { ModerationModule } from './moderation/moderation.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuartiersModule } from './quartiers/quartiers.module';
import { VisitsModule } from './visits/visits.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ApiKeysModule,
    AuthModule,
    QuartiersModule,
    LocalisationsModule,
    AddressesModule,
    ContributionsModule,
    ModerationModule,
    VisitsModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule {}
