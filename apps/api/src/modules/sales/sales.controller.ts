import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import {
  createSaleBodySchema, listSalesQuerySchema, receiptQuerySchema, salesSummaryQuerySchema, uuidSchema, voidSaleBodySchema,
  type CreateSaleBody, type ListSalesQuery, type SalesSummaryQuery, type VoidSaleBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { renderReceipt } from './receipt-pdf.js';
import { renderSalesXlsx } from './sales-xlsx.js';
import { SalesService } from './sales.service.js';
import { SettingsService } from '../settings/settings.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('sales')
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Post()
  @RequirePermission('sale.create.central', 'sale.create.stall')
  create(@CurrentUser() me: AuthUser, @Body(zod(createSaleBodySchema)) body: CreateSaleBody, @Req() req: Request) {
    return this.sales.create(me, body, req.ip);
  }

  @Get()
  @RequirePermission('sale.read.all', 'sale.read.own')
  list(@CurrentUser() me: AuthUser, @Query(zod(listSalesQuerySchema)) q: ListSalesQuery) {
    return this.sales.list(me, q);
  }

  // Static routes first so they are not captured by ':id'.
  @Get('summary')
  @RequirePermission('sale.read.all', 'sale.read.own')
  summary(@CurrentUser() me: AuthUser, @Query(zod(salesSummaryQuerySchema)) q: SalesSummaryQuery) {
    return this.sales.summary(me, q);
  }

  @Get('export.xlsx')
  @RequirePermission('sale.read.all')
  async export(@CurrentUser() me: AuthUser, @Query(zod(listSalesQuerySchema)) q: ListSalesQuery) {
    const { page: _p, pageSize: _s, ...filters } = q;
    const rows = await this.sales.exportRows(me, filters);
    return new StreamableFile(await renderSalesXlsx(rows, await this.settings.get<string>('org.timezone')), {
      type: XLSX, disposition: 'attachment; filename="sales.xlsx"',
    });
  }

  @Get(':id')
  @RequirePermission('sale.read.all', 'sale.read.own')
  get(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    return this.sales.get(me, id);
  }

  @Get(':id/receipt.pdf')
  @RequirePermission('sale.read.all', 'sale.read.own')
  async receipt(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Query(zod(receiptQuerySchema)) q: { format: 'thermal' | 'a6' }) {
    const sale = await this.sales.get(me, id);
    const s = await this.settings.getAll();
    const pdf = await renderReceipt(sale, { name: s['org.name'] as string, tz: s['org.timezone'] as string, locale: s['org.locale'] as string }, q.format);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `inline; filename="${sale.receiptNo}.pdf"` });
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('sale.void')
  void(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(voidSaleBodySchema)) body: VoidSaleBody, @Req() req: Request) {
    return this.sales.void(me, id, body, req.ip);
  }
}
