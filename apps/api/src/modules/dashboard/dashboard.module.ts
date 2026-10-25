import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { ShelvesModule } from '../shelves/shelves.module.js';
import { StallsModule } from '../stalls/stalls.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [SalesModule, StallsModule, ShelvesModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
