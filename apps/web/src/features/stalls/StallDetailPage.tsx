import { ApiError, errorMessage, qk } from '@bookstall/api-client';
import type { Reconciliation, StallDto, TitleListItem } from '@bookstall/shared';
import { Alert, Badge, Button, Card, Group, Modal, Radio, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { BookCover } from '../../components/BookCover';
import { CheckoutDialog, type CheckoutMode as CheckoutDialogMode } from '../../components/CheckoutDialog';
import { confirmAction } from '../../components/confirm';
import { DataTable } from '../../components/DataTable';
import { LocationCode } from '../../components/LocationCode';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/states';
import { useFormat } from '../../lib/format';
import { openPdf, saveBlob } from '../../lib/print';
import { CheckinMode, CheckoutMode } from '../scan/ScanStationPage';
import { CredentialsDialog } from './StallsPage';

const STATUS_COLOR = { PLANNED: 'yellow', ACTIVE: 'green', CLOSED: 'gray' } as const;

export default function StallDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = useQuery({ queryKey: qk.stalls.one(id), queryFn: () => api.stalls.get(id) });
  const recon = useQuery({ queryKey: qk.stalls.recon(id), queryFn: () => api.stalls.reconciliation(id), enabled: can('stall.manage') });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const tab = sp.get('tab') ?? 'overview';
  const closed = s.status === 'CLOSED';

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group><Title order={2}>{s.name}</Title><Badge color={STATUS_COLOR[s.status]} variant="light">{s.status.toLowerCase()}</Badge></Group>
          <Text c="dimmed" size="sm">{[s.location, s.startsOn && `from ${s.startsOn}`, s.endsOn && `to ${s.endsOn}`].filter(Boolean).join(' · ')}</Text>
        </div>
        <Button component={Link} to="/stalls" variant="subtle">All stalls</Button>
      </Group>

      <Tabs value={tab} onChange={(v) => setSp({ tab: v ?? 'overview' }, { replace: true })} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="inventory">At stall ({s.counts.atStall})</Tabs.Tab>
          {can('stall.checkout') && !closed && <Tabs.Tab value="checkout">Check out</Tabs.Tab>}
          {can('stall.checkin') && <Tabs.Tab value="checkin">Check in</Tabs.Tab>}
          {can('sale.read.all') && <Tabs.Tab value="sales">Sales</Tabs.Tab>}
          {can('stall.manage') && <Tabs.Tab value="close">{closed ? 'Report' : 'Reconcile & close'}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md"><Overview stall={s} recon={recon.data} /></Tabs.Panel>
        <Tabs.Panel value="inventory" pt="md"><StallInventory stallId={id} /></Tabs.Panel>
        <Tabs.Panel value="checkout" pt="md"><CheckoutTab stall={s} /></Tabs.Panel>
        <Tabs.Panel value="checkin" pt="md"><CheckinMode /></Tabs.Panel>
        <Tabs.Panel value="sales" pt="md"><StallSales stallId={id} /></Tabs.Panel>
        <Tabs.Panel value="close" pt="md"><CloseTab stall={s} recon={recon.data} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <Card withBorder padding="sm"><Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text><Text size="xl" fw={800}>{value}</Text></Card>;
}

function Overview({ stall, recon }: { stall: StallDto; recon?: Reconciliation }) {
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const managers = useQuery({ queryKey: [...qk.users.all(), 'mgrs'], queryFn: () => api.users.list({ role: 'STALL_MANAGER', active: true, pageSize: 100 }), enabled: can('stall.manage') });
  const [pick, setPick] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ username: string; password: string; userId: string; slipToken?: string } | null>(null);
  const manage = can('stall.manage');
  const refresh = () => qc.invalidateQueries({ queryKey: qk.stalls.all() });

  const assign = async (userId: string, move = false) => {
    try {
      await api.stalls.assign(stall.id, { userId, moveFromOtherStall: move });
      setPick(null);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT' && (e.details as { stallName?: string } | undefined)?.stallName) {
        confirmAction({ title: 'Move this manager?', message: `${e.message}. Move them to ${stall.name}?`, confirmLabel: 'Move', color: 'blue', onConfirm: () => assign(userId, true) });
      } else notifications.show({ color: 'red', message: errorMessage(e) });
    }
  };

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Stat label="Books out" value={stall.counts.atStall} />
        <Stat label="Sold" value={stall.counts.sold} />
        <Stat label="Revenue" value={fmt.money(stall.counts.revenueMinor)} />
        {recon && <Stat label="Returned" value={recon.returned} />}
        {recon && <Stat label="Sent in total" value={recon.sent} />}
      </SimpleGrid>
      {recon && (
        <Group gap="xs">{(['CASH', 'UPI', 'CARD', 'OTHER'] as const).map((m) => <Badge key={m} size="lg" variant="light" color={recon.byPaymentMethod[m] ? 'blue' : 'gray'}>{m} {fmt.money(recon.byPaymentMethod[m])}</Badge>)}</Group>
      )}
      <Title order={4}>Managers</Title>
      {stall.managers.length === 0 && <Text c="dimmed" size="sm">Nobody is assigned yet.</Text>}
      {stall.managers.map((m) => (
        <Group key={m.id} justify="space-between">
          <Text>{m.displayName} <Text span c="dimmed" size="sm">({m.username})</Text></Text>
          {manage && (
            <Group gap="xs">
              <Button size="compact-sm" variant="default" onClick={() => confirmAction({ title: `Reset ${m.displayName}'s password?`, message: 'They are signed out and must choose a new password. The new temporary password is shown once.', confirmLabel: 'Reset', color: 'blue', onConfirm: async () => { try { const r = await api.users.resetPassword(m.id); setCreds({ username: m.username, password: r.temporaryPassword, userId: m.id, slipToken: r.slipToken }); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); } } })}>Reset password</Button>
              <Button size="compact-sm" variant="subtle" color="red" onClick={() => confirmAction({ title: 'Remove manager?', message: `${m.displayName} will no longer be able to sell at ${stall.name}.`, confirmLabel: 'Remove', onConfirm: async () => { await api.stalls.unassign(stall.id, m.id).catch((e) => notifications.show({ color: 'red', message: errorMessage(e) })); await refresh(); } })}>Remove</Button>
            </Group>
          )}
        </Group>
      ))}
      {manage && stall.status !== 'CLOSED' && (
        <Group align="flex-end">
          <Select w={320} label="Add a manager" placeholder="Choose" searchable data={(managers.data?.items ?? []).filter((u) => !stall.managers.some((m) => m.id === u.id)).map((u) => ({ value: u.id, label: `${u.displayName} (${u.username})${u.activeStall ? ` — on ${u.activeStall.name}` : ''}` }))} value={pick} onChange={setPick} />
          <Button onClick={() => pick && void assign(pick)} disabled={!pick}>Assign</Button>
        </Group>
      )}
      {manage && stall.status === 'PLANNED' && <Button w="fit-content" onClick={async () => { await api.stalls.activate(stall.id); await refresh(); }}>Activate stall</Button>}
      <CredentialsDialog info={creds} onClose={() => setCreds(null)} />
    </Stack>
  );
}

function StallInventory({ stallId }: { stallId: string }) {
  const fmt = useFormat();
  const q = useQuery({ queryKey: qk.stalls.inventory(stallId), queryFn: () => api.stalls.inventory(stallId, { pageSize: 100 }) });
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (!q.data?.items.length) return <EmptyState title="No books at this stall right now" />;
  return (
    <Stack gap="xs">
      {q.data.items.map((t: TitleListItem) => (
        <Card key={t.id} withBorder padding="xs" component={Link} to={`/inventory/titles/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Group wrap="nowrap"><BookCover url={t.coverThumbUrl} title={t.title} color={t.genre.color} width={36} /><Text flex={1} fw={600} size="sm" lineClamp={1}>{t.title}</Text><Badge variant="light">{t.availableCount}</Badge><Text size="sm" fw={600}>{fmt.money(t.minPriceMinor)}</Text></Group>
        </Card>
      ))}
    </Stack>
  );
}

function CheckoutTab({ stall }: { stall: StallDto }) {
  const qc = useQueryClient();
  const fmt = useFormat();
  const [byQty, setByQty] = useState(false);
  const moves = useQuery({ queryKey: qk.stalls.movements(stall.id, { all: true }), queryFn: () => api.stalls.movements(stall.id, { pageSize: 100 }), enabled: true });
  const batches = (() => {
    const m = new Map<string, { at: string; by: string; n: number }>();
    for (const x of moves.data?.items ?? []) { const b = m.get(x.batchId); if (b) b.n++; else m.set(x.batchId, { at: x.checkedOutAt, by: x.checkedOutBy, n: 1 }); }
    return [...m];
  })();
  return (
    <Stack>
      <Group justify="space-between"><Text fw={600}>Scan the books to send to {stall.name}</Text><Button variant="light" onClick={() => setByQty(true)}>Add by quantity</Button></Group>
      <CheckoutMode fixedStallId={stall.id} />
      <Title order={5}>Earlier batches</Title>
      {batches.length === 0 ? <Text c="dimmed" size="sm">Nothing sent yet.</Text> : (
        <Table><Table.Tbody>{batches.map(([id, b]) => (
          <Table.Tr key={id}><Table.Td>{fmt.dateTime(b.at)}</Table.Td><Table.Td>{b.n} books</Table.Td><Table.Td c="dimmed">{b.by}</Table.Td><Table.Td><Button size="compact-xs" variant="subtle" onClick={() => void openPdf(() => api.stalls.pickList(stall.id, id))}>Pick list</Button></Table.Td></Table.Tr>
        ))}</Table.Tbody></Table>
      )}
      {byQty && <QuantityCheckout stall={stall} onClose={() => { setByQty(false); void qc.invalidateQueries({ queryKey: qk.stalls.all() }); }} />}
    </Stack>
  );
}

/** "Send 10 copies of X (Good, ₹100)": search a title, pick a condition/price group, enter how many. */
function QuantityCheckout({ stall, onClose }: { stall: StallDto; onClose: () => void }) {
  const [text, setText] = useState('');
  const [titleId, setTitleId] = useState<string | null>(null);
  // A snapshot of the chosen group: the live list shrinks as soon as the books leave stock, and the
  // checkout result must stay on screen after that.
  const [picked, setPicked] = useState<Extract<CheckoutDialogMode, { kind: 'group' }> | null>(null);
  const results = useQuery({ queryKey: ['titles', 'qty-search', text], queryFn: () => api.titles.list({ q: text, pageSize: 8 }), enabled: text.length >= 2 });
  const title = useQuery({ queryKey: qk.titles.one(titleId ?? ''), queryFn: () => api.titles.get(titleId!), enabled: Boolean(titleId) && !picked });
  const fmt = useFormat();
  const groups = (title.data?.copyGroups ?? []).filter((g) => g.status === 'IN_STOCK');
  if (picked) return <CheckoutDialog opened onClose={onClose} stallId={stall.id} mode={picked} />;
  return (
    <Modal opened onClose={onClose} title="Send copies by quantity" centered size="lg">
      <Stack>
        <TextInput label="Find the book" placeholder="Title, author or ISBN" value={text} onChange={(e) => { setText(e.currentTarget.value); setTitleId(null); }} autoFocus />
        {!titleId && results.data?.items.map((t) => <Card key={t.id} withBorder padding="xs" style={{ cursor: 'pointer' }} onClick={() => setTitleId(t.id)}><Text size="sm" fw={600}>{t.title}</Text><Text size="xs" c="dimmed">{t.authors.join(', ')} · {t.availableCount} available</Text></Card>)}
        {titleId && title.data && (
          <Radio.Group label={`Which copies of “${title.data.title}”?`} value={null} onChange={(key) => {
            const g = groups.find((x) => `${x.condition}|${x.sellingPriceMinor}` === key);
            if (g) setPicked({ kind: 'group', titleId: title.data!.id, title: title.data!.title, condition: g.condition, sellingPriceMinor: g.sellingPriceMinor, max: g.quantity });
          }}>
            <Stack mt={6} gap={6}>{groups.map((x) => <Radio key={`${x.condition}|${x.sellingPriceMinor}`} value={`${x.condition}|${x.sellingPriceMinor}`} label={`${x.quantity} × ${x.condition.replace('_', ' ').toLowerCase()} at ${fmt.money(x.sellingPriceMinor)}`} />)}{groups.length === 0 && <Text c="dimmed" size="sm">No copies in stock.</Text>}</Stack>
          </Radio.Group>
        )}
      </Stack>
    </Modal>
  );
}

function StallSales({ stallId }: { stallId: string }) {
  const fmt = useFormat();
  const q = useQuery({ queryKey: qk.sales.list({ stallId }), queryFn: () => api.sales.list({ stallId, pageSize: 50 }) });
  return (
    <DataTable
      columns={[
        { key: 'r', header: 'Receipt', cell: (s) => <Text fw={600} size="sm">{s.receiptNo}</Text> },
        { key: 't', header: 'When', cell: (s) => fmt.dateTime(s.soldAt) },
        { key: 's', header: 'Seller', cell: (s) => s.seller.displayName, hideBelow: 'sm' },
        { key: 'i', header: 'Books', align: 'right', cell: (s) => s.itemsCount },
        { key: 'a', header: 'Total', align: 'right', cell: (s) => <Text fw={600} size="sm" td={s.status === 'VOIDED' ? 'line-through' : undefined}>{fmt.money(s.totalMinor)}</Text> },
        { key: 'p', header: 'Payment', cell: (s) => s.paymentMethod, hideBelow: 'sm' },
      ]}
      rows={q.data?.items} rowKey={(s) => s.id} loading={q.isLoading} empty={<EmptyState title="No sales yet" />}
    />
  );
}

function CloseTab({ stall, recon }: { stall: StallDto; recon?: Reconciliation }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'LOST' | 'KEEP_OPEN'>('LOST');
  const [busy, setBusy] = useState(false);
  if (!recon) return <PageSkeleton rows={3} />;
  const closed = stall.status === 'CLOSED';
  const missing = recon.stillOut.length;

  const close = () =>
    confirmAction({
      title: `Close ${stall.name}?`,
      message: mode === 'LOST'
        ? `${missing} book${missing === 1 ? '' : 's'} not returned will be written off as lost. Managers are signed out and (per settings) deactivated.`
        : `The ${missing} book${missing === 1 ? '' : 's'} not returned stay marked as out so you can still check them in later.`,
      confirmLabel: 'Close stall', color: mode === 'LOST' && missing ? 'red' : 'blue',
      onConfirm: async () => {
        setBusy(true);
        try { await api.stalls.close(stall.id, { markRemainingAs: mode }); await qc.invalidateQueries(); notifications.show({ color: 'green', message: 'Stall closed' }); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); } finally { setBusy(false); }
      },
    });

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Stat label="Sent" value={recon.sent} /><Stat label="Sold" value={recon.sold} /><Stat label="Returned" value={recon.returned} />
        <Stat label="Missing" value={missing + recon.lost} /><Stat label="Revenue" value={fmt.money(recon.revenueMinor)} />
      </SimpleGrid>
      {!closed && (
        <>
          <Title order={4}>Still out ({missing})</Title>
          {missing === 0 ? <Alert color="green">Every book is accounted for.</Alert> : (
            <>
              <Text size="sm" c="dimmed">Scan returned books on the “Check in” tab; they disappear from this list. Anything left is missing.</Text>
              <Table verticalSpacing={4}><Table.Tbody>{recon.stillOut.map((b) => <Table.Tr key={b.copyId}><Table.Td><LocationCode code={b.locationCode} /></Table.Td><Table.Td>{b.code}</Table.Td><Table.Td>{b.title}</Table.Td><Table.Td ta="right">{fmt.money(b.sellingPriceMinor)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
            </>
          )}
          <Radio.Group label="When closing, books not returned are…" value={mode} onChange={(v) => setMode(v as typeof mode)}>
            <Stack mt={6} gap={6}><Radio value="LOST" label="Marked as lost (written off, shelf slots freed)" /><Radio value="KEEP_OPEN" label="Left marked as out (check them in later)" /></Stack>
          </Radio.Group>
          <Button color="red" w="fit-content" onClick={close} loading={busy} data-testid="close-stall">Close stall</Button>
        </>
      )}
      {closed && <Alert color="gray">This stall was closed {stall.closedAt ? fmt.dateTime(stall.closedAt) : ''}. {recon.lost} lost · {missing} still marked out.</Alert>}
      <Group>
        <Button variant="default" onClick={() => void openPdf(() => api.stalls.reportPdf(stall.id))}>Report (PDF)</Button>
        <Button variant="default" onClick={async () => saveBlob(await api.stalls.reportXlsx(stall.id), `${stall.name}-report.xlsx`)}>Report (Excel)</Button>
        {closed && <Button variant="subtle" onClick={() => navigate('/stalls')}>Back to stalls</Button>}
      </Group>
    </Stack>
  );
}
