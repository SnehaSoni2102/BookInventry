import { Body, Controller, Get, Inject, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import {
  bulkRowsBodySchema, createRackBodySchema, createRowBodySchema, rowSignsQuerySchema, unshelvedQuerySchema,
  updateRackBodySchema, updateRowBodySchema, uuidSchema,
  type BulkRowsBody, type CreateRackBody, type CreateRowBody, type RowSignsQuery, type UpdateRackBody, type UpdateRowBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { renderRowSigns } from './row-signs.pdf.js';
import { ShelvesService } from './shelves.service.js';

@Controller()
export class ShelvesController {
  constructor(@Inject(ShelvesService) private readonly shelves: ShelvesService) {}

  @Get('racks')
  @RequirePermission('shelf.manage', 'inventory.read')
  racks() {
    return this.shelves.listRacks();
  }

  @Post('racks')
  @RequirePermission('shelf.manage')
  createRack(@CurrentUser() me: AuthUser, @Body(zod(createRackBodySchema)) body: CreateRackBody) {
    return this.shelves.createRack(me.id, body);
  }

  @Patch('racks/:id')
  @RequirePermission('shelf.manage')
  updateRack(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(updateRackBodySchema)) body: UpdateRackBody) {
    return this.shelves.updateRack(me.id, id, body);
  }

  @Post('racks/:id/rows/bulk')
  @RequirePermission('shelf.manage')
  bulkRows(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(bulkRowsBodySchema)) body: BulkRowsBody) {
    return this.shelves.bulkCreateRows(me.id, id, body);
  }

  @Get('rows')
  @RequirePermission('shelf.manage', 'inventory.read')
  rows() {
    return this.shelves.listRows();
  }

  @Post('rows')
  @RequirePermission('shelf.manage')
  createRow(@CurrentUser() me: AuthUser, @Body(zod(createRowBodySchema)) body: CreateRowBody) {
    return this.shelves.createRow(me.id, body);
  }

  @Patch('rows/:id')
  @RequirePermission('shelf.manage')
  updateRow(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(updateRowBodySchema)) body: UpdateRowBody) {
    return this.shelves.updateRow(me.id, id, body);
  }

  @Get('shelves/map')
  @RequirePermission('shelf.manage', 'inventory.read')
  map() {
    return this.shelves.map();
  }

  @Get('shelves/rows/:id/slots')
  @RequirePermission('shelf.manage', 'inventory.read')
  slots(@Param('id', zod(uuidSchema)) id: string) {
    return this.shelves.rowSlots(id);
  }

  @Get('shelves/unshelved')
  @RequirePermission('shelf.manage', 'inventory.read')
  unshelved(@Query(zod(unshelvedQuerySchema)) q: { page: number; pageSize: number }) {
    return this.shelves.unshelved(q.page, q.pageSize);
  }

  @Post('shelves/place-unshelved')
  @RequirePermission('shelf.manage', 'copy.update')
  placeUnshelved(@CurrentUser() me: AuthUser) {
    return this.shelves.placeUnshelved(me.id);
  }

  @Get('shelves/row-signs.pdf')
  @RequirePermission('shelf.manage')
  async rowSigns(@Query(zod(rowSignsQuerySchema)) q: RowSignsQuery) {
    const pdf = await renderRowSigns(await this.shelves.rowsForSigns(q.rowIds));
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: 'inline; filename="row-signs.pdf"' });
  }
}
