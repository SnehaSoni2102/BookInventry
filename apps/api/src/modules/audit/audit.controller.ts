import { Controller, Get, Inject, Query } from '@nestjs/common';
import { listAuditQuerySchema, type ListAuditQuery } from '@bookstall/shared';
import { RequirePermission } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';

@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query(zod(listAuditQuerySchema)) q: ListAuditQuery) {
    return this.audit.list(q);
  }
}
