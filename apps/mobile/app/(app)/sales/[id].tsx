import { errorMessage, qk, useVoidSale } from '@bookstall/api-client';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Dialog, Divider, Portal, Text, TextInput } from 'react-native-paper';
import { ErrorBox, Loading, Screen, styles } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { useAuth } from '../../../src/lib/auth';
import { useFormat } from '../../../src/lib/format';
import { printPdf, sharePdf } from '../../../src/lib/print';

export default function SaleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fmt = useFormat();
  const { can } = useAuth();
  const q = useQuery({ queryKey: qk.sales.one(String(id)), queryFn: () => api.sales.get(String(id)) });
  const voidSale = useVoidSale(String(id));
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [toStall, setToStall] = useState(false);
  const s = q.data;
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !s) return <Screen><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></Screen>;

  const doVoid = async () => {
    try {
      const res = await voidSale.mutateAsync({ reason: reason.trim(), returnToStall: toStall });
      setVoiding(false);
      Alert.alert('Sale voided', `Return the books to:\n${res.restored.map((r) => `${r.code}  →  ${r.locationCode ?? 'unshelved'}${r.relocated ? ' (new place)' : ''}`).join('\n')}`);
      void q.refetch();
    } catch (e) {
      Alert.alert('Could not void', errorMessage(e));
    }
  };

  return (
    <Screen>
      <Text variant="headlineSmall">{s.receiptNo}</Text>
      <Text>{s.soldAtLabel} · {fmt.dateTime(s.soldAt)} · {s.seller.displayName}</Text>
      {s.status === 'VOIDED' && <Text style={{ color: '#c92a2a' }}>VOIDED: {s.voidReason}</Text>}
      <Divider />
      {s.items.map((i) => (
        <View key={i.copyId} style={styles.between}>
          <View style={{ flex: 1 }}><Text variant="titleSmall">{i.title}</Text><Text variant="bodySmall" style={{ opacity: 0.6 }}>{i.code}</Text></View>
          <Text>{fmt.money(i.soldPriceMinor)}</Text>
        </View>
      ))}
      <Divider />
      <View style={styles.between}><Text variant="titleMedium">Total</Text><Text variant="titleLarge">{fmt.money(s.totalMinor)}</Text></View>
      <Text>Paid by {s.paymentMethod.toLowerCase()}{s.customerName ? ` · ${s.customerName}` : ''}</Text>
      <View style={styles.wrap}>
        <Button mode="outlined" icon="share-variant" onPress={async () => sharePdf(await api.sales.receipt(s.id, 'a6'), `${s.receiptNo}.pdf`, 'Receipt')}>Share receipt</Button>
        <Button mode="outlined" icon="printer" onPress={async () => printPdf(await api.sales.receipt(s.id, 'thermal'), `${s.receiptNo}.pdf`)}>Print</Button>
        {can('sale.void') && s.status === 'COMPLETED' && <Button mode="contained-tonal" textColor="#c92a2a" onPress={() => setVoiding(true)}>Void sale</Button>}
      </View>
      <Portal>
        <Dialog visible={voiding} onDismiss={() => setVoiding(false)}>
          <Dialog.Title>Void {s.receiptNo}</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text>The books go back on sale. This is recorded in the audit log.</Text>
            <TextInput mode="outlined" label="Reason (required)" value={reason} onChangeText={setReason} />
            {s.stallId && <Button mode={toStall ? 'contained' : 'outlined'} onPress={() => setToStall((v) => !v)}>{toStall ? '✓ ' : ''}Put the books back at the stall</Button>}
          </Dialog.Content>
          <Dialog.Actions><Button onPress={() => setVoiding(false)}>Cancel</Button><Button textColor="#c92a2a" disabled={reason.trim().length < 3} loading={voidSale.isPending} onPress={doVoid}>Void</Button></Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
