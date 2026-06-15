import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeactivateAddressDto } from './dto/deactivate-address.dto';
import { RejectRevisionDto } from './dto/reject-revision.dto';
import {
  ContributionDecision,
  ModerationService,
  PendingContribution,
  PendingReport,
  PendingRevision,
  ReportDecision,
  RevisionDecision,
} from './moderation.service';

@ApiTags('moderation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MODERATEUR, Role.ADMIN)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('revisions')
  @ApiOperation({
    summary: 'File 1 : révisions en attente (créations + modifications)',
  })
  listRevisions(): Promise<PendingRevision[]> {
    return this.moderation.listPendingRevisions();
  }

  @Patch('revisions/:id/approve')
  @ApiOperation({
    summary: 'Valider une révision (devient PUBLIEE, bascule le pointeur)',
  })
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RevisionDecision> {
    return this.moderation.approveRevision(id, user.id);
  }

  @Patch('revisions/:id/reject')
  @ApiOperation({
    summary: 'Rejeter une révision (motif obligatoire, pointeur inchangé)',
  })
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectRevisionDto,
  ): Promise<RevisionDecision> {
    return this.moderation.rejectRevision(id, user.id, dto.reason);
  }

  @Get('reports')
  @ApiOperation({ summary: 'File 2 : signalements en attente' })
  listReports(): Promise<PendingReport[]> {
    return this.moderation.listPendingReports();
  }

  @Patch('reports/:id/resolve')
  @ApiOperation({ summary: 'Marquer un signalement comme résolu' })
  resolveReport(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ReportDecision> {
    return this.moderation.resolveReport(id, user.id);
  }

  @Patch('reports/:id/deactivate')
  @ApiOperation({ summary: "Désactiver l'adresse signalée" })
  deactivateReported(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DeactivateAddressDto,
  ): Promise<ReportDecision> {
    return this.moderation.deactivateFromReport(id, user.id, dto.reason);
  }

  @Get('contributions')
  @ApiOperation({ summary: 'File 3 : contributions terrain en attente' })
  listContributions(): Promise<PendingContribution[]> {
    return this.moderation.listPendingContributions();
  }

  @Patch('contributions/:id/approve')
  @ApiOperation({
    summary: 'Approuver une contribution (info terrain publique)',
  })
  approveContribution(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ContributionDecision> {
    return this.moderation.approveContribution(id, user.id);
  }

  @Patch('contributions/:id/reject')
  @ApiOperation({ summary: 'Rejeter une contribution' })
  rejectContribution(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ContributionDecision> {
    return this.moderation.rejectContribution(id, user.id);
  }
}
