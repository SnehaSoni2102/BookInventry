import type { SaleListItem, SummaryRow } from './sales';
import type { StallDto } from './stalls';

export interface DashboardResponse {
  /** Staff and admins. */
  inventory?: { titles: number; inStock: number; atStalls: number; unshelved: number; labelsPending: number; writtenOff: number };
  /** Admins: today's revenue per stall (+ Admin central) and the grand total, in the organisation's time zone. */
  salesToday?: { rows: SummaryRow[]; total: SummaryRow };
  activeStalls?: StallDto[];
  shelfAlerts?: Array<{ genreId: string; code: string; percentFull: number }>;
  recentSales?: SaleListItem[];
  /** Stall managers. */
  myStall?: {
    stall: { id: string; name: string; status: string } | null;
    booksAtStall: number;
    valueAtStallMinor: number;
    today: { salesCount: number; itemsCount: number; revenueMinor: number };
  };
}
