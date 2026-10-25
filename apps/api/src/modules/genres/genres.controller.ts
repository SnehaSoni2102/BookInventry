import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  createGenreBodySchema, putGenreKeywordsBodySchema, updateGenreBodySchema, uuidSchema,
  type CreateGenreBody, type PutGenreKeywordsBody, type UpdateGenreBody,
} from '@bookstall/shared';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { GenresService } from './genres.service.js';

@Controller('genres')
export class GenresController {
  constructor(@Inject(GenresService) private readonly genres: GenresService) {}

  /** Any signed-in user may read genres (the add-book form and filters need them). */
  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.genres.list(includeInactive === 'true');
  }

  @Get(':id')
  get(@Param('id', zod(uuidSchema)) id: string) {
    return this.genres.get(id);
  }

  @Post()
  @RequirePermission('genre.manage')
  create(@CurrentUser() me: AuthUser, @Body(zod(createGenreBodySchema)) body: CreateGenreBody) {
    return this.genres.create(me.id, body);
  }

  @Patch(':id')
  @RequirePermission('genre.manage')
  update(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(updateGenreBodySchema)) body: UpdateGenreBody) {
    return this.genres.update(me.id, id, body);
  }

  @Put(':id/keywords')
  @RequirePermission('genre.manage')
  putKeywords(@CurrentUser() me: AuthUser, @Param('id', zod(uuidSchema)) id: string, @Body(zod(putGenreKeywordsBodySchema)) body: PutGenreKeywordsBody) {
    return this.genres.putKeywords(me.id, id, body);
  }
}
