import { Module } from '@nestjs/common';
import { LabelsController } from './labels.controller.js';
import { LabelsService } from './labels.service.js';

@Module({ controllers: [LabelsController], providers: [LabelsService], exports: [LabelsService] })
export class LabelsModule {}
