import { Module } from '@nestjs/common';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import { PointsListeners } from './listeners/points.listeners';

/**
 * Points & reputation. Earning is entirely event-driven (see listeners);
 * no other module calls PointsService to award points directly.
 */
@Module({
  controllers: [PointsController],
  providers: [PointsService, PointsListeners],
  exports: [PointsService],
})
export class PointsModule {}
