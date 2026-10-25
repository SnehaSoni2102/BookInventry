import { errorMessage, useCheckout, useStalls } from '@bookstall/api-client';
import type { BookCondition, CheckoutResponse } from '@bookstall/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, RadioButton, Text, TextInput } from 'react-native-paper';
import { Screen } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { useOnline } from '../../../src/lib/network';
import { printPdf, sharePdf } from '../../../src/lib/print';

/** Pick a stall, then send explicit copies (from scanning/selection) or "N copies of X" (picked in shelf order). */
export default function CheckoutScreen() {
  const p = useLocalSearchParams<{ copyIds?: string; copyId?: string; titleId?: string; title?: string; condition?: string; price?: string; max?: string; n?: string }>();
  const stalls = useStalls();
  const online = useOnline();
  const [stallId, setStallId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const clientRef = useRef(crypto.randomUUID());
  const checkout = useCheckout(stallId ?? '');
  const copyIds = (p.copyIds ? p.copyIds.split(',') : p.copyId ? [p.copyId] : []).filter(Boolean);
  const group = p.titleId ? { titleId: p.titleId, condition: p.condition as BookCondition, sellingPriceMinor: Number(p.price), quantity: Number(qty) || 1 } : null;

  const submit = async () => {
    if (!stallId) return;
    try {
      setResult(await checkout.mutateAsync(group ? { clientRef: clientRef.current, groups: [group] } : { clientRef: clientRef.current, copyIds }));
    } catch (e) {
      Alert.alert('Checkout failed', errorMessage(e));
    }
  };

  if (result) {
    return (
      <Screen>
        <Text variant="headlineSmall">{result.checkedOut.length} checked out</Text>
        {result.failed.length > 0 && <Text style={{ color: '#c92a2a' }}>{result.failed.length} could not be sent.</Text>}
        <Text variant="labelLarge">Collect from the shelves (walking order)</Text>
        {result.checkedOut.map((c) => <Text key={c.copyId}>{c.locationCode ?? 'unshelved'}  ·  {c.code}  ·  {c.title}</Text>)}
        <View style={{ gap: 8 }}>
          {stallId && <Button mode="outlined" icon="printer" onPress={async () => printPdf(await api.stalls.pickList(stallId, result.batchId), 'pick-list.pdf')}>Print pick list</Button>}
          {stallId && <Button mode="outlined" icon="share-variant" onPress={async () => sharePdf(await api.stalls.pickList(stallId, result.batchId), 'pick-list.pdf', 'Pick list')}>Share pick list</Button>}
          <Button mode="contained" onPress={() => router.back()}>Done</Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card><Card.Content>
        {group ? <Text>{p.title} · {String(p.condition).replace('_', ' ').toLowerCase()}: how many of the {p.max} copies?</Text> : <Text>{copyIds.length} selected book{copyIds.length === 1 ? '' : 's'}</Text>}
        {group && <TextInput mode="outlined" label="Quantity" keyboardType="number-pad" value={qty} onChangeText={setQty} style={{ marginTop: 8 }} />}
      </Card.Content></Card>
      <Text variant="labelLarge">Send to</Text>
      <RadioButton.Group value={stallId ?? ''} onValueChange={setStallId}>
        {(stalls.data ?? []).filter((s) => s.status !== 'CLOSED').map((s) => <RadioButton.Item key={s.id} label={`${s.name}${s.status === 'PLANNED' ? ' (planned)' : ''}`} value={s.id} />)}
      </RadioButton.Group>
      <Button mode="contained" onPress={submit} loading={checkout.isPending} disabled={!stallId || !online || (!group && copyIds.length === 0)}>Confirm checkout</Button>
    </Screen>
  );
}
