import { handleScan, ScanDeduper, type ScanMode } from '@bookstall/api-client';
import type { CheckinItem, CopyAction, CopyDetail } from '@bookstall/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, IconButton, SegmentedButtons, Text } from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import { CopyView } from '../../src/components/CopyView';
import { LabelSheet } from '../../src/components/LabelSheet';
import { SaleForm } from '../../src/components/SaleForm';
import { ScannerView } from '../../src/components/ScannerView';
import { Empty, Screen, styles } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useCart } from '../../src/lib/cart';
import { feedback } from '../../src/lib/feedback';

type Mode = 'lookup' | 'sell' | 'checkout' | 'checkin' | 'add' | 'labels';
const has = (a: CopyAction[], x: CopyAction['action']) => a.some((y) => y.action === x);

/** One scan tab, several modes (mirrors the web scan station). Managers only get Lookup and Sell. */
export default function ScanTab() {
  const { can } = useAuth();
  const cart = useCart();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ mode?: string }>();
  const modes = useMemo(() => [
    { value: 'lookup', label: 'Lookup', ok: true },
    { value: 'sell', label: 'Sell', ok: can('sale.create.central') || can('sale.create.stall') },
    { value: 'checkout', label: 'Out', ok: can('stall.checkout') },
    { value: 'checkin', label: 'In', ok: can('stall.checkin') },
    { value: 'add', label: 'Add', ok: can('copy.create') },
    { value: 'labels', label: 'Labels', ok: can('label.print') && can('inventory.read') },
  ].filter((m) => m.ok), [can]);
  const [mode, setMode] = useState<Mode>(modes.some((m) => m.value === params.mode) ? (params.mode as Mode) : 'lookup');

  const [found, setFound] = useState<{ copy: CopyDetail; actions: CopyAction[] } | null>(null);
  const [list, setList] = useState<Array<{ id: string; code: string; title: string; locationCode: string | null }>>([]);
  const [checkins, setCheckins] = useState<Array<{ item?: CheckinItem; text: string }>>([]);
  const [labelOpen, setLabelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busy = false;
  const deduper = useRef(new ScanDeduper(2000));

  const onScan = async (raw: string) => {
    if (busy) return;
    setToast(null);
    const out = await handleScan(api, raw, { mode: (mode === 'add' ? 'default' : mode) as ScanMode });
    const bad = (m: string) => { feedback.error(); setToast(m); };
    switch (out.type) {
      case 'unknown': return bad('Not a recognised code');
      case 'not-found': return bad(`Nothing found for ${out.code}`);
      case 'blocked': return bad(`${out.code} isn’t at your stall`);
      case 'error': return bad(out.message);
      case 'checked-in': feedback.success(); setCheckins((l) => [{ item: out.item, text: out.item.code }, ...l]); void qc.invalidateQueries(); return;
      case 'checkin-failed': feedback.error(); setCheckins((l) => [{ text: `${out.code}: ${out.reason}` }, ...l]); return;
      case 'add-book': feedback.success(); return router.push({ pathname: '/add', params: { isbn: out.isbn13 } });
      case 'choose-copy': return bad('That is a book barcode. Scan the sticker QR on the copy.');
      case 'navigate': feedback.success(); return router.push(out.to as never);
      case 'copy': {
        if (mode === 'lookup') { feedback.success(); return setFound({ copy: out.copy, actions: out.actions }); }
        if (mode === 'sell') {
          if (!has(out.actions, 'SELL')) return bad(`${out.copy.code} can’t be sold (${out.copy.status.toLowerCase().replace('_', ' ')})`);
          const r = cart.add({ copyId: out.copy.id, code: out.copy.code, title: out.copy.title.title, condition: out.copy.condition, sellingPriceMinor: out.copy.sellingPriceMinor, locationCode: out.copy.locationCode, stallName: out.copy.stall?.name ?? null });
          if (r === 'duplicate') return bad(`${out.copy.code} is already in the sale`);
          return feedback.success();
        }
        const need = mode === 'checkout' ? 'CHECKOUT' : 'PRINT_LABEL';
        if (!has(out.actions, need)) return bad(`${out.copy.code}: not available for that`);
        setList((l) => (l.some((x) => x.id === out.copy.id) ? l : [...l, { id: out.copy.id, code: out.copy.code, title: out.copy.title.title, locationCode: out.copy.locationCode }]));
        return feedback.success();
      }
    }
  };
  const accept = (raw: string) => { if (deduper.current.accept(raw)) void onScan(raw); };
  const latest = checkins[0];

  return (
    <Screen>
      <SegmentedButtons density="small" value={mode} onValueChange={(v) => { setMode(v as Mode); setFound(null); setList([]); setToast(null); }} buttons={modes.map(({ value, label }) => ({ value, label }))} />
      <ScannerView onScan={accept} paused={busy} height={mode === 'checkin' ? 220 : 280} />
      {toast && <Card style={{ backgroundColor: '#ffe3e3' }}><Card.Content><Text style={{ color: '#c92a2a' }}>{toast}</Text></Card.Content></Card>}

      {mode === 'lookup' && (found ? <CopyView copy={found.copy} actions={found.actions} compact onChanged={() => setFound(null)} /> : <Empty title="Scan a book" hint="Details and actions appear here." />)}

      {mode === 'sell' && (cart.items.length === 0 ? <Empty title="Scan the books to sell" hint="Each scan adds a book to the sale." /> : null)}
      {mode === 'sell' && <SaleForm items={cart.items} onRemove={cart.remove} onSold={() => cart.clear()} onNewSale={() => setToast(null)} />}

      {(mode === 'checkout' || mode === 'labels') && (
        <View style={{ gap: 8 }}>
          {list.length === 0 && <Empty title={mode === 'checkout' ? 'Scan books to send to a stall' : 'Scan books to reprint labels'} />}
          {list.map((b) => (
            <View key={b.id} style={styles.between}><View style={{ flex: 1 }}><Text variant="titleSmall" numberOfLines={1}>{b.title}</Text><Text variant="bodySmall" style={{ opacity: 0.6 }}>{b.code} · {b.locationCode ?? 'unshelved'}</Text></View><IconButton icon="close" onPress={() => setList((l) => l.filter((x) => x.id !== b.id))} accessibilityLabel={`Remove ${b.code}`} /></View>
          ))}
          {mode === 'checkout' && <Button mode="contained" disabled={!list.length} onPress={() => router.push({ pathname: '/stalls/checkout', params: { copyIds: list.map((l) => l.id).join(','), n: String(list.length) } })}>Choose stall & confirm ({list.length})</Button>}
          {mode === 'labels' && <Button mode="contained" disabled={!list.length} onPress={() => setLabelOpen(true)}>Print {list.length} label{list.length === 1 ? '' : 's'}</Button>}
          <LabelSheet visible={labelOpen} onClose={() => setLabelOpen(false)} copyIds={list.map((l) => l.id)} onPrinted={() => setList([])} />
        </View>
      )}

      {mode === 'checkin' && (
        <View style={{ gap: 8 }}>
          {!latest ? <Empty title="Scan returned books" hint="Each scan checks the book in and says where to shelve it." /> : latest.item ? (
            <Card style={{ backgroundColor: '#d3f9d8' }} testID="checkin-result"><Card.Content>
              <Text variant="bodySmall" style={{ opacity: 0.7 }}>Returned from {latest.item.fromStall.name}</Text>
              <Text variant="titleMedium">{latest.item.title}</Text>
              <Text variant="bodyMedium" style={{ marginTop: 8 }}>Put back at</Text>
              <Text variant="displaySmall" style={{ fontWeight: '800' }}>{latest.item.returnToLocation ?? 'any free space'}</Text>
              {latest.item.relocated && <Chip style={{ marginTop: 8 }}>New place: reprint its label</Chip>}
            </Card.Content></Card>
          ) : <Card style={{ backgroundColor: '#ffe3e3' }}><Card.Content><Text>{latest.text}</Text></Card.Content></Card>}
          <Text variant="labelMedium">{checkins.filter((c) => c.item).length} checked in this session</Text>
          {checkins.slice(1, 8).map((c, i) => <Text key={i} variant="bodySmall" style={{ opacity: 0.7 }}>{c.item ? `${c.item.code} → ${c.item.returnToLocation}` : c.text}</Text>)}
        </View>
      )}

      {mode === 'add' && <Empty title="Scan the barcode on the back cover" hint="The book is looked up and the Add screen opens." />}
    </Screen>
  );
}
