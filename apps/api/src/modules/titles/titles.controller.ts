import {
  Body, Controller, Get, Inject, Param, Patch, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { updateTitleBodySchema, uuidSchema, type UpdateTitleBody } from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { ScopeService } from '../../common/scope.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { TitlesService } from './titles.service.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Controller('titles')
export class TitlesController {
  constructor(
    @Inject(TitlesService) private readonly titles: TitlesService,
    @Inject(ScopeService) private readonly scope: ScopeService,
  ) {}

  @Get(':id')
  @RequirePermission('inventory.read', 'inventory.read.stall')
  async get(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    const scope = await this.scope.resolve(me);
    const detail = await this.titles.detail(id, scope);
    // A manager may only open titles that have copies at their stall.
    if (scope.kind === 'stall' && detail.copyGroups.length === 0) throw new AppError('NOT_FOUND', 'Title not found');
    return detail;
  }

  @Patch(':id')
  @RequirePermission('title.write')
  update(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(updateTitleBodySchema)) body: UpdateTitleBody) {
    return this.titles.update(me.id, id, body);
  }

  @Post(':id/cover')
  @RequirePermission('title.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadCover(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('VALIDATION_FAILED', 'Attach an image in the "file" field');
    if (!IMAGE_TYPES.has(file.mimetype)) throw new AppError('VALIDATION_FAILED', 'Only JPEG, PNG or WebP images are accepted');
    return this.titles.uploadCover(me.id, id, file.buffer);
  }

  @Post(':id/relocate')
  @RequirePermission('copy.update')
  relocate(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string) {
    return this.titles.relocate(me.id, id);
  }
}
