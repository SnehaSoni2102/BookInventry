import { Badge, Tooltip } from '@mantine/core';
import type { BookCondition, CopyStatus } from '@bookstall/shared';
import { useTranslation } from 'react-i18next';

const CONDITION_COLOR: Record<string, string> = { NEW: 'teal', LIKE_NEW: 'green', VERY_GOOD: 'lime', GOOD: 'blue', FAIR: 'orange', POOR: 'red' };
const STATUS_COLOR: Record<string, string> = { IN_STOCK: 'green', AT_STALL: 'violet', SOLD: 'gray', WRITTEN_OFF: 'red' };

export function ConditionBadge({ condition }: { condition: BookCondition | string }) {
  const { t } = useTranslation();
  return (
    <Tooltip label={t(`conditionHelp.${condition}`)} withArrow>
      <Badge variant="light" color={CONDITION_COLOR[condition] ?? 'gray'}>{t(`condition.${condition}`)}</Badge>
    </Tooltip>
  );
}

export function StatusBadge({ status, stall }: { status: CopyStatus | string; stall?: string | null }) {
  const { t } = useTranslation();
  const label = status === 'AT_STALL' && stall ? `At ${stall}` : t(`status.${status}`);
  return <Badge variant="dot" color={STATUS_COLOR[status] ?? 'gray'}>{label}</Badge>;
}

/** Genre chip: colour from the genre, and the code is always shown so colour is never the only signal. */
export function GenreChip({ genre }: { genre: { name: string; code: string; color: string } }) {
  return (
    <Tooltip label={genre.name} withArrow>
      <Badge variant="outline" style={{ borderColor: genre.color, color: 'inherit' }} leftSection={<span style={{ width: 8, height: 8, borderRadius: 4, background: genre.color, display: 'inline-block' }} />}>
        {genre.code}
      </Badge>
    </Tooltip>
  );
}
