import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ShelvesModule } from '../shelves/shelves.module.js';
import { UsersModule } from '../users/users.module.js';
import { MovementsService } from './movements.service.js';
import { StallsController } from './stalls.controller.js';
import { StallsService } from './stalls.service.js';

@Module({
  imports: [UsersModule, ShelvesModule, InventoryModule],
  controllers: [StallsController],
  providers: [StallsService, MovementsService],
  exports: [StallsService, MovementsService],
})
export class StallsModule {}
