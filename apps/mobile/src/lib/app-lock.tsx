import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useAuth } from './auth';

/**
 * Locks the app behind the device PIN / fingerprint after `session.autoLockMinutes` in the background
 * (shared stall phones). If the phone has no screen lock set up, there is nothing to unlock with, so it stays open.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const minutes = me?.settings.autoLockMinutes ?? 0;
  const [locked, setLocked] = useState(false);
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'authed' || !minutes) return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'background' || s === 'inactive') leftAt.current ??= Date.now();
      else if (s === 'active' && leftAt.current !== null) {
        const away = Date.now() - leftAt.current;
        leftAt.current = null;
        if (away >= minutes * 60_000 && (await LocalAuthentication.isEnrolledAsync().catch(() => false))) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [status, minutes]);

  const unlock = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Bookstall', cancelLabel: 'Cancel' }).catch(() => ({ success: false }));
    if (res.success) setLocked(false);
  }, []);
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
      <Text variant="headlineSmall">Bookstall is locked</Text>
      <Button mode="contained" onPress={unlock}>Unlock</Button>
    </View>
  );
}
