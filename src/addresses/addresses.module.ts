import { Module } from '@nestjs/common';
import { LocalisationsModule } from '../localisations/localisations.module';
import { RoutingModule } from '../common/routing/routing.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { MapController } from './map.controller';
import { PublicAddressesController } from './public-addresses.controller';

@Module({
  imports: [LocalisationsModule, RoutingModule],
  // AddressesController d'abord : sa route statique `mine` doit primer sur `:code`.
  controllers: [AddressesController, MapController, PublicAddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
