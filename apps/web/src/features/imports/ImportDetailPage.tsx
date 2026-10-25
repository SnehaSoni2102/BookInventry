import { errorMessage, qk } from '@bookstall/api-client';
import { IMPORT_COLUMNS, type ImportRowDto, type ImportRowStatus } from '@bookstall/shared';
import { Alert, Badge, Button, Checkbox, Group, Modal, Progress, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../app/api';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useFormat } from '../../lib/format';
import { printBlob, saveBlob } from '../../lib/print';
import { IMPORT_COLOR } from './ImportsPage';

const ROW_COLOR: Record<ImportRowStatus, string> = { VALID: 'green', WARNING: 'yellow', ERROR: 'red', COMMITTED: 'blue', SKIPPED: 'gray' };

export default function ImportDetailPage() {
  const { id = '' } = useParams();
  const fmt = useFormat();
  const qc = useQueryClient();
  const params = useListParams({ filter: 'ALL' });
  const [skipErrors, setSkipErrors] = useState(false);
  const [editing, setEditing] = useState<ImportRowDto | null>(null);
  const job = useQuery({
    queryKey: qk.imports.one(id), queryFn: () => api.imports.get(id),
    // the realtime socket pushes updates; polling is the fallback while work is running
    refetchInterval: (q) => (q.state.data?.status === 'VALIDATING' || q.state.data?.status === 'COMMITTING' || q.state.data?.status === 'UPLOADED' ? 2000 : false),
  });
  const filter = params.get('filter');
  const rows = useQuery({
    queryKey: qk.imports.rows(id, { filter, page: params.page, size: params.pageSize, status: job.data?.status }),
    queryFn: () => api.imports.rows(id, { page: params.page, pageSize: params.pageSize, ...(filter !== 'ALL' ? { status: filter as ImportRowStatus } : {}) }),
    enabled: Boolean(job.data) && !['UPLOADED', 'VALIDATING', 'FAILED'].includes(job.data!.status),
  });
  if (job.isLoading) return <PageSkeleton />;
  if (job.isError) return <ErrorState error={job.error} />;
  const j = job.data!;
  const working = j.status === 'VALIDATING' || j.status === 'UPLOADED' || j.status === 'COMMITTING';
  const refresh = () => qc.invalidateQueries({ queryKey: qk.imports.all() });

  const commit = async () => {
    try { await api.imports.commit(id, { skipErrors }); await refresh(); } catch (e) { notifications.show({ color: 'red', title: 'Cannot commit', message: errorMessage(e) }); }
  };
  const skip = async (r: ImportRowDto) => { try { await api.imports.skipRow(id, r.id); await refresh(); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); } };

  const columns: Column<ImportRowDto>[] = [
    { key: 'n', header: '#', width: 56, cell: (r) => r.rowNumber },
    { key: 's', header: 'Status', cell: (r) => <Badge color={ROW_COLOR[r.status]} variant="light">{r.status.toLowerCase()}</Badge> },
    { key: 'b', header: 'Book', cell: (r) => <div><Text size="sm" fw={600} lineClamp={1}>{r.preview?.title ?? r.raw.title ?? r.raw.isbn ?? '—'}</Text>{r.preview && <Text size="xs" c="dimmed">{r.preview.authors.join(', ')}{r.preview.existingTitle ? ' · already in inventory' : r.preview.lookup !== 'NONE' ? ` · from ${r.preview.lookup.toLowerCase().replace('_', ' ')}` : ''}</Text>}</div> },
    { key: 'c', header: 'Cond.', hideBelow: 'sm', cell: (r) => r.preview?.condition.replace('_', ' ').toLowerCase() ?? r.raw.condition ?? '' },
    { key: 'p', header: 'Price', align: 'right', hideBelow: 'sm', cell: (r) => (r.preview ? fmt.money(r.preview.sellingPriceMinor) : r.raw.selling_price ?? '') },
    { key: 'q', header: 'Qty', align: 'right', cell: (r) => r.preview?.quantity ?? r.raw.quantity ?? 1 },
    { key: 'm', header: 'Messages', cell: (r) => <Stack gap={0}>{r.messages.map((m, i) => <Text key={i} size="xs" c={m.level === 'error' ? 'red' : 'orange'}>{m.field}: {m.message}</Text>)}</Stack> },
    { key: 'a', header: '', width: 120, cell: (r) => j.status === 'READY' && r.status !== 'COMMITTED' ? <Group gap={4} wrap="nowrap"><Button size="compact-xs" variant="light" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>Edit</Button>{r.status !== 'SKIPPED' && <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); void skip(r); }}>Skip</Button>}</Group> : null },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <div><Title order={2}>{j.originalName}</Title><Group gap="xs"><Badge color={IMPORT_COLOR[j.status]} variant="light">{j.status.toLowerCase()}</Badge><Text size="sm" c="dimmed">uploaded {fmt.dateTime(j.createdAt)}</Text></Group></div>
        <Button component={Link} to="/imports" variant="subtle">All imports</Button>
      </Group>

      {j.status === 'FAILED' && <Alert color="red" title="This file could not be imported" data-testid="import-failed">{j.errorMessage}</Alert>}
      {working && (
        <Stack gap={4}><Text size="sm">{j.status === 'COMMITTING' ? `Adding books… ${j.processedRows} of ${j.totalRows}` : 'Checking the file and looking up books online…'}</Text><Progress value={j.status === 'COMMITTING' && j.totalRows ? (j.processedRows / j.totalRows) * 100 : 100} animated={j.status !== 'COMMITTING' || !j.totalRows} /></Stack>
      )}

      {!working && j.status !== 'FAILED' && (
        <SimpleGrid cols={{ base: 2, sm: 5 }}>
          {[['Rows', j.totalRows, undefined], ['Ready', j.validRows, 'green'], ['Warnings', j.warningRows, 'orange'], ['Errors', j.errorRows, j.errorRows ? 'red' : undefined], ['Copies created', j.copiesCreated, 'blue']].map(([l, v, c]) => (
            <div key={String(l)}><Text size="xs" c="dimmed" tt="uppercase" fw={600}>{l}</Text><Text size="xl" fw={800} c={c as string | undefined} data-testid={`count-${l}`}>{v}</Text></div>
          ))}
        </SimpleGrid>
      )}

      {j.status === 'READY' && (
        <Group>
          <Button onClick={commit} disabled={j.errorRows > 0 && !skipErrors} data-testid="commit-import">Add {j.validRows + j.warningRows} rows to the inventory</Button>
          {j.errorRows > 0 && <Checkbox label={`Skip the ${j.errorRows} row(s) with errors`} checked={skipErrors} onChange={(e) => setSkipErrors(e.currentTarget.checked)} />}
        </Group>
      )}
      {j.status === 'COMPLETED' && (
        <Group>
          <Alert color="green" title={`${j.copiesCreated} copies added`} flex={1} />
          <Button onClick={async () => printBlob(await api.labels.importPdf(id, 'A4_24'))}>Print all labels (A4)</Button>
          <Button variant="default" onClick={async () => printBlob(await api.labels.importPdf(id, 'THERMAL_50x25'))}>Print all labels (thermal)</Button>
          <Button variant="default" onClick={async () => saveBlob(await api.imports.result(id), 'import-result.xlsx')}>Download result file</Button>
        </Group>
      )}

      {!working && j.status !== 'FAILED' && (
        <>
          <SegmentedControl size="xs" value={filter} onChange={(v) => params.set({ filter: v })} data={['ALL', 'VALID', 'WARNING', 'ERROR', 'COMMITTED', 'SKIPPED'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
          <DataTable columns={columns} rows={rows.data?.items} rowKey={(r) => r.id} loading={rows.isLoading} total={rows.data?.total} page={params.page} pageSize={params.pageSize} onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })} empty={<EmptyState title="No rows in this view" />} />
        </>
      )}
      {editing && <EditRowModal jobId={id} row={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Stack>
  );
}

function EditRowModal({ jobId, row, onClose, onSaved }: { jobId: string; row: ImportRowDto; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, row.raw[c] ?? ''])));
  const [result, setResult] = useState<ImportRowDto | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const changed = Object.fromEntries(IMPORT_COLUMNS.filter((c) => (row.raw[c] ?? '') !== v[c]).map((c) => [c, v[c] || null]));
      if (!Object.keys(changed).length) return onClose();
      const r = await api.imports.patchRow(jobId, row.id, { fields: changed });
      setResult(r);
      onSaved();
      if (r.status !== 'ERROR') onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={`Row ${row.rowNumber}`} size="lg" centered>
      <Stack gap="xs">
        {(result ?? row).messages.map((m, i) => <Text key={i} size="sm" c={m.level === 'error' ? 'red' : 'orange'}>{m.field}: {m.message}</Text>)}
        <SimpleGrid cols={2}>{IMPORT_COLUMNS.map((c) => <TextInput key={c} label={c} size="xs" value={v[c]} onChange={(e) => setV({ ...v, [c]: e.currentTarget.value })} />)}</SimpleGrid>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save &amp; re-check</Button></Group>
      </Stack>
    </Modal>
  );
}
