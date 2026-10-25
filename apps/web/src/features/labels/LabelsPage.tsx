import { qk } from '@bookstall/api-client';
import type { LabelQueueItem } from '@bookstall/shared';
import { Button, Checkbox, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../app/api';
import { DataTable, type Column } from '../../components/DataTable';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { LocationCode } from '../../components/LocationCode';
import { EmptyState, ErrorState } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useFormat } from '../../lib/format';

/** Copies whose label has never been printed, or changed (price / condition / location). */
export default function LabelsPage() {
  const fmt = useFormat();
  const params = useListParams({ who: 'all' });
  const q = useQuery({
    queryKey: qk.labels.queue({ who: params.get('who'), page: params.page, size: params.pageSize, job: params.get('job') }),
    queryFn: () => api.labels.queue({ page: params.page, pageSize: params.pageSize, ...(params.get('who') === 'me' ? { createdBy: 'me' as const } : {}), ...(params.get('job') ? { importJobId: params.get('job') } : {}) }),
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const rows = q.data?.items ?? [];
  useEffect(() => setSel(new Set()), [q.data]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const columns: Column<LabelQueueItem>[] = [
    { key: 'sel', width: 40, header: <Checkbox aria-label="Select all" checked={rows.length > 0 && sel.size === rows.length} indeterminate={sel.size > 0 && sel.size < rows.length} onChange={(e) => setSel(e.currentTarget.checked ? new Set(rows.map((r) => r.id)) : new Set())} />, cell: (r) => <Checkbox aria-label={`Select ${r.code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> },
    { key: 'code', header: 'Code', cell: (r) => <Text fw={600} size="sm">{r.code}</Text> },
    { key: 'title', header: 'Title', cell: (r) => <div><Text size="sm" lineClamp={1}>{r.title}</Text><Text size="xs" c="dimmed">{r.authors[0]}</Text></div> },
    { key: 'price', header: 'Price', align: 'right', cell: (r) => fmt.money(r.sellingPriceMinor) },
    { key: 'loc', header: 'Location', cell: (r) => <LocationCode code={r.locationCode} /> },
    { key: 'added', header: 'Added', hideBelow: 'sm', cell: (r) => fmt.date(r.createdAt) },
  ];
  const ids = sel.size ? [...sel] : rows.map((r) => r.id);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Label print queue</Title>
        <Group>
          <SegmentedControl value={params.get('who')} onChange={(v) => params.set({ who: v })} data={[{ value: 'all', label: 'Everyone' }, { value: 'me', label: 'Created by me' }]} />
          <Button disabled={!rows.length} onClick={() => setOpen(true)} data-testid="print-queue">Print {sel.size ? `${sel.size} selected` : 'this page'}</Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">New books and books whose price or location changed. Printing marks them done.</Text>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={q.isLoading} total={q.data?.total} page={params.page} pageSize={params.pageSize} onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })} empty={<EmptyState title="All labels are printed" />} />
      )}
      <LabelPrintDialog opened={open} onClose={() => setOpen(false)} copyIds={ids} onPrinted={() => void q.refetch()} />
    </Stack>
  );
}
