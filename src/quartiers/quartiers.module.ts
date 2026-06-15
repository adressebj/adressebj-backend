import { Module } from '@nestjs/common';
import { QuartiersController } from './quartiers.controller';
import { QuartiersService } from './quartiers.service';

@Module({
  controllers: [QuartiersController],
  providers: [QuartiersService],
  exports: [QuartiersService],
})
export class QuartiersModule {}
