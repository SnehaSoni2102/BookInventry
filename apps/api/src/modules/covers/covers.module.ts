import { Global, Module } from '@nestjs/common';
import { CoverService } from './cover.service.js';
import { FilesController } from './files.controller.js';

@Global()
@Module({ controllers: [FilesController], providers: [CoverService], exports: [CoverService] })
export class CoversModule {}
