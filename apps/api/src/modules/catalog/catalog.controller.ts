import { Controller, Get, Inject, Query } from '@nestjs/common';
import { lookupQuerySchema, priceSuggestionQuerySchema, searchQuerySchema } from '@bookstall/shared';
import type { BookCondition } from '@bookstall/shared';
import { RequirePermission } from '../../common/decorators/index.js';
import { zod } from '../../common/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
@RequirePermission('copy.create', 'title.write')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('lookup')
  lookup(@Query(zod(lookupQuerySchema)) q: { isbn: string }) {
    return this.catalog.lookup(q.isbn);
  }

  @Get('search')
  search(@Query(zod(searchQuerySchema)) q: { q: string; author?: string }) {
    return this.catalog.search(q.q, q.author);
  }

  @Get('price-suggestion')
  priceSuggestion(@Query(zod(priceSuggestionQuerySchema)) q: { originalPriceMinor: number; condition: BookCondition }) {
    return this.catalog.priceSuggestion(q.originalPriceMinor, q.condition);
  }
}
