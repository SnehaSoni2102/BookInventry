import { Stack } from 'expo-router';
import { useAuth } from '../../../src/lib/auth';

export default function SalesLayout() {
  const { can } = useAuth();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: can('sale.read.all') ? 'Sales' : 'My sales' }} />
      <Stack.Screen name="[id]" options={{ title: 'Sale' }} />
    </Stack>
  );
}
