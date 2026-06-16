import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';

/** Expose le RoutingService (OSRM + repli) aux modules qui calculent une ETA. */
@Module({
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
