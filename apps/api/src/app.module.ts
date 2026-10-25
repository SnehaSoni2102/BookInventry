import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionGuard } from './common/guards/permission.guard.js';
import { AppThrottlerGuard } from './common/guards/throttle.guard.js';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GenresModule } from './modules/genres/genres.module.js';
import { EventBusModule } from './common/events/event-bus.js';
import { CommonModule } from './common/common.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.service.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CopiesModule } from './modules/copies/copies.module.js';
import { CoversModule } from './modules/covers/covers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { LabelsModule } from './modules/labels/labels.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ScanModule } from './modules/scan/scan.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { StallsModule } from './modules/stalls/stalls.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TitlesModule } from './modules/titles/titles.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ShelvesModule } from './modules/shelves/shelves.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.token'],
        autoLogging: { ignore: (req) => req.url?.includes('/health/') ?? false },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // 300 requests/min per user (or per IP when anonymous); login overrides this to 5/min.
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => !env.RATE_LIMIT_ENABLED,
      }),
    }),
    DbModule,
    CommonModule,
    EventBusModule,
    IdempotencyModule,
    JobsModule,
    MaintenanceModule,
    StorageModule,
    CoversModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    GenresModule,
    ShelvesModule,
    TitlesModule,
    CopiesModule,
    CatalogModule,
    InventoryModule,
    ImportsModule,
    DashboardModule,
    ReportsModule,
    StallsModule,
    SalesModule,
    RealtimeModule,
    LabelsModule,
    ScanModule,
    PublicModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Order matters: authenticate, then authorize, then rate-limit (so the tracker knows the user).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
