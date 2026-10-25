import { errorMessage, qk } from '@bookstall/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Chip, Divider, SegmentedButtons, Text } from 'react-native-paper';
import { ErrorBox, Loading, Screen, styles } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { useAuth } from '../../../src/lib/auth';
import { useFormat } from '../../../src/lib/format';
import { sharePdf, shareFile } from '../../../src/lib/print';

export default function StallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = String(id);
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.stalls.one(sid), queryFn: () => api.stalls.get(sid) });
  const recon = useQuery({ queryKey: qk.stalls.recon(sid), queryFn: () => api.stalls.reconciliation(sid), enabled: can('stall.manage') });
  const [mode, setMode] = useState<'LOST' | 'KEEP_OPEN'>('LOST');
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.stalls.all() });
  const manage = can('stall.manage');
  const s = q.data;
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !s) return <Screen><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const r = recon.data;
  const missing = r?.stillOut.length ?? 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refresh(); } catch (e) { Alert.alert('Not done', errorMessage(e)); } finally { setBusy(false); }
  };
  const confirm = (title: string, message: string, onYes: () => void) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: onYes }]);

  return (
    <Screen onRefresh={() => { void q.refetch(); void recon.refetch(); }} refreshing={q.isRefetching}>
      <View style={styles.between}><Text variant="headlineSmall">{s.name}</Text><Chip>{s.status.toLowerCase()}</Chip></View>
      <Text style={{ opacity: 0.7 }}>{[s.location, s.startsOn && `from ${s.startsOn}`, s.endsOn && `to ${s.endsOn}`].filter(Boolean).join(' · ')}</Text>

      <View style={styles.wrap}>
        <Chip icon="book-arrow-right">{s.counts.atStall} out</Chip><Chip icon="check">{s.counts.sold} sold</Chip><Chip icon="cash">{fmt.money(s.counts.revenueMinor)}</Chip>
      </View>
      {r && <Text variant="bodySmall">{(['CASH', 'UPI', 'CARD', 'OTHER'] as const).map((m) => `${m} ${fmt.money(r.byPaymentMethod[m])}`).join(' · ')}</Text>}

      <View style={styles.wrap}>
        {can('stall.checkout') && s.status !== 'CLOSED' && <Button mode="contained" icon="barcode-scan" onPress={() => router.push({ pathname: '/scan', params: { mode: 'checkout' } })}>Check out</Button>}
        {can('stall.checkin') && <Button mode="outlined" icon="arrow-down-box" onPress={() => router.push({ pathname: '/scan', params: { mode: 'checkin' } })}>Check in</Button>}
        {manage && s.status === 'PLANNED' && <Button mode="outlined" onPress={() => void act(() => api.stalls.activate(sid))} loading={busy}>Activate</Button>}
      </View>

      <Divider />
      <Text variant="titleMedium">Managers</Text>
      {s.managers.length === 0 && <Text style={{ opacity: 0.7 }}>Nobody assigned.</Text>}
      {s.managers.map((m) => (
        <View key={m.id} style={styles.between}>
          <Text style={{ flex: 1 }}>{m.displayName} ({m.username})</Text>
          {manage && <Button compact onPress={() => confirm('Reset password?', `${m.displayName} must choose a new password. The new one is shown once.`, async () => { try { const x = await api.users.resetPassword(m.id); Alert.alert('Temporary password', `${m.username}\n${x.temporaryPassword}\n\nShown only once.`); } catch (e) { Alert.alert('Failed', errorMessage(e)); } })}>Reset</Button>}
          {manage && <Button compact textColor="#c92a2a" onPress={() => confirm('Remove manager?', `${m.displayName} can no longer sell here.`, () => void act(() => api.stalls.unassign(sid, m.id)))}>Remove</Button>}
        </View>
      ))}

      {manage && r && (
        <>
          <Divider />
          <Text variant="titleMedium">{s.status === 'CLOSED' ? 'Report' : 'Reconcile & close'}</Text>
          <View style={styles.wrap}><Chip>Sent {r.sent}</Chip><Chip>Sold {r.sold}</Chip><Chip>Returned {r.returned}</Chip><Chip>Missing {missing + r.lost}</Chip></View>
          {s.status !== 'CLOSED' && (
            <>
              {missing > 0 ? r.stillOut.slice(0, 15).map((b) => <Text key={b.copyId} variant="bodySmall">{b.locationCode ?? 'unshelved'} · {b.code} · {b.title}</Text>) : <Text>Every book is accounted for.</Text>}
              {missing > 0 && <Text variant="bodySmall" style={{ opacity: 0.7 }}>Scan returned books on the Check in tab; they leave this list.</Text>}
              <SegmentedButtons value={mode} onValueChange={(v) => setMode(v as typeof mode)} buttons={[{ value: 'LOST', label: 'Mark lost' }, { value: 'KEEP_OPEN', label: 'Keep as out' }]} />
              <Button mode="contained" buttonColor="#c92a2a" loading={busy} onPress={() => confirm(`Close ${s.name}?`, mode === 'LOST' ? `${missing} unreturned book(s) will be written off as lost.` : 'Unreturned books stay marked as out.', () => void act(() => api.stalls.close(sid, { markRemainingAs: mode })))}>Close stall</Button>
            </>
          )}
          <View style={styles.wrap}>
            <Button mode="outlined" onPress={async () => sharePdf(await api.stalls.reportPdf(sid), 'stall-report.pdf', 'Stall report')}>Share PDF report</Button>
            <Button mode="outlined" onPress={async () => shareFile(await api.stalls.reportXlsx(sid), 'stall-report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Share Excel</Button>
          </View>
        </>
      )}
      {!manage && <Card><Card.Content><Text>Only administrators can reconcile and close stalls.</Text></Card.Content></Card>}
    </Screen>
  );
}
