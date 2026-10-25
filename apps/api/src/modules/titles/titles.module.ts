import { Module } from '@nestjs/common';
import { ShelvesModule } from '../shelves/shelves.module.js';
import { TitlesController } from './titles.controller.js';
import { TitlesService } from './titles.service.js';

@Module({ imports: [ShelvesModule], controllers: [TitlesController], providers: [TitlesService], exports: [TitlesService] })
export class TitlesModule {}
