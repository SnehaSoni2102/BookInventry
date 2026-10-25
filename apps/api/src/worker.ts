import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { MaintenanceService } from './modules/maintenance/maintenance.service.js';
import { JobsService } from './modules/jobs/jobs.service.js';

// Same image as the API, different entrypoint: no HTTP server, only pg-boss consumers.
loadEnv();
const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
await app.get(JobsService).startWorker();
await app.get(MaintenanceService).schedule();
