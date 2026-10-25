import { errorMessage } from '@bookstall/api-client';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children, onRefresh, refreshing, scroll = true, style }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.pad, style]} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginVertical: 32 }} accessibilityLabel="Loading" />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: theme.colors.errorContainer }]} accessibilityRole="alert">
      <Text style={{ color: theme.colors.onErrorContainer }}>{errorMessage(error)}</Text>
      {onRetry && <Button onPress={onRetry}>Try again</Button>}
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text variant="titleMedium">{title}</Text>
      {hint ? <Text variant="bodyMedium" style={{ opacity: 0.7, textAlign: 'center' }}>{hint}</Text> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  box: { padding: 12, borderRadius: 8, gap: 8 },
  empty: { alignItems: 'center', padding: 32, gap: 6 },
});
