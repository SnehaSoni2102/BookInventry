import { errorMessage, useCheckout, useStalls } from '@bookstall/api-client';
import type { BookCondition, CheckoutResponse } from '@bookstall/shared';
import { Alert, Button, Group, List, Modal, NumberInput, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import { api } from '../app/api';
import { useFormat } from '../lib/format';
import { openPdf } from '../lib/print';
import { LocationCode } from './LocationCode';

export type CheckoutMode =
  | { kind: 'copies'; copyIds: string[] }
  | { kind: 'group'; titleId: string; title: string; condition: BookCondition; sellingPriceMinor: number; max: number };

interface Props {
  opened: boolean;
  onClose: () => void;
  mode: CheckoutMode;
  /** Pre-select a stall (e.g. when opened from the stall page). */
  stallId?: string;
  onDone?: (res: CheckoutResponse) => void;
}

export function CheckoutDialog({ opened, onClose, mode, stallId: presetStall, onDone }: Props) {
  const fmt = useFormat();
  const stalls = useStalls();
  const [stallId, setStallId] = useState<string | null>(presetStall ?? null);
  const [qty, setQty] = useState<number | string>(1);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const clientRef = useRef(crypto.randomUUID());
  const checkout = useCheckout(stallId ?? '');

  const options = (stalls.data ?? []).filter((s) => s.status !== 'CLOSED').map((s) => ({ value: s.id, label: `${s.name}${s.status === 'PLANNED' ? ' (planned)' : ''}` }));
  const count = mode.kind === 'copies' ? mode.copyIds.length : Number(qty) || 0;

  const submit = async () => {
    if (!stallId) return;
    try {
      const res = await checkout.mutateAsync(
        mode.kind === 'copies'
          ? { clientRef: clientRef.current, copyIds: mode.copyIds }
          : { clientRef: clientRef.current, groups: [{ titleId: mode.titleId, condition: mode.condition, sellingPriceMinor: mode.sellingPriceMinor, quantity: Number(qty) }] },
      );
      setResult(res);
      onDone?.(res);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Checkout failed', message: errorMessage(e) });
    }
  };
  const close = () => {
    setResult(null);
    clientRef.current = crypto.randomUUID();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="Check out to a stall" centered size="lg">
      {!result ? (
        <Stack>
          <Select label="Stall" placeholder="Choose a stall" data={options} value={stallId} onChange={setStallId} searchable allowDeselect={false} error={stalls.isSuccess && !options.length ? 'Create a stall first' : undefined} />
          {mode.kind === 'group' ? (
            <>
              <Text size="sm">{mode.title} · {mode.condition.replace('_', ' ').toLowerCase()} · {fmt.money(mode.sellingPriceMinor)}</Text>
              <NumberInput label="How many copies?" description={`${mode.max} available. The system picks them in shelf order.`} min={1} max={mode.max} allowDecimal={false} value={qty} onChange={setQty} />
            </>
          ) : (
            <Text size="sm">{mode.copyIds.length} selected book{mode.copyIds.length === 1 ? '' : 's'}</Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={!stallId || count < 1} loading={checkout.isPending}>Check out {count || ''} book{count === 1 ? '' : 's'}</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Alert color={result.failed.length ? 'yellow' : 'green'} title={`${result.checkedOut.length} book${result.checkedOut.length === 1 ? '' : 's'} checked out`}>
            {result.failed.length > 0 && `${result.failed.length} could not be checked out.`}
          </Alert>
          {result.failed.length > 0 && (
            <List size="sm" c="red">
              {result.failed.map((f, i) => (
                <List.Item key={i}>
                  {f.code ?? f.copyId ?? 'A group'}: {f.reason === 'INSUFFICIENT_STOCK' ? `only ${f.available} available` : f.reason === 'COPY_NOT_AVAILABLE' ? 'not available' : 'not found'}
                </List.Item>
              ))}
            </List>
          )}
          <Text size="sm" fw={600}>Collect from the shelves (in walking order):</Text>
          <List size="sm" spacing={4} style={{ maxHeight: 220, overflow: 'auto' }}>
            {result.checkedOut.map((c) => <List.Item key={c.copyId}><LocationCode code={c.locationCode} /> {c.code} · {c.title}</List.Item>)}
          </List>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Done</Button>
            {result.checkedOut.length > 0 && stallId && <Button onClick={() => void openPdf(() => api.stalls.pickList(stallId, result.batchId))}>Pick list (PDF)</Button>}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
