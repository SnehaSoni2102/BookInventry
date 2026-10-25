import { qk } from '@bookstall/api-client';
import { Code, Group, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../app/api';
import { DataTable, type Column } from '../../components/DataTable';
import { ErrorState } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useFormat } from '../../lib/format';

type Entry = Awaited<ReturnType<typeof api.audit.list>>['items'][number];

function Json({ title, value }: { title: string; value: unknown }) {
  return <div style={{ flex: 1, minWidth: 0 }}><Text size="xs" c="dimmed" fw={600}>{title}</Text><Code block style={{ maxHeight: 320, overflow: 'auto' }}>{value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}</Code></div>;
}

export default function AuditPage() {
  const fmt = useFormat();
  const params = useListParams();
  const [open, setOpen] = useState<Entry | null>(null);
  const filters = { entityType: params.get('type') || undefined, entityId: params.get('id') || undefined, action: params.get('action') || undefined, from: params.get('from') ? new Date(params.get('from')).toISOString() : undefined, to: params.get('to') ? new Date(`${params.get('to')}T23:59:59`).toISOString() : undefined };
  const q = useQuery({ queryKey: qk.audit({ ...filters, page: params.page, size: params.pageSize }), queryFn: () => api.audit.list({ ...filters, page: params.page, pageSize: params.pageSize }) });
  const users = useQuery({ queryKey: [...qk.users.all(), 'names'], queryFn: () => api.users.list({ pageSize: 100 }) });
  const name = (id: string | null) => users.data?.items.find((u) => u.id === id)?.displayName ?? (id ? id.slice(0, 8) : 'system');

  const columns: Column<Entry>[] = [
    { key: 't', header: 'When', cell: (e) => fmt.dateTime(e.createdAt) },
    { key: 'u', header: 'Who', hideBelow: 'sm', cell: (e) => name(e.actorId) },
    { key: 'a', header: 'Action', cell: (e) => <Code>{e.action}</Code> },
    { key: 'e', header: 'Entity', hideBelow: 'md', cell: (e) => <Text size="xs" c="dimmed">{e.entityType} {e.entityId.slice(0, 12)}</Text> },
  ];
  return (
    <Stack>
      <Title order={2}>Audit log</Title>
      <Group align="flex-end">
        <Select placeholder="Any entity" clearable w={150} data={['copy', 'title', 'sale', 'stall', 'user', 'import', 'shelf_row', 'genre', 'settings']} value={params.get('type') || null} onChange={(v) => params.set({ type: v })} />
        <TextInput placeholder="Entity id" w={200} value={params.get('id')} onChange={(e) => params.set({ id: e.currentTarget.value })} />
        <TextInput placeholder="Action, e.g. sale.void" w={190} value={params.get('action')} onChange={(e) => params.set({ action: e.currentTarget.value })} />
        <TextInput type="date" label="From" value={params.get('from')} onChange={(e) => params.set({ from: e.currentTarget.value })} />
        <TextInput type="date" label="To" value={params.get('to')} onChange={(e) => params.set({ to: e.currentTarget.value })} />
      </Group>
      {q.isError ? <ErrorState error={q.error} /> : <DataTable columns={columns} rows={q.data?.items} rowKey={(e) => e.id} loading={q.isLoading} total={q.data?.total} page={params.page} pageSize={params.pageSize} onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })} onRowClick={setOpen} />}
      <Modal opened={Boolean(open)} onClose={() => setOpen(null)} title={open?.action} size="xl" centered>
        {open && <Stack><Text size="sm" c="dimmed">{fmt.dateTime(open.createdAt)} · {name(open.actorId)} · {open.entityType} {open.entityId}</Text><Group align="flex-start" wrap="nowrap"><Json title="Before" value={open.before} /><Json title="After" value={open.after} /></Group></Stack>}
      </Modal>
    </Stack>
  );
}
