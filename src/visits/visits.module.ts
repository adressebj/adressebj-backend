import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [AddressesModule],
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
