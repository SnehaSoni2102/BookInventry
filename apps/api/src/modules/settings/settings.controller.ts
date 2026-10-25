import { Body, Controller, Get, Inject, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { can, updateSettingsBodySchema, type UpdateSettingsBody } from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  /** Everyone gets the client-safe subset; people who can manage settings get all of them. */
  @Get()
  async get(@CurrentUser() me: AuthUser) {
    return can(me, 'settings.manage') ? { settings: await this.settings.getAll() } : { client: await this.settings.clientSettings() };
  }

  @Patch()
  @RequirePermission('settings.manage')
  async update(@CurrentUser() me: AuthUser, @Body(zod(updateSettingsBodySchema)) body: Record<string, unknown>, @Req() req: Request) {
    return { settings: await this.settings.update(me.id, body as UpdateSettingsBody, req.ip) };
  }
}
