import { errorMessage, qk } from '@bookstall/api-client';
import type { CopyAction, CopyDetail } from '@bookstall/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Text } from 'react-native-paper';
import { api } from '../lib/api';
import { useCart } from '../lib/cart';
import { feedback } from '../lib/feedback';
import { CONDITION_LABEL, STATUS_LABEL, useFormat } from '../lib/format';
import { LabelSheet } from './LabelSheet';
import { SaleForm } from './SaleForm';
import { styles } from './ui';

/** One copy: details plus the actions the server says this user may take (permission × status × scope). */
export function CopyView({ copy, actions, onChanged, compact }: { copy: CopyDetail; actions: CopyAction[]; onChanged?: () => void; compact?: boolean }) {
  const fmt = useFormat();
  const cart = useCart();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<'sell' | 'labels' | null>(null);
  const t = copy.title;
  const has = (a: CopyAction['action']) => actions.find((x) => x.action === a);
  const checkin = has('CHECKIN') as Extract<CopyAction, { action: 'CHECKIN' }> | undefined;
  const item = { copyId: copy.id, code: copy.code, title: t.title, condition: copy.condition, sellingPriceMinor: copy.sellingPriceMinor, locationCode: copy.locationCode, stallName: copy.stall?.name ?? null };

  const doCheckin = async () => {
    try {
      const res = await api.stalls.checkin({ clientRef: crypto.randomUUID(), copyIds: [copy.id] });
      const d = res.checkedIn[0];
      if (!d) throw new Error('Could not check in');
      feedback.success();
      Alert.alert('Put it back at', `${d.returnToLocation ?? 'a free slot'}${d.relocated ? '\n(new place: the old slot was gone)' : ''}`);
      await qc.invalidateQueries();
      onChanged?.();
    } catch (e) {
      Alert.alert('Check-in failed', errorMessage(e));
    }
  };

  return (
    <Card>
      <Card.Content style={{ gap: 8 }}>
        <Text variant={compact ? 'titleMedium' : 'headlineSmall'}>{t.title}</Text>
        {t.authors.length > 0 && <Text style={{ opacity: 0.7 }}>{t.authors.join(', ')}</Text>}
        <View style={styles.wrap}>
          <Chip compact>{t.genre.code}</Chip>
          <Chip compact>{CONDITION_LABEL[copy.condition] ?? copy.condition}</Chip>
          <Chip compact icon={copy.status === 'IN_STOCK' ? 'check' : undefined}>{copy.status === 'AT_STALL' && copy.stall ? `At ${copy.stall.name}` : STATUS_LABEL[copy.status]}</Chip>
        </View>
        <View style={styles.between}>
          <View>
            <Text variant="headlineMedium" testID="copy-price">{fmt.money(copy.sellingPriceMinor)}</Text>
            {copy.originalPriceMinor ? <Text style={{ textDecorationLine: 'line-through', opacity: 0.6 }}>MRP {fmt.money(copy.originalPriceMinor)}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="labelSmall" style={{ opacity: 0.6 }}>SHELF</Text>
            <Text variant="titleLarge" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{copy.locationCode ?? 'UNSHELVED'}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.6 }}>{copy.code}</Text>
          </View>
        </View>
        {copy.status === 'AT_STALL' && copy.stall && <Text style={{ color: '#7048e8' }}>Checked out to {copy.stall.name}{copy.openMovement ? ` since ${fmt.dateTime(copy.openMovement.checkedOutAt)}` : ''}. It goes back to {copy.locationCode}.</Text>}
        {copy.status === 'SOLD' && copy.sale && <Text>Sold {fmt.dateTime(copy.sale.soldAt)} · {copy.sale.receiptNo} · {fmt.money(copy.sale.soldPriceMinor)}</Text>}
        {!compact && t.summary ? <Text numberOfLines={6}>{t.summary}</Text> : null}
        <View style={styles.wrap}>
          {has('SELL') && <Button mode="contained" onPress={() => setSheet('sell')} testID="action-sell">Sell</Button>}
          {has('SELL') && <Button mode="outlined" onPress={() => { const r = cart.add(item); feedback[r === 'added' ? 'success' : 'error'](); Alert.alert(r === 'added' ? 'Added to cart' : 'Already in the cart'); }}>Add to cart</Button>}
          {has('CHECKOUT') && <Button mode="outlined" onPress={() => router.push({ pathname: '/stalls/checkout', params: { copyId: copy.id, code: copy.code, title: t.title } })}>Check out</Button>}
          {checkin && <Button mode="outlined" onPress={doCheckin}>Check in from {checkin.stall.name}</Button>}
          {has('PRINT_LABEL') && <Button mode="text" onPress={() => setSheet('labels')}>Print label</Button>}
          {has('EDIT') && !compact && <Button mode="text" onPress={() => router.push(`/inventory/${t.id}`)}>Title</Button>}
        </View>
      </Card.Content>
      <Portal>
        <Dialog visible={sheet === 'sell'} onDismiss={() => { setSheet(null); onChanged?.(); }}>
          <Dialog.Title>Sell this book</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 520 }}>
            <View style={{ paddingVertical: 8 }}>
              <SaleForm items={[item]} onSold={() => void qc.invalidateQueries({ queryKey: qk.copies.all() })} onNewSale={() => { setSheet(null); onChanged?.(); }} />
            </View>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
      <LabelSheet visible={sheet === 'labels'} onClose={() => setSheet(null)} copyIds={[copy.id]} onPrinted={onChanged} />
    </Card>
  );
}
