import { ActionIcon, Badge, Button, Drawer, Indicator, Stack, Text } from '@mantine/core';
import { IconShoppingCart } from '@tabler/icons-react';
import { useState } from 'react';
import { useCart } from '../lib/cart';
import { EmptyState } from './states';
import { SaleForm } from './SaleForm';

/** Header button + drawer holding the current sale. */
export function CartButton() {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  return (
    <>
      <Indicator label={cart.items.length} disabled={!cart.items.length} size={18} color="red" offset={4}>
        <ActionIcon variant="default" size="lg" aria-label={`Cart, ${cart.items.length} items`} onClick={() => setOpen(true)} data-testid="cart-button">
          <IconShoppingCart size={20} />
        </ActionIcon>
      </Indicator>
      <Drawer opened={open} onClose={() => setOpen(false)} position="right" size="md" title={<Text fw={700}>Sale cart {cart.items.length > 0 && <Badge ml={6}>{cart.items.length}</Badge>}</Text>}>
        <Stack>
          {!cart.items.length ? (
            <EmptyState title="The cart is empty">Scan a book, or use “Add to cart” on a book, to start a sale.</EmptyState>
          ) : null}
          <SaleForm
            items={cart.items}
            onRemove={cart.remove}
            unavailable={unavailable}
            onUnavailable={setUnavailable}
            onSold={() => {
              cart.clear();
              setUnavailable([]);
            }}
            onNewSale={() => setOpen(false)}
          />
          {cart.items.length > 0 && <Button variant="subtle" color="red" onClick={() => { cart.clear(); setUnavailable([]); }}>Empty the cart</Button>}
        </Stack>
      </Drawer>
    </>
  );
}
