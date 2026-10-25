import { Stack } from 'expo-router';

export default function ImportsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Bulk import' }} />
      <Stack.Screen name="[id]" options={{ title: 'Import' }} />
    </Stack>
  );
}
