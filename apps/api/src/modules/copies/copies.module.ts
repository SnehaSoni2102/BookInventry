import { Module } from '@nestjs/common';
import { ShelvesModule } from '../shelves/shelves.module.js';
import { CopiesController } from './copies.controller.js';
import { CopiesService } from './copies.service.js';

@Module({ imports: [ShelvesModule], controllers: [CopiesController], providers: [CopiesService], exports: [CopiesService] })
export class CopiesModule {}
