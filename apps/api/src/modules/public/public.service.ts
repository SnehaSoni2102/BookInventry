import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PublicCopyPage } from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import { bookTitles, copies, genres } from '../../db/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import { coverUrls } from '../titles/title-queries.js';

@Injectable()
export class PublicService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /**
   * What a customer sees after scanning a sticker. Built from an allow-list: shelf position, stall,
   * donor, notes and internal ids are never copied into the response, whatever `public.fields` says.
   */
  async copyPage(rawCode: string): Promise<PublicCopyPage> {
    const code = rawCode.toUpperCase();
    const s = await this.settings.getAll();
    if (s['public.enabled'] === false || !/^[A-Z]{2,4}\d{7}$/.test(code)) throw new AppError('NOT_FOUND', 'Book not found');

    const [row] = await this.db
      .select({ copy: copies, title: bookTitles, genre: genres })
      .from(copies)
      .innerJoin(bookTitles, eq(bookTitles.id, copies.titleId))
      .innerJoin(genres, eq(genres.id, bookTitles.genreId))
      .where(eq(copies.code, code));
    if (!row) throw new AppError('NOT_FOUND', 'Book not found');

    const fields = new Set(s['public.fields'] as string[]);
    const { copy, title, genre } = row;
    return {
      code: copy.code,
      orgName: s['org.name'] as string,
      availability: copy.status === 'SOLD' ? 'SOLD' : copy.status === 'WRITTEN_OFF' ? 'UNAVAILABLE' : 'AVAILABLE',
      ...(fields.has('cover') ? { coverUrl: coverUrls(title).coverUrl } : {}),
      ...(fields.has('title') ? { title: title.title } : {}),
      ...(fields.has('authors') ? { authors: title.authors } : {}),
      ...(fields.has('genre') ? { genre: { name: genre.name, code: genre.code, color: genre.color } } : {}),
      ...(fields.has('condition') ? { condition: copy.condition } : {}),
      ...(fields.has('sellingPrice') ? { sellingPriceMinor: copy.sellingPriceMinor } : {}),
      ...(fields.has('originalPrice') ? { originalPriceMinor: copy.originalPriceMinor } : {}),
      ...(fields.has('summary') ? { summary: title.summary } : {}),
    };
  }
}
