import { useDashboard } from '@bookstall/api-client';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { Empty, ErrorBox, Loading, Screen, styles } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { useFormat } from '../../src/lib/format';

function Stat({ label, value, onPress }: { label: string; value: string | number; onPress?: () => void }) {
  return (
    <Card style={{ flexGrow: 1, minWidth: '45%' }} onPress={onPress}>
      <Card.Content>
        <Text variant="labelSmall" style={{ opacity: 0.6 }}>{label.toUpperCase()}</Text>
        <Text variant="headlineSmall" style={{ fontWeight: '700' }}>{value}</Text>
      </Card.Content>
    </Card>
  );
}

export default function Home() {
  const { me, can } = useAuth();
  const q = useDashboard();
  const fmt = useFormat();
  const d = q.data;
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Text variant="headlineSmall">Hello, {me?.user.displayName}</Text>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}

      {d?.myStall && (
        <>
          {d.myStall.stall ? <Text variant="titleMedium">{d.myStall.stall.name} · {d.myStall.stall.status.toLowerCase()}</Text> : <Empty title="No stall assigned" hint="Ask an administrator to assign you to a stall." />}
          <View style={styles.wrap}>
            <Stat label="Books at stall" value={d.myStall.booksAtStall} onPress={() => router.push('/inventory')} />
            <Stat label="Value at stall" value={fmt.money(d.myStall.valueAtStallMinor)} />
            <Stat label="My sales today" value={d.myStall.today.salesCount} onPress={() => router.push('/sales')} />
            <Stat label="My revenue today" value={fmt.money(d.myStall.today.revenueMinor)} />
          </View>
          <Button mode="contained" icon="barcode-scan" contentStyle={{ paddingVertical: 12 }} onPress={() => router.push({ pathname: '/scan', params: { mode: 'sell' } })} disabled={!d.myStall.stall}>Scan to sell</Button>
        </>
      )}

      {d?.inventory && (
        <View style={styles.wrap}>
          <Stat label="In stock" value={d.inventory.inStock} onPress={() => router.push('/inventory')} />
          <Stat label="At stalls" value={d.inventory.atStalls} />
          <Stat label="Unshelved" value={d.inventory.unshelved} onPress={() => router.push('/shelves')} />
          <Stat label="Labels pending" value={d.inventory.labelsPending} onPress={() => router.push('/labels')} />
          {d.salesToday && <Stat label="Revenue today" value={fmt.money(d.salesToday.total.revenueMinor)} onPress={() => router.push('/sales')} />}
        </View>
      )}

      {d?.shelfAlerts && d.shelfAlerts.length > 0 && <Card style={{ backgroundColor: '#fff3cd' }}><Card.Content><Text>Shelf space is low: {d.shelfAlerts.map((a) => `${a.code} ${a.percentFull}%`).join(', ')}</Text></Card.Content></Card>}

      {d?.salesToday && (
        <View style={{ gap: 8 }}>
          <Text variant="titleMedium">Today by stall</Text>
          {[d.salesToday.total && { ...d.salesToday.total, label: 'All sales' }, ...d.salesToday.rows].filter(Boolean).map((r) => (
            <Card key={r!.key}><Card.Content style={styles.between}><View style={{ flex: 1 }}><Text variant="titleSmall">{r!.label}</Text><Text variant="bodySmall" style={{ opacity: 0.6 }}>{r!.itemsCount} book{r!.itemsCount === 1 ? '' : 's'}</Text></View><Text variant="titleMedium">{fmt.money(r!.revenueMinor)}</Text></Card.Content></Card>
          ))}
        </View>
      )}

      {!d?.myStall && (
        <View style={styles.wrap}>
          {can('copy.create') && <Button mode="contained" icon="plus" onPress={() => router.push('/add')}>Add a book</Button>}
          <Button mode="outlined" icon="barcode-scan" onPress={() => router.push('/scan')}>Scan</Button>
          {can('stall.checkin') && <Button mode="outlined" icon="arrow-down-box" onPress={() => router.push({ pathname: '/scan', params: { mode: 'checkin' } })}>Check in</Button>}
        </View>
      )}

      {d?.recentSales && d.recentSales.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text variant="titleMedium">Latest sales</Text>
          {d.recentSales.map((s) => <View key={s.id} style={styles.between}><Text style={{ flex: 1 }}>{s.receiptNo} · {s.soldAtLabel}</Text><Text>{fmt.money(s.totalMinor)}</Text></View>)}
        </View>
      )}
    </Screen>
  );
}
