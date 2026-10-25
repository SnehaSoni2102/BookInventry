import { useShelfMap } from '@bookstall/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Dialog, Portal, ProgressBar, Text } from 'react-native-paper';
import { ErrorBox, Loading, Screen, styles } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { errorMessage } from '@bookstall/api-client';
import type { ShelfMapRow } from '@bookstall/shared';

/** Occupancy map in read mode (shelf set-up lives in the web app). */
export default function Shelves() {
  const map = useShelfMap();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [open, setOpen] = useState<ShelfMapRow | null>(null);
  const slots = useQuery({ queryKey: ['shelves', 'slots', open?.id], queryFn: () => api.shelves.slots(open!.id), enabled: Boolean(open) });
  const unshelved = useQuery({ queryKey: ['shelves', 'unshelved'], queryFn: () => api.shelves.unshelved({ pageSize: 1 }) });

  return (
    <Screen onRefresh={() => void map.refetch()} refreshing={map.isRefetching}>
      {map.isLoading && <Loading />}
      {map.isError && <ErrorBox error={map.error} />}
      {(unshelved.data?.total ?? 0) > 0 && (
        <Card style={{ backgroundColor: '#fff3cd' }}><Card.Content style={{ gap: 6 }}>
          <Text>{unshelved.data!.total} book(s) have no shelf slot.</Text>
          {can('copy.update') && <Button mode="contained-tonal" onPress={async () => { try { const r = await api.shelves.placeUnshelved(); Alert.alert('Done', `${r.placed} placed, ${r.stillUnshelved} still without a slot`); await qc.invalidateQueries(); } catch (e) { Alert.alert('Failed', errorMessage(e)); } }}>Try placing now</Button>}
        </Card.Content></Card>
      )}
      {map.data?.map((rack) => (
        <View key={rack.id} style={{ gap: 6 }}>
          <Text variant="titleMedium">Rack {rack.code}</Text>
          {rack.rows.map((r) => (
            <Card key={r.id} onPress={() => setOpen(r)} style={{ borderLeftWidth: 6, borderLeftColor: r.genre?.color ?? '#adb5bd' }}>
              <Card.Content style={{ gap: 4 }}>
                <View style={styles.between}><Text variant="titleSmall">{r.code}{r.isOverflow ? ' · overflow' : ''}</Text><Text variant="bodySmall">{r.genre ? `${r.genre.code}` : 'no genre'} · {r.used}/{r.capacity}</Text></View>
                <ProgressBar progress={Math.min(1, r.percentFull / 100)} color={r.percentFull >= 90 ? '#e03131' : r.percentFull >= 70 ? '#f08c00' : '#B8763F'} />
              </Card.Content>
            </Card>
          ))}
        </View>
      ))}
      <Portal>
        <Dialog visible={Boolean(open)} onDismiss={() => setOpen(null)}>
          <Dialog.Title>Row {open?.code}</Dialog.Title>
          <Dialog.Content>
            {slots.isLoading ? <Loading /> : (
              <View style={styles.wrap}>
                {slots.data?.slots.map((s) => <View key={s.slot} style={{ width: 30, height: 30, borderRadius: 4, borderWidth: 1, borderColor: '#ced4da', alignItems: 'center', justifyContent: 'center', backgroundColor: !s.copy ? 'transparent' : s.copy.status === 'AT_STALL' ? '#e5dbff' : '#d0ebff' }}><Text variant="labelSmall">{s.slot}</Text></View>)}
              </View>
            )}
            <Text variant="bodySmall" style={{ marginTop: 8, opacity: 0.7 }}>Blue: filled · purple: reserved while out at a stall · blank: empty</Text>
          </Dialog.Content>
        </Dialog>
      </Portal>
    </Screen>
  );
}
