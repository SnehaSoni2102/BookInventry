import { Module } from '@nestjs/common';
import { ShelfCapacityService } from './shelf-capacity.service.js';
import { ShelfAllocationService } from './shelf-allocation.service.js';
import { ShelvesController } from './shelves.controller.js';
import { ShelvesService } from './shelves.service.js';

@Module({
  controllers: [ShelvesController],
  providers: [ShelvesService, ShelfAllocationService, ShelfCapacityService],
  exports: [ShelfAllocationService, ShelvesService, ShelfCapacityService],
})
export class ShelvesModule {}
