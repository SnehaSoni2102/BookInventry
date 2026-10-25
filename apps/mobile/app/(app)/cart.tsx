import { Screen, Empty } from '../../src/components/ui';
import { SaleForm } from '../../src/components/SaleForm';
import { useCart } from '../../src/lib/cart';
import { router } from 'expo-router';
import { Button } from 'react-native-paper';
import { useState } from 'react';

export default function CartScreen() {
  const cart = useCart();
  const [unavailable, setUnavailable] = useState<string[]>([]);
  return (
    <Screen>
      {cart.items.length === 0 && <Empty title="The cart is empty" hint="Scan a book to add it to the sale." />}
      <SaleForm items={cart.items} onRemove={cart.remove} unavailable={unavailable} onUnavailable={setUnavailable} onSold={() => { cart.clear(); setUnavailable([]); }} onNewSale={() => router.push('/scan')} />
      {cart.items.length > 0 && <Button onPress={() => router.push({ pathname: '/scan', params: { mode: 'sell' } })}>Scan more books</Button>}
    </Screen>
  );
}
