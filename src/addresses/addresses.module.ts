import { Module } from '@nestjs/common';
import { LocalisationsModule } from '../localisations/localisations.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { PublicAddressesController } from './public-addresses.controller';

@Module({
  imports: [LocalisationsModule],
  // AddressesController d'abord : sa route statique `mine` doit primer sur `:code`.
  controllers: [AddressesController, PublicAddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
