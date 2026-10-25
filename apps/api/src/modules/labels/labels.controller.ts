import { Body, Controller, Get, Header, Inject, Param, Post, Query, StreamableFile } from '@nestjs/common';
import {
  labelPdfBodySchema, labelPdfQuerySchema, labelQueueQuerySchema, markPrintedBodySchema, uuidSchema,
  type LabelPdfBody, type LabelPdfQuery, type LabelQueueQuery, type MarkPrintedBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { LabelsService } from './labels.service.js';

@Controller()
export class LabelsController {
  constructor(@Inject(LabelsService) private readonly labels: LabelsService) {}

  @Get('labels/pdf')
  @RequirePermission('label.print')
  async pdf(@CurrentUser() me: AuthUser, @Query(zod(labelPdfQuerySchema)) q: LabelPdfQuery) {
    return new StreamableFile(await this.labels.pdf(me, q), { type: 'application/pdf', disposition: 'inline; filename="labels.pdf"' });
  }

  /** Large batches (up to 500 labels): ids in the body. */
  @Post('labels/pdf')
  @RequirePermission('label.print')
  async pdfFromBody(@CurrentUser() me: AuthUser, @Body(zod(labelPdfBodySchema)) body: LabelPdfBody) {
    return new StreamableFile(await this.labels.pdf(me, body), { type: 'application/pdf', disposition: 'inline; filename="labels.pdf"' });
  }

  @Get('labels/queue')
  @RequirePermission('label.print')
  queue(@CurrentUser() me: AuthUser, @Query(zod(labelQueueQuerySchema)) q: LabelQueueQuery) {
    return this.labels.queue(me, q);
  }

  @Post('labels/mark-printed')
  @RequirePermission('label.print')
  markPrinted(@CurrentUser() me: AuthUser, @Body(zod(markPrintedBodySchema)) body: MarkPrintedBody) {
    return this.labels.markPrinted(me, body.copyIds);
  }

  @Get('copies/:id/qr.svg')
  @RequirePermission('label.print', 'inventory.read', 'inventory.read.stall')
  @Header('Content-Type', 'image/svg+xml')
  async qr(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    return new StreamableFile(Buffer.from(await this.labels.qrSvgFor(me, id)), { type: 'image/svg+xml' });
  }
}
