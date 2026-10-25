import '../src/lib/i18n';
import { ApiProvider } from '@bookstall/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { AppLock } from '../src/lib/app-lock';
import { CartProvider } from '../src/lib/cart';
import { RealtimeBridge } from '../src/lib/realtime';
import { darkTheme, lightTheme } from '../src/lib/theme';

/** Where the user was heading when they had to sign in (e.g. a label scanned with the phone camera). */
let pending: string | null = null;
export const takePending = () => {
  const p = pending;
  pending = null;
  return p;
};

function Gate() {
  const { status, me } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const inAuth = path === '/login' || path === '/change-password';

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anon' && path !== '/login') {
      if (path !== '/' && !path.startsWith('/login')) pending = path;
      router.replace('/login');
    } else if (status === 'authed' && me?.user.mustChangePassword && path !== '/change-password') router.replace('/change-password');
    else if (status === 'authed' && !me?.user.mustChangePassword && inAuth) router.replace((takePending() ?? '/') as never);
  }, [status, me?.user.mustChangePassword, path, inAuth, router]);

  if (status === 'loading') return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => (e as { status?: number })?.status === 0 && n < 2 } },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <ApiProvider api={api}>
          <PaperProvider theme={scheme === 'dark' ? darkTheme : lightTheme}>
            <AuthProvider>
              <CartProvider>
                <RealtimeBridge>
                  <StatusBar style="auto" />
                  <AppLock>
                    <Gate />
                  </AppLock>
                </RealtimeBridge>
              </CartProvider>
            </AuthProvider>
          </PaperProvider>
        </ApiProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
