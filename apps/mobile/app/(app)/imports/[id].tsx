import { errorMessage, qk } from '@bookstall/api-client';
import type { ImportRowStatus } from '@bookstall/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Chip, ProgressBar, SegmentedButtons, Switch, Text } from 'react-native-paper';
import { Empty, ErrorBox, Loading, Screen, styles } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { useFormat } from '../../../src/lib/format';
import { printPdf, shareFile } from '../../../src/lib/print';

export default function ImportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jid = String(id);
  const fmt = useFormat();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | ImportRowStatus>('ERROR');
  const [skip, setSkip] = useState(false);
  const job = useQuery({ queryKey: qk.imports.one(jid), queryFn: () => api.imports.get(jid), refetchInterval: (q) => (['UPLOADED', 'VALIDATING', 'COMMITTING'].includes(q.state.data?.status ?? '') ? 2000 : false) });
  const j = job.data;
  const ready = j && !['UPLOADED', 'VALIDATING', 'FAILED'].includes(j.status);
  const rows = useQuery({ queryKey: qk.imports.rows(jid, { filter, st: j?.status }), queryFn: () => api.imports.rows(jid, { pageSize: 50, ...(filter !== 'ALL' ? { status: filter } : {}) }), enabled: Boolean(ready) });
  if (job.isLoading) return <Screen><Loading /></Screen>;
  if (job.isError || !j) return <Screen><ErrorBox error={job.error} /></Screen>;
  const working = ['UPLOADED', 'VALIDATING', 'COMMITTING'].includes(j.status);

  const commit = async () => {
    try { await api.imports.commit(jid, { skipErrors: skip }); await qc.invalidateQueries({ queryKey: qk.imports.all() }); } catch (e) { Alert.alert('Cannot commit', errorMessage(e)); }
  };

  return (
    <Screen onRefresh={() => void job.refetch()} refreshing={job.isRefetching}>
      <Text variant="titleLarge" numberOfLines={2}>{j.originalName}</Text>
      <Chip style={{ alignSelf: 'flex-start' }}>{j.status.toLowerCase()}</Chip>
      {j.status === 'FAILED' && <Card style={{ backgroundColor: '#ffe3e3' }}><Card.Content><Text>{j.errorMessage}</Text></Card.Content></Card>}
      {working && <><Text>{j.status === 'COMMITTING' ? `Adding books… ${j.processedRows} of ${j.totalRows}` : 'Checking the file and looking up books…'}</Text><ProgressBar indeterminate={j.status !== 'COMMITTING'} progress={j.totalRows ? j.processedRows / j.totalRows : 0} /></>}
      {ready && (
        <View style={styles.wrap}><Chip>{j.totalRows} rows</Chip><Chip>{j.validRows} ready</Chip><Chip>{j.warningRows} warnings</Chip><Chip textStyle={j.errorRows ? { color: '#c92a2a' } : undefined}>{j.errorRows} errors</Chip>{j.copiesCreated > 0 && <Chip>{j.copiesCreated} copies</Chip>}</View>
      )}
      {j.status === 'READY' && (
        <View style={{ gap: 8 }}>
          {j.errorRows > 0 && <View style={styles.between}><Text style={{ flex: 1 }}>Skip the {j.errorRows} row(s) with errors</Text><Switch value={skip} onValueChange={setSkip} /></View>}
          <Button mode="contained" onPress={commit} disabled={j.errorRows > 0 && !skip}>Add {j.validRows + j.warningRows} rows to the inventory</Button>
          <Text variant="bodySmall" style={{ opacity: 0.7 }}>To fix rows, edit the Excel file and upload it again, or use the web app's row editor.</Text>
        </View>
      )}
      {j.status === 'COMPLETED' && (
        <View style={{ gap: 8 }}>
          <Button mode="contained" icon="printer" onPress={async () => printPdf(await api.labels.importPdf(jid, 'A4_24'), 'import-labels.pdf')}>Print all labels</Button>
          <Button mode="outlined" onPress={async () => shareFile(await api.imports.result(jid), 'import-result.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Share result file</Button>
        </View>
      )}
      {ready && (
        <>
          <SegmentedButtons density="small" value={filter} onValueChange={(v) => setFilter(v as typeof filter)} buttons={[{ value: 'ERROR', label: 'Errors' }, { value: 'WARNING', label: 'Warnings' }, { value: 'ALL', label: 'All' }]} />
          {rows.data?.items.length === 0 && <Empty title="No rows here" />}
          {rows.data?.items.map((r) => (
            <Card key={r.id}><Card.Content style={{ gap: 2 }}>
              <Text variant="titleSmall">#{r.rowNumber} · {r.preview?.title ?? r.raw.title ?? r.raw.isbn ?? '—'}</Text>
              {r.preview && <Text variant="bodySmall">{r.preview.quantity} × {r.preview.condition.toLowerCase()} · {fmt.money(r.preview.sellingPriceMinor)}</Text>}
              {r.messages.map((m, i) => <Text key={i} variant="bodySmall" style={{ color: m.level === 'error' ? '#c92a2a' : '#e67700' }}>{m.field}: {m.message}</Text>)}
            </Card.Content></Card>
          ))}
        </>
      )}
    </Screen>
  );
}
