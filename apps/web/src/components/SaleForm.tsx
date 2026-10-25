import { ApiError, errorMessage } from '@bookstall/api-client';
import { ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Collapse, Divider, Group, NumberInput, SegmentedControl, Stack, Switch, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPrinter, IconShare, IconTrash } from '@tabler/icons-react';
import type { PaymentMethod, SaleDto } from '@bookstall/shared';
import { parseMoneyToMinor } from '@bookstall/shared';
import { useCreateSale } from '@bookstall/api-client';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../app/api';
import { useAuth } from '../app/auth';
import type { CartItem } from '../lib/cart';
import { useFormat } from '../lib/format';
import { feedback } from '../lib/audio';
import { printBlob } from '../lib/print';
import { LocationCode } from './LocationCode';

interface Props {
  items: CartItem[];
  onRemove?: (copyId: string) => void;
  /** Books that the server said are no longer available (highlighted so the user can remove them). */
  unavailable?: string[];
  onUnavailable?: (codes: string[]) => void;
  onSold: (sale: SaleDto) => void;
  onNewSale: () => void;
}

const METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'OTHER'];

/**
 * Payment + confirm for one or many books, then the receipt screen.
 * The clientRef is created once per sale attempt, so a retry after a flaky network can never double-sell.
 */
export function SaleForm({ items, onRemove, unavailable = [], onUnavailable, onSold, onNewSale }: Props) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const create = useCreateSale();
  const clientRef = useRef(crypto.randomUUID());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [override, setOverride] = useState(false);
  const [prices, setPrices] = useState<Record<string, number | string>>({});
  const [confirmAtStall, setConfirmAtStall] = useState(false);
  const [needsStallConfirm, setNeedsStallConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SaleDto | null>(null);

  const isAdmin = can('sale.create.central');
  const effective = (i: CartItem) => {
    if (!override) return i.sellingPriceMinor;
    const raw = prices[i.copyId];
    if (raw === undefined || raw === '') return i.sellingPriceMinor;
    return parseMoneyToMinor(String(raw)) ?? i.sellingPriceMinor;
  };
  const total = items.reduce((a, i) => a + effective(i), 0);
  const atStall = items.find((i) => i.stallName);

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
        const d = e.details as { requiresConfirm?: string; stall?: { name: string }; codes?: string[] } | undefined;
        if (d?.requiresConfirm === 'COPY_AT_STALL') {
          setNeedsStallConfirm(d.stall?.name ?? 'a stall');
          return;
        }
        if (d?.codes) onUnavailable?.(d.codes);
      }
      // A failed attempt was rolled back on the server, so a fresh id is safe for the next try after edits.
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) clientRef.current = crypto.randomUUID();
      setError(errorMessage(e));
    }
  };

  if (done) {
    const share = async () => {
      const text = `${done.receiptNo}: ${done.items.map((i) => i.title).join(', ')}. Total ${fmt.money(done.totalMinor)} (${t(`payment.${done.paymentMethod}`)}). Thank you!`;
      try {
        if (navigator.share) await navigator.share({ title: `Receipt ${done.receiptNo}`, text });
        else {
          await navigator.clipboard.writeText(text);
          notifications.show({ message: 'Receipt text copied', color: 'blue' });
        }
      } catch {
        /* user dismissed the share sheet */
      }
    };
    return (
      <Stack align="center" gap="sm" py="md" data-testid="sale-success">
        <Badge size="xl" color="green" variant="light">Sale recorded</Badge>
        <Text size="xl" fw={700}>{done.receiptNo}</Text>
        <Text size="lg">{fmt.money(done.totalMinor)} · {t(`payment.${done.paymentMethod}`)}</Text>
        <Text size="sm" c="dimmed">{done.items.length} book{done.items.length === 1 ? '' : 's'} · {done.soldAtLabel}</Text>
        <Group>
          <Button leftSection={<IconPrinter size={16} />} variant="default" onClick={async () => printBlob(await api.sales.receipt(done.id))}>Print receipt</Button>
          <Button leftSection={<IconShare size={16} />} variant="default" onClick={share}>Share</Button>
        </Group>
        <Button onClick={onNewSale} size="md">New sale</Button>
      </Stack>
    );
  }

  return (
    <Stack>
      <Stack gap={6}>
        {items.map((i) => (
          <Group key={i.copyId} justify="space-between" wrap="nowrap" align="flex-start" style={unavailable.includes(i.code) ? { background: 'var(--mantine-color-red-light)', borderRadius: 6, padding: 4 } : undefined}>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size="sm" lineClamp={2}>{i.title}</Text>
              <Group gap={6}>
                <Text size="xs" c="dimmed">{i.code}</Text>
                <Text size="xs" c="dimmed">{t(`condition.${i.condition}`)}</Text>
                {i.stallName ? <Badge size="xs" color="violet" variant="light">{i.stallName}</Badge> : <LocationCode code={i.locationCode} />}
                {unavailable.includes(i.code) && <Badge size="xs" color="red">No longer available</Badge>}
              </Group>
            </div>
            <Group gap={6} wrap="nowrap">
              {override ? (
                <NumberInput aria-label={`Price for ${i.code}`} w={100} size="xs" prefix="₹" min={0} decimalScale={2} value={prices[i.copyId] ?? i.sellingPriceMinor / 100} onChange={(v) => setPrices((p) => ({ ...p, [i.copyId]: v }))} />
              ) : (
                <Text fw={600}>{fmt.money(i.sellingPriceMinor)}</Text>
              )}
              {onRemove && <ActionIcon variant="subtle" color="red" aria-label={`Remove ${i.code}`} onClick={() => onRemove(i.copyId)}><IconTrash size={16} /></ActionIcon>}
            </Group>
          </Group>
        ))}
      </Stack>
      <Divider />
      <Group justify="space-between">
        <Text fw={700} size="lg">Total</Text>
        <Text fw={700} size="xl" data-testid="sale-total">{fmt.money(total)}</Text>
      </Group>

      <SegmentedControl fullWidth size="md" value={method} onChange={(v) => setMethod(v as PaymentMethod)} data={METHODS.map((m) => ({ value: m, label: t(`payment.${m}`) }))} aria-label="Payment method" />

      {isAdmin && <Switch label="Override price" description="Only admins can change the price at the point of sale. This is recorded." checked={override} onChange={(e) => setOverride(e.currentTarget.checked)} />}
      {!isAdmin && <Text size="xs" c="dimmed">Books are always sold at the marked price.</Text>}

      <Anchor component="button" type="button" size="sm" onClick={() => setCustomer((c) => (c.name || c.phone ? c : { name: ' ', phone: '' }))}>Add customer details (optional)</Anchor>
      <Collapse expanded={Boolean(customer.name || customer.phone)}>
        <Group grow>
          <TextInput label="Name" value={customer.name.trim() ? customer.name : ''} onChange={(e) => setCustomer((c) => ({ ...c, name: e.currentTarget.value }))} />
          <TextInput label="Phone" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.currentTarget.value }))} />
        </Group>
      </Collapse>

      {isAdmin && atStall && (
        <Checkbox checked={confirmAtStall} onChange={(e) => setConfirmAtStall(e.currentTarget.checked)} label={`This book is at ${atStall.stallName}. Record the sale as Admin @ ${atStall.stallName}.`} />
      )}
      {needsStallConfirm && !confirmAtStall && (
        <Alert color="yellow" title="Confirm stall sale">
          These books are at <b>{needsStallConfirm}</b>. Tick the box above to record the sale against that stall.
        </Alert>
      )}
      {error && <Alert color="red" role="alert">{error}</Alert>}

      <Button size="lg" onClick={submit} loading={create.isPending} disabled={!items.length || (isAdmin && Boolean(atStall) && !confirmAtStall)}>
        Confirm sale · {fmt.money(total)}
      </Button>
    </Stack>
  );
}
