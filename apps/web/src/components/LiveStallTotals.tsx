import type { SummaryRow } from '@bookstall/shared';
import { Badge, Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format';

interface Props {
  rows: SummaryRow[] | undefined;
  total: SummaryRow | undefined;
  loading?: boolean;
}

/**
 * One card per active stall + "Admin (central)" + grand total. A card flashes when its revenue changes
 * (the realtime socket refetches the summary), so a volunteer watching the screen sees sales arrive.
 */
export function LiveStallTotals({ rows, total, loading }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const prev = useRef<Map<string, number>>(new Map());
  const [flash, setFlash] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rows) return;
    const changed = new Set<string>();
    for (const r of [...rows, ...(total ? [total] : [])]) {
      const before = prev.current.get(r.key);
      if (before !== undefined && before !== r.revenueMinor) changed.add(r.key);
      prev.current.set(r.key, r.revenueMinor);
    }
    if (changed.size) {
      setFlash(changed);
      const id = setTimeout(() => setFlash(new Set()), 1800);
      return () => clearTimeout(id);
    }
  }, [rows, total]);

  if (loading && !rows) return <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} />)}</SimpleGrid>;

  const Card_ = ({ r, grand }: { r: SummaryRow; grand?: boolean }) => (
    <Card
      withBorder padding="md" data-testid={grand ? 'totals-grand' : `totals-${r.key}`}
      style={{ transition: 'background .4s', background: flash.has(r.key) ? 'var(--mantine-color-yellow-light)' : grand ? 'var(--mantine-color-goonj-light)' : undefined }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} size="sm" lineClamp={1}>{r.label}</Text>
        <Badge variant="light" size="sm">{r.itemsCount} book{r.itemsCount === 1 ? '' : 's'}</Badge>
      </Group>
      <Text fw={800} size="xl" mt={4} data-testid="revenue">{fmt.money(r.revenueMinor)}</Text>
      <Text size="xs" c="dimmed" mt={2}>
        {(['CASH', 'UPI', 'CARD', 'OTHER'] as const).filter((m) => r.byPaymentMethod[m] > 0).map((m) => `${t(`payment.${m}`)} ${fmt.money(r.byPaymentMethod[m])}`).join(' · ') || 'No sales yet'}
      </Text>
    </Card>
  );

  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {total && <Card_ r={{ ...total, label: 'All sales' }} grand />}
        {rows?.map((r) => <Card_ key={r.key} r={r} />)}
      </SimpleGrid>
    </Stack>
  );
}
