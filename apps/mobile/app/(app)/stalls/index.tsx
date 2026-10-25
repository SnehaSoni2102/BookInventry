import { useStalls } from '@bookstall/api-client';
import { router } from 'expo-router';
import { Card, Chip, FAB, Text } from 'react-native-paper';
import { View } from 'react-native';
import { Empty, ErrorBox, Loading, Screen, styles } from '../../../src/components/ui';
import { useAuth } from '../../../src/lib/auth';
import { useFormat } from '../../../src/lib/format';

export default function StallList() {
  const q = useStalls();
  const { can } = useAuth();
  const fmt = useFormat();
  return (
    <View style={styles.fill}>
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {q.isLoading && <Loading />}
        {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
        {q.data?.length === 0 && <Empty title="No stalls yet" />}
        {q.data?.map((s) => (
          <Card key={s.id} onPress={() => router.push(`/stalls/${s.id}`)}>
            <Card.Content style={{ gap: 4 }}>
              <View style={styles.between}><Text variant="titleMedium">{s.name}</Text><Chip compact>{s.status.toLowerCase()}</Chip></View>
              <Text variant="bodySmall" style={{ opacity: 0.7 }}>{s.managers.map((m) => m.displayName).join(', ') || 'No manager'}</Text>
              <Text variant="bodyMedium">{s.counts.atStall} out · {s.counts.sold} sold · {fmt.money(s.counts.revenueMinor)}</Text>
            </Card.Content>
          </Card>
        ))}
      </Screen>
      {can('stall.manage') && <FAB icon="plus" label="New stall" style={{ position: 'absolute', right: 16, bottom: 16 }} onPress={() => router.push('/stalls/new')} />}
    </View>
  );
}
