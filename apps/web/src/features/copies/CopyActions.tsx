import type { CopyAction, CopyDetail } from '@bookstall/shared';
import { errorMessage } from '@bookstall/api-client';
import { Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { CheckoutDialog } from '../../components/CheckoutDialog';
import { confirmAction } from '../../components/confirm';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { SellDialog } from '../../components/SellDialog';
import { useCart } from '../../lib/cart';
import { feedback } from '../../lib/audio';

/** The action bar. Which buttons exist is decided by the server (scan/resolve), not guessed here. */
export function CopyActions({ copy, actions, onChanged }: { copy: CopyDetail; actions: CopyAction[]; onChanged?: () => void }) {
  const { can } = useAuth();
  const cart = useCart();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'sell' | 'checkout' | 'labels' | null>(null);
  const has = (a: CopyAction['action']) => actions.find((x) => x.action === a);
  const sell = has('SELL') as Extract<CopyAction, { action: 'SELL' }> | undefined;
  const checkin = has('CHECKIN') as Extract<CopyAction, { action: 'CHECKIN' }> | undefined;
  const candidate = { copyId: copy.id, code: copy.code, locationCode: copy.locationCode, stallName: copy.stall?.name ?? null };
  const item = { ...candidate, title: copy.title.title, condition: copy.condition, sellingPriceMinor: copy.sellingPriceMinor };

  const doCheckin = async () => {
    try {
      const res = await api.stalls.checkin({ clientRef: crypto.randomUUID(), copyIds: [copy.id] });
      const done = res.checkedIn[0];
      if (!done) throw new Error('This book could not be checked in');
      feedback.success();
      notifications.show({ color: 'green', title: 'Checked in', message: `Put it back at ${done.returnToLocation ?? 'any free space'}${done.relocated ? ' (new place: the old slot was gone)' : ''}`, autoClose: 15000 });
      await qc.invalidateQueries();
      onChanged?.();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Check-in failed', message: errorMessage(e) });
    }
  };

  const writeOff = () =>
    confirmAction({
      title: 'Write off this book?',
      message: `${copy.code} will leave the inventory (damaged / lost / given away). This cannot be undone.`,
      confirmLabel: 'Write off',
      onConfirm: async () => {
        try {
          await api.copies.writeOff(copy.id, { reason: 'DAMAGED' });
          await qc.invalidateQueries();
          notifications.show({ color: 'green', message: 'Written off' });
          navigate('/inventory');
        } catch (e) {
          notifications.show({ color: 'red', message: errorMessage(e) });
        }
      },
    });

  return (
    <>
      <Group gap="xs">
        {sell && <Button onClick={() => setDialog('sell')} size="md" data-testid="action-sell">Sell</Button>}
        {sell && (can('sale.create.central') || can('sale.create.stall')) && (
          <Button variant="light" onClick={() => { const r = cart.add(item); notifications.show(r === 'added' ? { color: 'green', message: 'Added to the cart' } : { color: 'yellow', message: 'Already in the cart' }); }} data-testid="action-add-to-cart">Add to cart</Button>
        )}
        {has('CHECKOUT') && <Button variant="light" onClick={() => setDialog('checkout')} data-testid="action-checkout">Check out to stall</Button>}
        {checkin && <Button variant="light" color="violet" onClick={doCheckin} data-testid="action-checkin">Check in from {checkin.stall.name}</Button>}
        {has('PRINT_LABEL') && <Button variant="default" onClick={() => setDialog('labels')}>Print label</Button>}
        {has('WRITE_OFF') && <Button variant="subtle" color="red" onClick={writeOff}>Write off</Button>}
      </Group>
      {sell && (
        <SellDialog
          opened={dialog === 'sell'}
          onClose={() => { setDialog(null); onChanged?.(); }}
          title={copy.title.title}
          condition={copy.condition}
          sellingPriceMinor={copy.sellingPriceMinor}
          candidates={[candidate]}
        />
      )}
      {has('CHECKOUT') && <CheckoutDialog opened={dialog === 'checkout'} onClose={() => { setDialog(null); onChanged?.(); }} mode={{ kind: 'copies', copyIds: [copy.id] }} />}
      <LabelPrintDialog opened={dialog === 'labels'} onClose={() => setDialog(null)} copyIds={[copy.id]} canMarkPrinted={can('inventory.read')} onPrinted={onChanged} />
    </>
  );
}
