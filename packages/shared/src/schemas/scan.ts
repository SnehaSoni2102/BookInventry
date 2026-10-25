import { z } from 'zod';
import type { CatalogLookupResult } from './catalog';
import type { CopyDetail } from './copies';
import type { CopyGroup } from './titles';

export const scanResolveQuerySchema = z.object({ value: z.string().min(1).max(500) });

export type CopyAction =
  | { action: 'SELL'; requiresConfirm?: 'COPY_AT_STALL'; stall?: { id: string; name: string } }
  | { action: 'CHECKOUT' }
  | { action: 'CHECKIN'; stall: { id: string; name: string }; returnToLocation: string | null }
  | { action: 'EDIT' }
  | { action: 'PRINT_LABEL' }
  | { action: 'WRITE_OFF' };

export type ScanResolveResult =
  | { kind: 'copy'; copy: CopyDetail; actions: CopyAction[] }
  | { kind: 'copy'; blocked: 'COPY_NOT_AT_YOUR_STALL'; copy: { code: string; title: string; authors: string[] }; actions: [] }
  | { kind: 'isbn'; isbn13: string; titleId?: string; copyGroups?: CopyGroup[]; lookup?: CatalogLookupResult }
  | { kind: 'unknown'; raw: string };

export interface PublicCopyPage {
  code: string;
  orgName: string;
  availability: 'AVAILABLE' | 'SOLD' | 'UNAVAILABLE';
  coverUrl?: string | null;
  title?: string;
  authors?: string[];
  genre?: { name: string; code: string; color: string };
  condition?: string;
  sellingPriceMinor?: number;
  originalPriceMinor?: number | null;
  summary?: string | null;
}
