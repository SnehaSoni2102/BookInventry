import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');
