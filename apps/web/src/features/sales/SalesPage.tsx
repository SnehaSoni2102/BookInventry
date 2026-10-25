import { errorMessage, qk, useSales, useSalesSummary, useStalls, useVoidSale } from '@bookstall/api-client';
import type { SaleDto, SaleListItem, VoidSaleResponse } from '@bookstall/shared';
import { Alert, Badge, Button, Checkbox, Drawer, Group, Modal, Select, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { DataTable, type Column } from '../../components/DataTable';
import { LiveStallTotals } from '../../components/LiveStallTotals';
import { LocationCode } from '../../components/LocationCode';
import { EmptyState, ErrorState } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useFormat } from '../../lib/format';
import { openPdf, printBlob, saveBlob } from '../../lib/print';
import { useDebouncedValue } from '@mantine/hooks';

const today = () => new Date().toLocaleDateString('en-CA');

export default function SalesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const admin = can('sale.read.all');
  const params = useListParams({ range: 'today' });
  const stalls = useStalls();
  const users = useQuery({ queryKey: [...qk.users.all(), 'sellers'], queryFn: () => api.users.list({ pageSize: 100 }), enabled: can('user.manage') });
  const [open, setOpen] = useState<string | null>(null);

  const [text, setText] = useState(params.get('q'));
  const [debounced] = useDebouncedValue(text, 300);
  useEffect(() => { if (debounced !== params.get('q')) params.set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = params.get('range');
  const from = range === 'today' ? today() : params.get('from') || undefined;
  const to = range === 'today' ? today() : params.get('to') || undefined;
  const stall = params.get('stall');
  const filters = {
    stallId: stall && stall !== 'central' ? stall : undefined,
    central: stall === 'central' ? true : undefined,
    sellerId: params.get('seller') || undefined,
    paymentMethod: (params.get('pay') || undefined) as never,
    status: (params.get('status') || undefined) as never,
    q: params.get('q') || undefined,
    from, to,
  };
  const list = useSales({ ...filters, page: params.page, pageSize: params.pageSize });
  const summary = useSalesSummary({ groupBy: 'stall', from, to });

  const columns: Column<SaleListItem>[] = [
    { key: 'r', header: 'Receipt', cell: (s) => <Text fw={600} size="sm">{s.receiptNo}</Text> },
    { key: 't', header: 'Time', hideBelow: 'sm', cell: (s) => fmt.dateTime(s.soldAt) },
    { key: 'at', header: 'Sold at', cell: (s) => s.soldAtLabel },
    ...(admin ? [{ key: 'seller', header: 'Seller', hideBelow: 'md' as const, cell: (s: SaleListItem) => s.seller.displayName }] : []),
    { key: 'n', header: 'Books', align: 'right' as const, cell: (s) => s.itemsCount },
    { key: 'a', header: 'Total', align: 'right' as const, cell: (s) => <Text fw={600} size="sm" td={s.status === 'VOIDED' ? 'line-through' : undefined}>{fmt.money(s.totalMinor)}</Text> },
    { key: 'p', header: 'Payment', hideBelow: 'sm', cell: (s) => t(`payment.${s.paymentMethod}`) },
    { key: 's', header: 'Status', hideBelow: 'sm', cell: (s) => <Badge color={s.status === 'VOIDED' ? 'red' : 'green'} variant="light">{s.status.toLowerCase()}</Badge> },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{admin ? 'Sales' : 'My sales'}</Title>
        <Group>
          <SegmentedControl value={range} onChange={(v) => params.set({ range: v })} data={[{ value: 'today', label: 'Today' }, { value: 'custom', label: 'Custom' }]} />
          {admin && <Button variant="default" onClick={async () => saveBlob(await api.sales.exportXlsx({ ...filters, pageSize: 100 } as never), 'sales.xlsx')}>Export Excel</Button>}
        </Group>
      </Group>

      <LiveStallTotals rows={admin ? summary.data?.rows : undefined} total={summary.data?.total} loading={summary.isLoading} />
      {!admin && summary.data && <Text size="sm" c="dimmed">Your sales in this period: {summary.data.total.salesCount} · {fmt.money(summary.data.total.revenueMinor)}</Text>}

      <Group align="flex-end" wrap="wrap">
        <TextInput placeholder="Receipt, book code or title" leftSection={<IconSearch size={16} />} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Search sales" />
        {range === 'custom' && (
          <>
            <TextInput type="date" label="From" value={params.get('from')} onChange={(e) => params.set({ from: e.currentTarget.value })} />
            <TextInput type="date" label="To" value={params.get('to')} onChange={(e) => params.set({ to: e.currentTarget.value })} />
          </>
        )}
        {admin && <Select placeholder="All stalls" clearable w={200} data={[{ value: 'central', label: 'Admin (central)' }, ...(stalls.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} value={stall || null} onChange={(v) => params.set({ stall: v })} />}
        {admin && users.data && <Select placeholder="Any seller" clearable searchable w={180} data={users.data.items.map((u) => ({ value: u.id, label: u.displayName }))} value={params.get('seller') || null} onChange={(v) => params.set({ seller: v })} />}
        <Select placeholder="Any payment" clearable w={140} data={['CASH', 'UPI', 'CARD', 'OTHER']} value={params.get('pay') || null} onChange={(v) => params.set({ pay: v })} />
        <Select placeholder="Any status" clearable w={130} data={[{ value: 'COMPLETED', label: 'Completed' }, { value: 'VOIDED', label: 'Voided' }]} value={params.get('status') || null} onChange={(v) => params.set({ status: v })} />
      </Group>

      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <DataTable columns={columns} rows={list.data?.items} rowKey={(s) => s.id} loading={list.isLoading} total={list.data?.total} page={params.page} pageSize={params.pageSize}
          onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })} onRowClick={(s) => setOpen(s.id)} empty={<EmptyState title="No sales in this period" />} />
      )}
      <SaleDrawer id={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}

function SaleDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const fmt = useFormat();
  const q = useQuery({ queryKey: qk.sales.one(id ?? ''), queryFn: () => api.sales.get(id!), enabled: Boolean(id) });
  const [voiding, setVoiding] = useState<SaleDto | null>(null);
  const s = q.data;
  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="md" title={s ? `${s.receiptNo} · ${s.soldAtLabel}` : 'Sale'}>
      {q.isError ? <ErrorState error={q.error} /> : !s ? null : (
        <Stack>
          <Group justify="space-between"><Text c="dimmed" size="sm">{fmt.dateTime(s.soldAt)} · {s.seller.displayName}</Text><Badge color={s.status === 'VOIDED' ? 'red' : 'green'} variant="light">{s.status.toLowerCase()}</Badge></Group>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {s.items.map((i) => (
                <Table.Tr key={i.copyId}><Table.Td><Text size="sm" fw={600}>{i.title}</Text><Text size="xs" c="dimmed">{i.code} · {i.condition.toLowerCase().replace('_', ' ')}</Text></Table.Td><Table.Td ta="right">{i.soldPriceMinor !== i.listPriceMinor && <Text size="xs" c="dimmed" td="line-through">{fmt.money(i.listPriceMinor)}</Text>}<Text fw={600}>{fmt.money(i.soldPriceMinor)}</Text></Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="space-between"><Text fw={700}>Total</Text><Text fw={800} size="lg">{fmt.money(s.totalMinor)}</Text></Group>
          <Text size="sm">Paid by {s.paymentMethod.toLowerCase()}{s.customerName ? ` · ${s.customerName}` : ''}</Text>
          {s.status === 'VOIDED' && <Alert color="red" title="Voided">{s.voidReason} {s.voidedBy ? `(${s.voidedBy})` : ''}</Alert>}
          <Group>
            <Button variant="default" onClick={() => void openPdf(() => api.sales.receipt(s.id))}>Receipt (PDF)</Button>
            <Button variant="default" onClick={async () => printBlob(await api.sales.receipt(s.id, 'a6'))}>Print A6</Button>
            {can('sale.void') && s.status === 'COMPLETED' && <Button color="red" variant="light" onClick={() => setVoiding(s)} data-testid="void-sale">Void sale</Button>}
          </Group>
        </Stack>
      )}
      {voiding && <VoidModal sale={voiding} onClose={() => setVoiding(null)} />}
    </Drawer>
  );
}

function VoidModal({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const void_ = useVoidSale(sale.id);
  const [reason, setReason] = useState('');
  const [toStall, setToStall] = useState(false);
  const [res, setRes] = useState<VoidSaleResponse | null>(null);
  const run = async () => {
    try { setRes(await void_.mutateAsync({ reason: reason.trim(), returnToStall: toStall })); } catch (e) { notifications.show({ color: 'red', title: 'Could not void', message: errorMessage(e) }); }
  };
  return (
    <Modal opened onClose={onClose} title={`Void ${sale.receiptNo}`} centered>
      {!res ? (
        <Stack>
          <Text size="sm">The books go back on sale. This is recorded in the audit log.</Text>
          <TextInput label="Reason (required)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid="void-reason" />
          {sale.stallId && <Checkbox checked={toStall} onChange={(e) => setToStall(e.currentTarget.checked)} label="Put the books back at the stall (it must still be active)" />}
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button color="red" disabled={reason.trim().length < 3} loading={void_.isPending} onClick={run} data-testid="confirm-void">Void sale</Button></Group>
        </Stack>
      ) : (
        <Stack>
          <Alert color="green" title="Sale voided" />
          <Text size="sm" fw={600}>Return the books to:</Text>
          <Table><Table.Tbody>{res.restored.map((r) => <Table.Tr key={r.code}><Table.Td>{r.code}</Table.Td><Table.Td>{r.title}</Table.Td><Table.Td><LocationCode code={r.locationCode} />{r.relocated && <Badge ml={6} color="orange" size="xs">new place</Badge>}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
          <Group justify="flex-end">
            {res.labelPdfUrl && <Button variant="light" onClick={async () => printBlob(await api.labels.pdf(new URL(res.labelPdfUrl!, location.origin).searchParams.get('copyIds')!.split(',')))}>Print new labels</Button>}
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
