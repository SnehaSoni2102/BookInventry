import { handleScan, ScanDeduper, errorMessage, useCheckout, useStalls, type ScanMode, type ScanOutcome } from '@bookstall/api-client';
import type { CheckinItem, CheckoutResponse, CopyAction, CopyDetail, CopyGroup } from '@bookstall/shared';
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, Paper, SegmentedControl, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconCamera, IconTrash } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { LocationCode } from '../../components/LocationCode';
import { SaleForm } from '../../components/SaleForm';
import { EmptyState } from '../../components/states';
import { feedback } from '../../lib/audio';
import { useCart } from '../../lib/cart';
import { useFormat } from '../../lib/format';
import { openPdf } from '../../lib/print';
import { useDefaultScanHandling, useScanHandler, useScanner } from '../../lib/scanner';
import { CopyActions } from '../copies/CopyActions';

type Mode = 'lookup' | 'sell' | 'checkout' | 'checkin' | 'labels';
const has = (actions: CopyAction[], a: CopyAction['action']) => actions.some((x) => x.action === a);

interface Row { copyId: string; code: string; title: string; locationCode: string | null }
const toRow = (c: CopyDetail): Row => ({ copyId: c.id, code: c.code, title: c.title.title, locationCode: c.locationCode });

/** Shared plumbing: dedupe repeated reads, run handleScan in the mode's context, give sound feedback. */
function useModeScanner(mode: Mode, on: (o: ScanOutcome, raw: string) => 'ok' | 'bad' | void, extra?: { enabled?: boolean }) {
  const deduper = useRef(new ScanDeduper(2000));
  const generic = useDefaultScanHandling();
  const [pickFrom, setPickFrom] = useState<{ isbn13: string; groups: CopyGroup[] } | null>(null);
  useScanHandler(async (raw) => {
    if (!deduper.current.accept(raw)) return;
    const out = await handleScan(api, raw, { mode: mode as ScanMode });
    if (out.type === 'choose-copy') return void setPickFrom({ isbn13: out.isbn13, groups: out.copyGroups });
    if (out.type === 'add-book') {
      feedback.error();
      return void generic({ type: 'error', message: 'That is a book barcode. Scan the sticker QR on the copy instead.' });
    }
    const verdict = on(out, raw);
    if (verdict === 'ok') feedback.success();
    else if (verdict === 'bad' || out.type === 'unknown' || out.type === 'not-found' || out.type === 'blocked' || out.type === 'error') {
      feedback.error();
      if (!verdict) generic(out);
    }
  }, extra?.enabled ?? true);
  return { pickFrom, closePick: () => setPickFrom(null), reScan: (code: string) => deduper.current && handleScan(api, code, { mode: mode as ScanMode }) };
}

function CopyPicker({ pick, onPick, onClose }: { pick: { isbn13: string; groups: CopyGroup[] } | null; onPick: (code: string) => void; onClose: () => void }) {
  const fmt = useFormat();
  return (
    <Modal opened={Boolean(pick)} onClose={onClose} title="Which copy?" centered>
      <Stack gap="xs">
        <Text size="sm" c="dimmed">A book barcode doesn't say which physical copy you hold. Choose one (or scan its sticker).</Text>
        {pick?.groups.flatMap((g) => g.copies.map((c) => (
          <Group key={c.id} justify="space-between">
            <Text size="sm"><b>{c.code}</b> · {g.condition.toLowerCase().replace('_', ' ')} · {fmt.money(g.sellingPriceMinor)} · {c.stall ? `at ${c.stall.name}` : <LocationCode code={c.locationCode} />}</Text>
            <Button size="compact-sm" onClick={() => { onPick(c.code); onClose(); }}>Use</Button>
          </Group>
        )))}
      </Stack>
    </Modal>
  );
}

function Inline({ children }: { children: React.ReactNode }) {
  return <Alert color="red" role="alert" py={6}>{children}</Alert>;
}

// ───────────── modes ─────────────

function LookupMode() {
  const fmt = useFormat();
  const [copy, setCopy] = useState<{ detail: CopyDetail; actions: CopyAction[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { pickFrom, closePick, reScan } = useModeScanner('lookup', (o) => {
    setMsg(null);
    if (o.type === 'copy') { setCopy({ detail: o.copy, actions: o.actions }); return 'ok'; }
    if (o.type === 'blocked') { setMsg(`${o.code} isn't at your stall`); setCopy(null); return 'bad'; }
    if (o.type === 'not-found') { setMsg(`No book with code ${o.code}`); return 'bad'; }
  });
  return (
    <Stack>
      <CopyPicker pick={pickFrom} onClose={closePick} onPick={(code) => void reScan(code).then((o) => o.type === 'copy' && setCopy({ detail: o.copy, actions: o.actions }))} />
      {msg && <Inline>{msg}</Inline>}
      {!copy ? <EmptyState title="Scan a book">Its details and the actions you can take appear here.</EmptyState> : (
        <Card withBorder>
          <Group justify="space-between" align="flex-start">
            <div><Title order={4}>{copy.detail.title.title}</Title><Text c="dimmed" size="sm">{copy.detail.title.authors.join(', ')} · {copy.detail.code}</Text></div>
            <LocationCode code={copy.detail.locationCode} size="lg" />
          </Group>
          <Text size="xl" fw={800} my="xs">{fmt.money(copy.detail.sellingPriceMinor)}</Text>
          <CopyActions copy={copy.detail} actions={copy.actions} onChanged={() => setCopy(null)} />
        </Card>
      )}
    </Stack>
  );
}

function SellMode() {
  const cart = useCart();
  const [msg, setMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const { pickFrom, closePick, reScan } = useModeScanner('sell', (o) => {
    setMsg(null);
    if (o.type !== 'copy') { if (o.type === 'blocked') setMsg(`${o.code} isn't at your stall`); else if (o.type === 'not-found') setMsg(`No book with code ${o.code}`); return; }
    if (!has(o.actions, 'SELL')) { setMsg(`${o.copy.code} can't be sold (${o.copy.status.toLowerCase().replace('_', ' ')})`); return 'bad'; }
    const r = cart.add({ copyId: o.copy.id, code: o.copy.code, title: o.copy.title.title, condition: o.copy.condition, sellingPriceMinor: o.copy.sellingPriceMinor, locationCode: o.copy.locationCode, stallName: o.copy.stall?.name ?? null });
    if (r === 'duplicate') { setMsg(`${o.copy.code} is already in the cart`); return 'bad'; }
    return 'ok';
  });
  return (
    <Stack>
      <CopyPicker pick={pickFrom} onClose={closePick} onPick={(code) => void reScan(code)} />
      {msg && <Inline>{msg}</Inline>}
      {!cart.items.length ? <EmptyState title="Scan the books to sell">Each scan adds a book to the sale. Then take payment below.</EmptyState> : null}
      <SaleForm items={cart.items} onRemove={cart.remove} unavailable={unavailable} onUnavailable={setUnavailable} onSold={() => { cart.clear(); setUnavailable([]); }} onNewSale={() => setMsg(null)} />
    </Stack>
  );
}

export function CheckoutMode({ fixedStallId }: { fixedStallId?: string } = {}) {
  const [sp, setSp] = useSearchParams();
  const stalls = useStalls();
  const stallId = fixedStallId ?? sp.get('stall');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const clientRef = useRef(crypto.randomUUID());
  const checkout = useCheckout(stallId ?? '');
  const options = (stalls.data ?? []).filter((s) => s.status !== 'CLOSED').map((s) => ({ value: s.id, label: s.name }));
  const { pickFrom, closePick, reScan } = useModeScanner('checkout', (o) => {
    if (o.type !== 'copy') return;
    if (!has(o.actions, 'CHECKOUT')) { setErrors((e) => [`${o.copy.code}: not available to check out (${o.copy.status.toLowerCase().replace('_', ' ')})`, ...e].slice(0, 5)); return 'bad'; }
    setRows((r) => (r.some((x) => x.copyId === o.copy.id) ? r : [...r, toRow(o.copy)]));
    return 'ok';
  }, { enabled: Boolean(stallId) });

  const confirm = async () => {
    if (!stallId) return;
    const res = await checkout.mutateAsync({ clientRef: clientRef.current, copyIds: rows.map((r) => r.copyId) });
    setResult(res);
    setRows([]);
    clientRef.current = crypto.randomUUID();
  };
  return (
    <Stack>
      <CopyPicker pick={pickFrom} onClose={closePick} onPick={(code) => void reScan(code)} />
      {!fixedStallId && <Select label="Send to stall" placeholder="Choose a stall first" data={options} value={stallId} onChange={(v) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set('stall', v); else n.delete('stall'); return n; }, { replace: true })} searchable />}
      {errors.map((e, i) => <Inline key={i}>{e}</Inline>)}
      {stallId && (
        <>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {rows.map((r) => <Table.Tr key={r.copyId}><Table.Td><LocationCode code={r.locationCode} /></Table.Td><Table.Td>{r.code}</Table.Td><Table.Td>{r.title}</Table.Td><Table.Td><ActionIcon variant="subtle" color="red" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((y) => y.copyId !== r.copyId))}><IconTrash size={16} /></ActionIcon></Table.Td></Table.Tr>)}
            </Table.Tbody>
          </Table>
          {!rows.length && <EmptyState title="Scan the books to send">Scan each sticker; confirm when the box is full.</EmptyState>}
          <Button size="md" onClick={confirm} disabled={!rows.length} loading={checkout.isPending}>Confirm checkout ({rows.length} book{rows.length === 1 ? '' : 's'})</Button>
        </>
      )}
      {result && (
        <Alert color="green" title={`${result.checkedOut.length} checked out`}>
          {result.failed.length > 0 && <Text size="sm" c="red">{result.failed.length} could not be sent: {errorMessage(new Error(result.failed.map((f) => f.code ?? f.copyId).join(', ')))}</Text>}
          {stallId && <Button mt="xs" size="compact-sm" onClick={() => void openPdf(() => api.stalls.pickList(stallId, result.batchId))}>Pick list (PDF)</Button>}
        </Alert>
      )}
    </Stack>
  );
}

export function CheckinMode() {
  const [log, setLog] = useState<Array<{ ok: boolean; item?: CheckinItem; text: string; at: number }>>([]);
  useModeScanner('checkin', (o) => {
    if (o.type === 'checked-in') { setLog((l) => [{ ok: true, item: o.item, text: o.item.code, at: Date.now() }, ...l]); return 'ok'; }
    if (o.type === 'checkin-failed') { setLog((l) => [{ ok: false, text: `${o.code}: ${o.reason}`, at: Date.now() }, ...l]); return 'bad'; }
  });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of log) if (l.item) m.set(l.item.fromStall.name, (m.get(l.item.fromStall.name) ?? 0) + 1);
    return [...m];
  }, [log]);
  const latest = log[0];
  return (
    <Stack>
      {!latest ? <EmptyState title="Scan returned books">Each scan checks the book in immediately and tells you where to shelve it.</EmptyState> : latest.ok && latest.item ? (
        <Paper withBorder p="lg" bg="var(--mantine-color-green-light)" data-testid="checkin-result">
          <Text size="sm" c="dimmed">Returned from {latest.item.fromStall.name}</Text>
          <Text fw={600}>{latest.item.title}</Text>
          <Text size="sm" mt="xs">Put back at</Text>
          <LocationCode code={latest.item.returnToLocation} size="xl" />
          {latest.item.relocated && <Badge color="orange" mt="xs">New place: the old slot was gone. Reprint its label.</Badge>}
        </Paper>
      ) : <Alert color="red" role="alert" title="Not checked in">{latest.text}</Alert>}
      {counts.length > 0 && <Group>{counts.map(([name, n]) => <Badge key={name} size="lg" variant="light">{name}: {n}</Badge>)}</Group>}
      <Table verticalSpacing={2}><Table.Tbody>{log.slice(1, 15).map((l, i) => <Table.Tr key={i}><Table.Td c={l.ok ? undefined : 'red'}>{l.item ? `${l.item.code} · ${l.item.title}` : l.text}</Table.Td><Table.Td>{l.item && <LocationCode code={l.item.returnToLocation} />}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
    </Stack>
  );
}

function LabelsMode() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const { pickFrom, closePick, reScan } = useModeScanner('labels', (o) => {
    if (o.type !== 'copy') return;
    if (!has(o.actions, 'PRINT_LABEL')) return 'bad';
    setRows((r) => (r.some((x) => x.copyId === o.copy.id) ? r : [...r, toRow(o.copy)]));
    return 'ok';
  });
  return (
    <Stack>
      <CopyPicker pick={pickFrom} onClose={closePick} onPick={(code) => void reScan(code)} />
      {!rows.length ? <EmptyState title="Scan books to reprint their labels" /> : (
        <Table verticalSpacing={4}><Table.Tbody>{rows.map((r) => <Table.Tr key={r.copyId}><Table.Td>{r.code}</Table.Td><Table.Td>{r.title}</Table.Td><Table.Td><ActionIcon variant="subtle" color="red" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((y) => y.copyId !== r.copyId))}><IconTrash size={16} /></ActionIcon></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      )}
      <Button disabled={!rows.length} onClick={() => setOpen(true)}>Print {rows.length} label{rows.length === 1 ? '' : 's'}</Button>
      <LabelPrintDialog opened={open} onClose={() => setOpen(false)} copyIds={rows.map((r) => r.copyId)} onPrinted={() => setRows([])} />
    </Stack>
  );
}

// ───────────── page ─────────────

export default function ScanStationPage() {
  const { can } = useAuth();
  const { openCamera } = useScanner();
  const [sp, setSp] = useSearchParams();
  const modes = useMemo(() => [
    { value: 'lookup', label: 'Lookup', ok: true },
    { value: 'sell', label: 'Sell', ok: can('sale.create.central') || can('sale.create.stall') },
    { value: 'checkout', label: 'Check out', ok: can('stall.checkout') },
    { value: 'checkin', label: 'Check in', ok: can('stall.checkin') },
    { value: 'labels', label: 'Labels', ok: can('label.print') && can('inventory.read') },
  ].filter((m) => m.ok), [can]);
  const requested = sp.get('mode') as Mode | null;
  const mode: Mode = modes.some((m) => m.value === requested) ? (requested as Mode) : 'lookup';

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Scan station</Title>
        <Button variant="default" leftSection={<IconCamera size={16} />} onClick={() => openCamera({ continuous: true })} hiddenFrom="md">Camera</Button>
      </Group>
      <Text size="sm" c="dimmed">Scan with your USB/Bluetooth scanner (no need to click anywhere) or use the camera. Repeat scans within 2 seconds are ignored.</Text>
      <SegmentedControl fullWidth data={modes.map(({ value, label }) => ({ value, label }))} value={mode} onChange={(v) => setSp({ mode: v }, { replace: true })} />
      {/* key: switching mode remounts, so each mode registers its own scan handler */}
      {mode === 'lookup' && <LookupMode key="lookup" />}
      {mode === 'sell' && <SellMode key="sell" />}
      {mode === 'checkout' && <CheckoutMode key="checkout" />}
      {mode === 'checkin' && <CheckinMode key="checkin" />}
      {mode === 'labels' && <LabelsMode key="labels" />}
    </Stack>
  );
}
