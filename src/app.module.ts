import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LocalisationsModule } from './localisations/localisations.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuartiersModule } from './quartiers/quartiers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    QuartiersModule,
    LocalisationsModule,
    HealthModule,
  ],
})
export class AppModule {}
