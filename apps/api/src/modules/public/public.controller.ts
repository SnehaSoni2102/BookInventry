import { Controller, Get, Inject, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/index.js';
import { PublicService } from './public.service.js';

@Controller('public')
export class PublicController {
  constructor(@Inject(PublicService) private readonly publicPages: PublicService) {}

  /** No auth; 60 requests/min per IP. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('copies/:code')
  copy(@Param('code') code: string) {
    return this.publicPages.copyPage(code);
  }
}
