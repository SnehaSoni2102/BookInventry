import { Module } from '@nestjs/common';
import { TitlesModule } from '../titles/titles.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({ imports: [TitlesModule], controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
