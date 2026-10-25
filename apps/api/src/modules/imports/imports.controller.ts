import {
  Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IMPORT_MAX_BYTES, commitImportBodySchema, listImportRowsQuerySchema, listImportsQuerySchema, patchImportRowBodySchema, uuidSchema,
  type CommitImportBody, type ListImportRowsQuery, type PatchImportRowBody,
} from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { ImportsService } from './imports.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('imports')
@RequirePermission('import.manage')
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly imports: ImportsService) {}

  @Get('template.xlsx')
  async template() {
    return new StreamableFile(await this.imports.template(), { type: XLSX, disposition: 'attachment; filename="bookstall-import-template.xlsx"' });
  }

  @Get()
  list(@Query(zod(listImportsQuerySchema)) q: { page: number; pageSize: number }) {
    return this.imports.list(q.page, q.pageSize);
  }

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  upload(@CurrentUser() me: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('VALIDATION_FAILED', 'Attach the Excel file in the "file" field');
    return this.imports.upload(me.id, file);
  }

  @Get(':id')
  get(@Param('id', zod(uuidSchema)) id: string) {
    return this.imports.get(id);
  }

  @Get(':id/rows')
  rows(@Param('id', zod(uuidSchema)) id: string, @Query(zod(listImportRowsQuerySchema)) q: ListImportRowsQuery) {
    return this.imports.rows(id, q);
  }

  @Patch(':id/rows/:rowId')
  patchRow(@Param('id', zod(uuidSchema)) id: string, @Param('rowId', zod(uuidSchema)) rowId: string, @Body(zod(patchImportRowBodySchema)) body: PatchImportRowBody) {
    return this.imports.patchRow(id, rowId, body);
  }

  @Post(':id/rows/:rowId/skip')
  @HttpCode(200)
  skip(@Param('id', zod(uuidSchema)) id: string, @Param('rowId', zod(uuidSchema)) rowId: string) {
    return this.imports.skipRow(id, rowId);
  }

  @Post(':id/commit')
  @HttpCode(202)
  commit(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(commitImportBodySchema)) body: CommitImportBody) {
    return this.imports.requestCommit(me.id, id, body);
  }

  @Get(':id/result.xlsx')
  async result(@Param('id', zod(uuidSchema)) id: string) {
    return new StreamableFile(await this.imports.resultXlsx(id), { type: XLSX, disposition: 'attachment; filename="import-result.xlsx"' });
  }
}
