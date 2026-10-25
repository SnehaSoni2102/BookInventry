import { ApiError, errorMessage, useCreateSale } from '@bookstall/api-client';
import { parseMoneyToMinor, type PaymentMethod, type SaleDto } from '@bookstall/shared';
import { useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { Button, Chip, Divider, HelperText, IconButton, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CartItem } from '../lib/cart';
import { feedback } from '../lib/feedback';
import { CONDITION_LABEL, useFormat } from '../lib/format';
import { useOnline } from '../lib/network';
import { sharePdf } from '../lib/print';
import { styles } from './ui';

interface Props {
  items: CartItem[];
  onRemove?: (copyId: string) => void;
  unavailable?: string[];
  onUnavailable?: (codes: string[]) => void;
  onSold: (sale: SaleDto) => void;
  onNewSale: () => void;
}

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }, { value: 'OTHER', label: 'Other' },
];

/**
 * Payment and confirmation for one or more books, then the receipt. The `clientRef` is created once per attempt, so
 * a retry after a dropped mobile connection can never record the sale twice.
 */
export function SaleForm({ items, onRemove, unavailable = [], onUnavailable, onSold, onNewSale }: Props) {
  const fmt = useFormat();
  const { can } = useAuth();
  const online = useOnline();
  const create = useCreateSale();
  const clientRef = useRef(crypto.randomUUID());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [override, setOverride] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [confirmAtStall, setConfirmAtStall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SaleDto | null>(null);

  const isAdmin = can('sale.create.central');
  const atStall = items.find((i) => i.stallName);
  const effective = (i: CartItem) => (override && prices[i.copyId] ? (parseMoneyToMinor(prices[i.copyId]!) ?? i.sellingPriceMinor) : i.sellingPriceMinor);
  const total = items.reduce((a, i) => a + effective(i), 0);

  const submit = async () => {
    setError(null);
    try {
      const sale = await create.mutateAsync({
        clientRef: clientRef.current,
        paymentMethod: method,
        items: items.map((i) => ({ copyId: i.copyId, ...(override && effective(i) !== i.sellingPriceMinor ? { soldPriceMinor: effective(i) } : {}) })),
        ...(customer.name ? { customerName: customer.name } : {}),
        ...(customer.phone ? { customerPhone: customer.phone } : {}),
        ...(isAdmin && atStall ? { confirmAtStallCopies: confirmAtStall } : {}),
      });
      feedback.success();
      setDone(sale);
      onSold(sale);
    } catch (e) {
      feedback.error();
      if (e instanceof ApiError && e.code === 'COPY_NOT_AVAILABLE') {
        const codes = (e.details as { codes?: string[] } | undefined)?.codes;
        if (codes) onUnavailable?.(codes);
      }
      // a rejected attempt was rolled back on the server: a fresh id is safe for the next try
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) clientRef.current = crypto.randomUUID();
      setError(errorMessage(e));
    }
  };

  if (done) {
    return (
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }} testID="sale-success">
        <Chip icon="check" selected>Sale recorded</Chip>
        <Text variant="headlineSmall">{done.receiptNo}</Text>
        <Text variant="titleMedium">{fmt.money(done.totalMinor)} · {done.paymentMethod.toLowerCase()}</Text>
        <Text style={{ opacity: 0.7 }}>{done.items.length} book{done.items.length === 1 ? '' : 's'} · {done.soldAtLabel}</Text>
        <View style={styles.wrap}>
          <Button icon="share-variant" mode="outlined" onPress={() => void Share.share({ message: `${done.receiptNo}: ${done.items.map((i) => i.title).join(', ')}. Total ${fmt.money(done.totalMinor)}. Thank you!` })}>Share text</Button>
          <Button icon="file-pdf-box" mode="outlined" onPress={async () => sharePdf(await api.sales.receipt(done.id, 'a6'), `${done.receiptNo}.pdf`, 'Receipt')}>Receipt PDF</Button>
        </View>
        <Button mode="contained" onPress={onNewSale}>New sale</Button>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {items.map((i) => (
        <View key={i.copyId} style={[styles.between, unavailable.includes(i.code) && { backgroundColor: '#ffe3e3', borderRadius: 8, padding: 4 }]}>
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall" numberOfLines={2}>{i.title}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.7 }}>{i.code} · {CONDITION_LABEL[i.condition] ?? i.condition}{i.stallName ? ` · ${i.stallName}` : i.locationCode ? ` · ${i.locationCode}` : ''}{unavailable.includes(i.code) ? ' · NO LONGER AVAILABLE' : ''}</Text>
          </View>
          {override ? (
            <TextInput dense mode="outlined" style={{ width: 90 }} keyboardType="decimal-pad" value={prices[i.copyId] ?? String(i.sellingPriceMinor / 100)} onChangeText={(t) => setPrices((p) => ({ ...p, [i.copyId]: t }))} accessibilityLabel={`Price for ${i.code}`} />
          ) : (
            <Text variant="titleSmall">{fmt.money(i.sellingPriceMinor)}</Text>
          )}
          {onRemove && <IconButton icon="delete-outline" onPress={() => onRemove(i.copyId)} accessibilityLabel={`Remove ${i.code}`} />}
        </View>
      ))}
      <Divider />
      <View style={styles.between}>
        <Text variant="titleMedium">Total</Text>
        <Text variant="headlineSmall" testID="sale-total">{fmt.money(total)}</Text>
      </View>
      <SegmentedButtons value={method} onValueChange={(v) => setMethod(v as PaymentMethod)} buttons={METHODS} />
      {isAdmin ? (
        <View style={styles.between}>
          <View style={{ flex: 1 }}><Text>Override price</Text><Text variant="bodySmall" style={{ opacity: 0.7 }}>Only admins can; it is recorded.</Text></View>
          <Switch value={override} onValueChange={setOverride} />
        </View>
      ) : (
        <Text variant="bodySmall" style={{ opacity: 0.7 }}>Books are always sold at the marked price.</Text>
      )}
      <TextInput dense mode="outlined" label="Customer name (optional)" value={customer.name} onChangeText={(t) => setCustomer((c) => ({ ...c, name: t }))} />
      <TextInput dense mode="outlined" label="Customer phone (optional)" keyboardType="phone-pad" value={customer.phone} onChangeText={(t) => setCustomer((c) => ({ ...c, phone: t }))} />
      {isAdmin && atStall && (
        <View style={styles.between}>
          <Text style={{ flex: 1 }}>This book is at {atStall.stallName}. Record the sale as Admin @ {atStall.stallName}.</Text>
          <Switch value={confirmAtStall} onValueChange={setConfirmAtStall} />
        </View>
      )}
      {!online && <HelperText type="error" visible>No internet: the sale can’t be recorded right now.</HelperText>}
      {error && <HelperText type="error" visible>{error}</HelperText>}
      <Button mode="contained" contentStyle={{ paddingVertical: 8 }} onPress={submit} loading={create.isPending} disabled={!items.length || !online || (isAdmin && Boolean(atStall) && !confirmAtStall)}>
        Confirm sale · {fmt.money(total)}
      </Button>
    </View>
  );
}
