import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ContributionResult,
  ContributionsService,
} from './contributions.service';
import { CreateContributionDto } from './dto/create-contribution.dto';

@ApiTags('contributions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HABITANT)
@Controller('addresses')
export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  @Post(':code/contribution')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Soumettre une contribution terrain (texte libre)' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: CreateContributionDto,
  ): Promise<ContributionResult> {
    return this.contributions.create(user.id, code, dto.message);
  }
}
