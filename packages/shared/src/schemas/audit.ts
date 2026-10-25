import { z } from 'zod';
import { paginationQuerySchema } from './common';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
