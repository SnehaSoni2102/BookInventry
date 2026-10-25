import { Stack } from 'expo-router';
import { useAuth } from '../../../src/lib/auth';

export default function InventoryLayout() {
  const { can } = useAuth();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: can('inventory.read') ? 'Inventory' : 'My stall' }} />
      <Stack.Screen name="[titleId]" options={{ title: 'Book' }} />
    </Stack>
  );
}
