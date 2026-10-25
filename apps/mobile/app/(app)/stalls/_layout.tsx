import { Stack } from 'expo-router';

export default function StallsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Stalls' }} />
      <Stack.Screen name="new" options={{ title: 'New stall' }} />
      <Stack.Screen name="[id]" options={{ title: 'Stall' }} />
      <Stack.Screen name="checkout" options={{ title: 'Check out to a stall' }} />
    </Stack>
  );
}
