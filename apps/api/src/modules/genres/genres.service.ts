import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { CreateGenreBody, GenreDto, PutGenreKeywordsBody, UpdateGenreBody } from '@bookstall/shared';
import { AppError } from '../../common/app-error.js';
import type { Db } from '../../db/client.js';
import { DB, TxRunner } from '../../db/db.module.js';
import { genreKeywords, genres } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';

const toDto = (g: typeof genres.$inferSelect): GenreDto => ({
  id: g.id, name: g.name, code: g.code, color: g.color, sortOrder: g.sortOrder, isActive: g.isActive,
});

@Injectable()
export class GenresService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TxRunner) private readonly txr: TxRunner,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<GenreDto[]> {
    const rows = await this.db.select().from(genres).orderBy(asc(genres.sortOrder), asc(genres.name));
    return rows.filter((g) => includeInactive || g.isActive).map(toDto);
  }

  async get(id: string): Promise<GenreDto> {
    const [g] = await this.db.select().from(genres).where(eq(genres.id, id));
    if (!g) throw new AppError('NOT_FOUND', 'Genre not found');
    const keywords = await this.db
      .select({ keyword: genreKeywords.keyword, weight: genreKeywords.weight })
      .from(genreKeywords)
      .where(eq(genreKeywords.genreId, id))
      .orderBy(asc(genreKeywords.keyword));
    return { ...toDto(g), keywords };
  }

  async create(actorId: string, body: CreateGenreBody): Promise<GenreDto> {
    return this.txr.run(async (tx) => {
      const [dupe] = await tx
        .select({ id: genres.id })
        .from(genres)
        .where(sql`${genres.code} = ${body.code} OR lower(${genres.name}) = lower(${body.name})`);
      if (dupe) throw new AppError('CONFLICT', 'A genre with that name or code already exists');
      const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${genres.sortOrder}), 0)::int` }).from(genres);
      const [g] = await tx
        .insert(genres)
        .values({ name: body.name, code: body.code, ...(body.color ? { color: body.color } : {}), sortOrder: body.sortOrder ?? max + 1 })
        .returning();
      await this.audit.record(tx, { actorId, action: 'genre.create', entityType: 'genre', entityId: g!.id, after: toDto(g!) });
      return toDto(g!);
    });
  }

  async update(actorId: string, id: string, body: UpdateGenreBody): Promise<GenreDto> {
    return this.txr.run(async (tx) => {
      const [before] = await tx.select().from(genres).where(eq(genres.id, id)).for('update');
      if (!before) throw new AppError('NOT_FOUND', 'Genre not found');
      if (body.name && body.name.toLowerCase() !== before.name.toLowerCase()) {
        const [dupe] = await tx.select({ id: genres.id }).from(genres).where(sql`lower(${genres.name}) = lower(${body.name})`);
        if (dupe) throw new AppError('CONFLICT', 'A genre with that name already exists');
      }
      const [after] = await tx.update(genres).set(body).where(eq(genres.id, id)).returning();
      await this.audit.record(tx, {
        actorId, action: 'genre.update', entityType: 'genre', entityId: id, before: toDto(before), after: toDto(after!),
      });
      return toDto(after!);
    });
  }

  async putKeywords(actorId: string, id: string, body: PutGenreKeywordsBody): Promise<GenreDto> {
    await this.txr.run(async (tx) => {
      const [g] = await tx.select({ id: genres.id }).from(genres).where(eq(genres.id, id));
      if (!g) throw new AppError('NOT_FOUND', 'Genre not found');
      const unique = [...new Map(body.keywords.map((k) => [k.keyword, k])).values()];
      await tx.delete(genreKeywords).where(eq(genreKeywords.genreId, id));
      if (unique.length) await tx.insert(genreKeywords).values(unique.map((k) => ({ genreId: id, ...k })));
      await this.audit.record(tx, { actorId, action: 'genre.keywords.update', entityType: 'genre', entityId: id, after: unique });
    });
    return this.get(id);
  }
}
