import { Module } from '@nestjs/common';
import { QuartiersModule } from '../quartiers/quartiers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Capacités exclusivement administrateur (quartiers, clés API, modérateurs,
 * suspension d'habitants, supervision). Réutilise QuartiersService (quartiers)
 * et ApiKeysService (clés, module global) ; AdminService porte la gestion des comptes.
 */
@Module({
  imports: [QuartiersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
