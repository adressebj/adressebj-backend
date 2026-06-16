import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKey, Quartier, Role } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { QuartiersService } from '../quartiers/quartiers.service';
import {
  AdminAddressRow,
  AdminService,
  Paginated,
  StaffView,
  SuspensionView,
} from './admin.service';
import { AdminAddressesQueryDto } from './dto/admin-addresses-query.dto';
import { CreateQuartierDto } from '../quartiers/dto/create-quartier.dto';
import { UpdateQuartierDto } from '../quartiers/dto/update-quartier.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { UpdateModeratorDto } from './dto/update-moderator.dto';

/** Routes exclusivement administrateur (quartiers, clés API, modérateurs, comptes). */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly quartiers: QuartiersService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  // ── Quartiers ──────────────────────────────────────────────────────────────
  @Post('quartiers')
  @ApiOperation({ summary: 'Créer un quartier' })
  createQuartier(@Body() dto: CreateQuartierDto): Promise<Quartier> {
    return this.quartiers.createQuartier(dto);
  }

  @Patch('quartiers/:id')
  @ApiOperation({ summary: 'Modifier / (dés)activer un quartier' })
  updateQuartier(
    @Param('id') id: string,
    @Body() dto: UpdateQuartierDto,
  ): Promise<Quartier> {
    return this.quartiers.updateQuartier(id, dto);
  }

  // ── Supervision référentiel ─────────────────────────────────────────────────
  @Get('addresses')
  @ApiOperation({ summary: 'Supervision du référentiel (recherche + filtres)' })
  listAddresses(
    @Query() query: AdminAddressesQueryDto,
  ): Promise<Paginated<AdminAddressRow>> {
    return this.admin.listAddresses(query);
  }

  // ── Modérateurs ─────────────────────────────────────────────────────────────
  @Post('moderators')
  @ApiOperation({ summary: 'Créer un compte Modérateur' })
  createModerator(@Body() dto: CreateModeratorDto): Promise<StaffView> {
    return this.admin.createModerator(dto);
  }

  @Patch('moderators/:id')
  @ApiOperation({
    summary: 'Désactiver / réactiver / réinitialiser un Modérateur',
  })
  updateModerator(
    @Param('id') id: string,
    @Body() dto: UpdateModeratorDto,
  ): Promise<StaffView> {
    return this.admin.updateModerator(id, dto);
  }

  // ── Suspension d'habitants ──────────────────────────────────────────────────
  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspendre un Habitant' })
  suspendUser(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
  ): Promise<SuspensionView> {
    return this.admin.suspendUser(id, dto.reason);
  }

  @Patch('users/:id/unsuspend')
  @ApiOperation({ summary: 'Lever la suspension d’un Habitant' })
  unsuspendUser(@Param('id') id: string): Promise<SuspensionView> {
    return this.admin.unsuspendUser(id);
  }

  // ── Clés API ────────────────────────────────────────────────────────────────
  @Post('api-keys')
  @ApiOperation({
    summary: 'Créer une clé API (clé en clair renvoyée une seule fois)',
  })
  createApiKey(@Body() dto: CreateApiKeyDto): Promise<ApiKey> {
    return this.apiKeys.createKey(dto.label, dto.expiresAt);
  }

  @Delete('api-keys/:id')
  @ApiOperation({ summary: 'Révoquer une clé API' })
  revokeApiKey(@Param('id') id: string): Promise<ApiKey> {
    return this.apiKeys.revokeKey(id);
  }
}
