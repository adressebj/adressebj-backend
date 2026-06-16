import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKey } from '@prisma/client';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CurrentApiKey } from '../common/decorators/current-api-key.decorator';
import {
  QuartierAnalytics,
  QuartierSummary,
  QuartiersService,
} from './quartiers.service';

@ApiTags('quartiers')
@Controller('quartiers')
export class QuartiersController {
  constructor(private readonly quartiers: QuartiersService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des quartiers actifs' })
  list(): Promise<QuartierSummary[]> {
    return this.quartiers.listActive();
  }

  @Get(':id/analytics')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Analytics de quartier (clé API + quota ratio ≥ 80 %, météré)',
  })
  analytics(
    @Param('id') id: string,
    @CurrentApiKey() apiKey: ApiKey,
  ): Promise<QuartierAnalytics> {
    return this.quartiers.analytics(id, apiKey.id);
  }
}
