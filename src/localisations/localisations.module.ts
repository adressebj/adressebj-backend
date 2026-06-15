import { Module } from '@nestjs/common';
import { LocalisationsService } from './localisations.service';

@Module({
  providers: [LocalisationsService],
  exports: [LocalisationsService],
})
export class LocalisationsModule {}
