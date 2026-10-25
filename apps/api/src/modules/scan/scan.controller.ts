import { Controller, Get, Inject, Query } from '@nestjs/common';
import { scanResolveQuerySchema } from '@bookstall/shared';
import { CurrentUser, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { ScanService } from './scan.service.js';

@Controller('scan')
export class ScanController {
  constructor(@Inject(ScanService) private readonly scan: ScanService) {}

  /** Any signed-in user; what they get back is scoped by role. */
  @Get('resolve')
  resolve(@CurrentUser() me: AuthUser, @Query(zod(scanResolveQuerySchema)) q: { value: string }) {
    return this.scan.resolve(me, q.value);
  }
}
