import { router } from 'expo-router';
import { Alert } from 'react-native';
import { Divider, List, Text } from 'react-native-paper';
import { Screen } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { useCart } from '../../src/lib/cart';

type Item = { title: string; icon: string; to: string; show: boolean };

export default function More() {
  const { me, can, logout } = useAuth();
  const cart = useCart();
  const canSell = can('sale.create.central') || can('sale.create.stall');
  const items: Item[] = [
    { title: `Cart${cart.items.length ? ` (${cart.items.length})` : ''}`, icon: 'cart-outline', to: '/cart', show: canSell },
    { title: 'Sales', icon: 'cash-multiple', to: '/sales', show: can('sale.read.all') },
    { title: 'Stalls', icon: 'storefront-outline', to: '/stalls', show: can('stall.manage') || can('stall.checkout') || can('stall.checkin') },
    { title: 'Label queue', icon: 'printer', to: '/labels', show: can('label.print') && can('inventory.read') },
    { title: 'Bulk import', icon: 'file-excel-outline', to: '/imports', show: can('import.manage') },
    { title: 'Shelves', icon: 'view-grid-outline', to: '/shelves', show: can('shelf.manage') || can('inventory.read') },
    { title: 'Users', icon: 'account-group-outline', to: '/users', show: can('user.manage') },
    { title: 'Settings', icon: 'cog-outline', to: '/settings', show: can('settings.manage') },
    { title: 'Change password', icon: 'key-outline', to: '/change-password', show: true },
  ];
  return (
    <Screen>
      <Text variant="titleMedium">{me?.user.displayName} · {me?.user.role.replace('_', ' ').toLowerCase()}</Text>
      <Divider />
      {items.filter((i) => i.show).map((i) => <List.Item key={i.to} title={i.title} left={(p) => <List.Icon {...p} icon={i.icon} />} onPress={() => router.push(i.to as never)} />)}
      <Divider />
      <List.Item title="Sign out" titleStyle={{ color: '#c92a2a' }} left={(p) => <List.Icon {...p} icon="logout" color="#c92a2a" />} onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void logout() }])} />
    </Screen>
  );
}
