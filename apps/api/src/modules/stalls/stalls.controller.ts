import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import {
  assignManagerBodySchema, checkinBodySchema, checkoutBodySchema, closeStallBodySchema, createStallBodySchema,
  listStallsQuerySchema, listTitlesQuerySchema, movementsQuerySchema, pickListQuerySchema, updateStallBodySchema, uuidSchema,
  type AssignManagerBody, type CheckinBody, type CheckoutBody, type CloseStallBody, type CreateStallBody,
  type ListStallsQuery, type ListTitlesQuery, type MovementsQuery, type UpdateStallBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { MovementsService } from './movements.service.js';
import { renderPickList, renderStallReport } from './stall-pdfs.js';
import { renderStallXlsx } from './stall-xlsx.js';
import { StallsService } from './stalls.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller()
export class StallsController {
  constructor(
    @Inject(StallsService) private readonly stalls: StallsService,
    @Inject(MovementsService) private readonly movements: MovementsService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  // Staff need the list to pick a destination for checkout; only admins manage.
  @Get('stalls')
  @RequirePermission('stall.manage', 'stall.checkout', 'stall.checkin')
  list(@Query(zod(listStallsQuerySchema)) q: ListStallsQuery) {
    return this.stalls.list(q);
  }

  // Declared before ':id' so "mine" is not read as an id.
  @Get('stalls/mine')
  @RequirePermission('sale.create.stall', 'sale.read.own', 'inventory.read.stall')
  async mine(@CurrentUser() me: AuthUser) {
    // wrapped, because Nest sends a bare `null` as an empty body
    return { stall: await this.stalls.mine(me) };
  }

  @Post('stalls')
  @RequirePermission('stall.manage')
  create(@CurrentUser() me: AuthUser, @Body(zod(createStallBodySchema)) body: CreateStallBody, @Req() req: Request) {
    return this.stalls.create(me.id, body, req.ip);
  }

  @Get('stalls/:id')
  async get(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    await this.stalls.assertCanView(me, id);
    return this.stalls.get(id);
  }

  @Patch('stalls/:id')
  @RequirePermission('stall.manage')
  update(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(updateStallBodySchema)) body: UpdateStallBody, @Req() req: Request) {
    return this.stalls.update(me.id, id, body, req.ip);
  }

  @Post('stalls/:id/activate')
  @HttpCode(200)
  @RequirePermission('stall.manage')
  activate(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Req() req: Request) {
    return this.stalls.activate(me.id, id, req.ip);
  }

  @Post('stalls/:id/managers')
  @RequirePermission('stall.manage')
  assign(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(assignManagerBodySchema)) body: AssignManagerBody, @Req() req: Request) {
    return this.stalls.assign(me.id, id, body, req.ip);
  }

  @Delete('stalls/:id/managers/:userId')
  @RequirePermission('stall.manage')
  unassign(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Param('userId', zod(uuidSchema)) userId: string, @Req() req: Request) {
    return this.stalls.unassign(me.id, id, userId, req.ip);
  }

  @Delete('stalls/:id')
  @HttpCode(204)
  @RequirePermission('stall.manage')
  async remove(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Req() req: Request) {
    await this.stalls.remove(me.id, id, req.ip);
  }

  // ── checkout / check-in ──

  @Post('stalls/:id/checkout')
  @RequirePermission('stall.checkout')
  checkout(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(checkoutBodySchema)) body: CheckoutBody, @Req() req: Request) {
    return this.movements.checkout(me.id, id, body, req.ip);
  }

  @Get('stalls/:id/pick-list.pdf')
  @RequirePermission('stall.checkout')
  async pickList(@Param('id', zod(uuidSchema)) id: string, @Query(zod(pickListQuerySchema)) q: { batchId: string }) {
    return new StreamableFile(await renderPickList(await this.movements.pickList(id, q.batchId)), {
      type: 'application/pdf', disposition: 'inline; filename="pick-list.pdf"',
    });
  }

  @Post('checkin')
  @RequirePermission('stall.checkin')
  checkin(@CurrentUser() me: AuthUser, @Body(zod(checkinBodySchema)) body: CheckinBody, @Req() req: Request) {
    return this.movements.checkin(me.id, body, req.ip);
  }

  // ── inventory / history / reconciliation ──

  /** Same shape as GET /titles, scoped to this stall. Admins/staff for any stall, a manager for their own. */
  @Get('stalls/:id/inventory')
  async inventoryOf(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Query(zod(listTitlesQuerySchema)) q: ListTitlesQuery) {
    await this.stalls.assertCanView(me, id);
    // A manager is already pinned to their stall by scope; for everyone else pin it to :id.
    return this.inventory.listTitles(me, { ...q, status: 'atStalls', stallId: id });
  }

  @Get('stalls/:id/movements')
  @RequirePermission('stall.manage')
  movementsOf(@Param('id', zod(uuidSchema)) id: string, @Query(zod(movementsQuerySchema)) q: MovementsQuery) {
    return this.stalls.movements(id, q);
  }

  @Get('stalls/:id/reconciliation')
  @RequirePermission('stall.manage')
  reconciliation(@Param('id', zod(uuidSchema)) id: string) {
    return this.stalls.reconciliation(id);
  }

  @Post('stalls/:id/close')
  @HttpCode(200)
  @RequirePermission('stall.manage')
  close(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(closeStallBodySchema)) body: CloseStallBody, @Req() req: Request) {
    return this.stalls.close(me.id, id, body, req.ip);
  }

  @Get('stalls/:id/report.pdf')
  @RequirePermission('stall.manage', 'report.read')
  async reportPdf(@Param('id', zod(uuidSchema)) id: string) {
    const [rec, moves] = await Promise.all([this.stalls.reconciliation(id), this.stalls.movements(id, { page: 1, pageSize: 100 })]);
    if (moves.total > 100) throw new AppError('VALIDATION_FAILED', 'Too many books for the PDF report; use the .xlsx report');
    return new StreamableFile(await renderStallReport(rec, moves.items), { type: 'application/pdf', disposition: 'inline; filename="stall-report.pdf"' });
  }

  @Get('stalls/:id/report.xlsx')
  @RequirePermission('stall.manage', 'report.read')
  async reportXlsx(@Param('id', zod(uuidSchema)) id: string) {
    const rec = await this.stalls.reconciliation(id);
    const all = [];
    for (let page = 1; ; page++) {
      const batch = await this.stalls.movements(id, { page, pageSize: 100 });
      all.push(...batch.items);
      if (all.length >= batch.total || !batch.items.length) break;
    }
    return new StreamableFile(await renderStallXlsx(rec, all), { type: XLSX, disposition: 'attachment; filename="stall-report.xlsx"' });
  }
}
