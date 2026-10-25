import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CopiesModule } from '../copies/copies.module.js';
import { TitlesModule } from '../titles/titles.module.js';
import { ScanController } from './scan.controller.js';
import { ScanService } from './scan.service.js';

@Module({ imports: [CatalogModule, CopiesModule, TitlesModule], controllers: [ScanController], providers: [ScanService] })
export class ScanModule {}
