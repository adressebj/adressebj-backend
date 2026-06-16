import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKey } from '@prisma/client';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CurrentApiKey } from '../common/decorators/current-api-key.decorator';
import {
  AddressesService,
  EtaResponse,
  PublicAddress,
  ResolvedAddress,
  VerifyResult,
} from './addresses.service';
import { EtaQueryDto } from './dto/eta-query.dto';

/**
 * Endpoints d'accès en lecture par code, hors espace habitant :
 *  - page publique visiteur (sans auth)
 *  - résolution intégrateur (clé API)
 * Séparé d'`AddressesController` pour ne pas hériter de ses gardes JWT/HABITANT.
 */
@ApiTags('addresses')
@Controller('addresses')
export class PublicAddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get(':code')
  @ApiOperation({ summary: 'Page publique (visiteur, sans auth)' })
  publicPage(@Param('code') code: string): Promise<PublicAddress> {
    return this.addresses.getPublicPage(code);
  }

  @Get(':code/resolve')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Résolution complète (clé API, météré)' })
  resolve(
    @Param('code') code: string,
    @CurrentApiKey() apiKey: ApiKey,
  ): Promise<ResolvedAddress> {
    return this.addresses.resolve(code, apiKey.id);
  }

  @Get(':code/verify')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Vérification (moyenne /5, clé API, météré)' })
  verify(
    @Param('code') code: string,
    @CurrentApiKey() apiKey: ApiKey,
  ): Promise<VerifyResult> {
    return this.addresses.verify(code, apiKey.id);
  }

  @Get(':code/eta')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Estimation ETA depuis une origine (clé API, météré)',
  })
  eta(
    @Param('code') code: string,
    @Query() query: EtaQueryDto,
    @CurrentApiKey() apiKey: ApiKey,
  ): Promise<EtaResponse> {
    return this.addresses.eta(
      code,
      { lat: query.fromLat, lng: query.fromLng },
      apiKey.id,
    );
  }
}
