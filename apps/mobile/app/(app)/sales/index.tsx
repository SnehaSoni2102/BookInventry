import { useSales, useSalesSummary } from '@bookstall/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Card, Chip, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Empty, ErrorBox, Loading, styles } from '../../../src/components/ui';
import { useAuth } from '../../../src/lib/auth';
import { useFormat } from '../../../src/lib/format';

const today = () => new Date().toLocaleDateString('en-CA');

/** Admin: live per-stall totals (updated by the realtime socket) + all sales. Manager: only their own. */
export default function SalesList() {
  const fmt = useFormat();
  const { can } = useAuth();
  const admin = can('sale.read.all');
  const [range, setRange] = useState<'today' | 'all'>('today');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const from = range === 'today' ? today() : undefined;
  const summary = useSalesSummary({ groupBy: 'stall', from, to: from });
  const list = useSales({ q: text.trim() || undefined, from, to: from, page: 1, pageSize: 25 * page });
  const items = list.data?.items ?? [];

  const header = (
    <View style={{ gap: 8, padding: 12 }}>
      <SegmentedButtons density="small" value={range} onValueChange={(v) => { setRange(v as typeof range); setPage(1); }} buttons={[{ value: 'today', label: 'Today' }, { value: 'all', label: 'All time' }]} />
      {summary.isLoading ? <Loading /> : admin ? (
        <View style={{ gap: 6 }}>
          {summary.data && [{ ...summary.data.total, label: 'All sales' }, ...summary.data.rows].map((r) => (
            <Card key={r.key}><Card.Content style={styles.between}><View style={{ flex: 1 }}><Text variant="titleSmall">{r.label}</Text><Text variant="bodySmall" style={{ opacity: 0.6 }}>{r.itemsCount} book{r.itemsCount === 1 ? '' : 's'}{(['CASH', 'UPI', 'CARD', 'OTHER'] as const).filter((m) => r.byPaymentMethod[m] > 0).map((m) => ` · ${m} ${fmt.money(r.byPaymentMethod[m])}`).join('')}</Text></View><Text variant="titleMedium">{fmt.money(r.revenueMinor)}</Text></Card.Content></Card>
          ))}
        </View>
      ) : summary.data ? <Text variant="titleMedium">{summary.data.total.salesCount} sale{summary.data.total.salesCount === 1 ? '' : 's'} · {fmt.money(summary.data.total.revenueMinor)}</Text> : null}
      <Searchbar placeholder="Receipt, book code or title" value={text} onChangeText={setText} />
    </View>
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.fill}>
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); void summary.refetch(); }} />}
        onEndReached={() => list.data && items.length < list.data.total && setPage((p) => p + 1)}
        ListEmptyComponent={<>{list.isLoading ? <Loading /> : list.isError ? <ErrorBox error={list.error} /> : <Empty title="No sales in this period" />}</>}
        renderItem={({ item: s }) => (
          <Card style={{ marginHorizontal: 12, marginBottom: 8 }} onPress={() => router.push(`/sales/${s.id}`)}>
            <Card.Content style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{s.receiptNo} · {s.soldAtLabel}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.7 }}>{fmt.dateTime(s.soldAt)}{admin ? ` · ${s.seller.displayName}` : ''} · {s.itemsCount} book{s.itemsCount === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="titleSmall" style={s.status === 'VOIDED' ? { textDecorationLine: 'line-through' } : undefined}>{fmt.money(s.totalMinor)}</Text>
                {s.status === 'VOIDED' && <Chip compact>voided</Chip>}
              </View>
            </Card.Content>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
