import { Module } from '@nestjs/common';
import { ShelvesModule } from '../shelves/shelves.module.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({ imports: [ShelvesModule], controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
