import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/decorators/index.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() me: AuthUser) {
    return this.dashboard.get(me);
  }
}
