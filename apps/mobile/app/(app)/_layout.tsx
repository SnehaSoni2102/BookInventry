import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useAuth } from '../../src/lib/auth';
import { useCart } from '../../src/lib/cart';
import { OfflineBanner } from '../../src/lib/network';

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;
const icon = (name: Icon) => ({ color, size }: { color: ColorValue; size: number }) => <MaterialCommunityIcons name={name} color={color as string} size={size} />;

/** Bottom tabs differ by role: staff/admin get Inventory/Add/More; a stall manager gets My stall/Cart/Sales. */
export default function AppTabs() {
  const { can } = useAuth();
  const cart = useCart();
  const manager = !can('inventory.read');
  const hide = { href: null } as const;
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs screenOptions={{ headerTitleAlign: 'left' }}>
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
        <Tabs.Screen name="inventory" options={{ title: manager ? 'My stall' : 'Inventory', headerShown: false, tabBarIcon: icon('bookshelf') }} />
        <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: icon('barcode-scan') }} />
        <Tabs.Screen name="add" options={can('copy.create') ? { title: 'Add', tabBarIcon: icon('plus-circle-outline') } : hide} />
        <Tabs.Screen name="cart" options={manager && can('sale.create.stall') ? { title: 'Cart', tabBarIcon: icon('cart-outline'), tabBarBadge: cart.items.length || undefined } : hide} />
        <Tabs.Screen name="sales" options={manager ? { title: 'Sales', headerShown: false, tabBarIcon: icon('cash-multiple') } : hide} />
        <Tabs.Screen name="more" options={!manager ? { title: 'More', tabBarIcon: icon('dots-horizontal') } : hide} />
        {/* reachable from More / deep links, not shown as tabs */}
        <Tabs.Screen name="copies/[code]" options={{ ...hide, title: 'Book' }} />
        <Tabs.Screen name="stalls" options={{ ...hide, headerShown: false }} />
        <Tabs.Screen name="imports" options={{ ...hide, headerShown: false }} />
        <Tabs.Screen name="labels" options={{ ...hide, title: 'Label queue' }} />
        <Tabs.Screen name="shelves" options={{ ...hide, title: 'Shelves' }} />
        <Tabs.Screen name="users" options={{ ...hide, title: 'Users' }} />
        <Tabs.Screen name="settings" options={{ ...hide, title: 'Settings' }} />
      </Tabs>
    </View>
  );
}
