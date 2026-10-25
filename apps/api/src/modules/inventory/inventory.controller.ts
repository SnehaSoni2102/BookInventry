import { Controller, Get, Inject, Query } from '@nestjs/common';
import { listCopiesQuerySchema, listTitlesQuerySchema, type ListCopiesQuery, type ListTitlesQuery } from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { InventoryService } from './inventory.service.js';

@Controller()
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get('titles')
  @RequirePermission('inventory.read', 'inventory.read.stall')
  titles(@CurrentUser() me: AuthUser, @Query(zod(listTitlesQuerySchema)) q: ListTitlesQuery) {
    return this.inventory.listTitles(me, q);
  }

  @Get('copies')
  @RequirePermission('inventory.read', 'inventory.read.stall')
  copies(@CurrentUser() me: AuthUser, @Query(zod(listCopiesQuerySchema)) q: ListCopiesQuery) {
    return this.inventory.listCopies(me, q);
  }
}
