import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddressesService, MapMarker } from './addresses.service';
import { MapQueryDto } from './dto/map-query.dto';

/**
 * Carte browsable publique (sans auth). Séparé d'`AddressesController` pour ne
 * pas hériter de ses gardes JWT/HABITANT.
 */
@ApiTags('map')
@Controller('map')
export class MapController {
  constructor(private readonly addresses: AddressesService) {}

  @Get('addresses')
  @ApiOperation({
    summary: 'Surcouche carte : adresses publiées + découvrables (bbox)',
  })
  addressesInBounds(@Query() query: MapQueryDto): Promise<MapMarker[]> {
    return this.addresses.mapAddresses(query);
  }
}
