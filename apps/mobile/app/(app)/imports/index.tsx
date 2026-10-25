import { errorMessage, qk } from '@bookstall/api-client';
import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { Empty, Loading, Screen, styles } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { shareFile } from '../../../src/lib/print';

export default function ImportList() {
  const q = useQuery({ queryKey: qk.imports.list(), queryFn: () => api.imports.list({ pageSize: 25 }), refetchInterval: (query) => (query.state.data?.items.some((j) => j.status === 'VALIDATING' || j.status === 'COMMITTING') ? 3000 : false) });
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'], copyToCacheDirectory: true });
    const file = res.assets?.[0];
    if (res.canceled || !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as unknown as Blob);
      const { jobId } = await api.imports.upload(fd);
      router.push(`/imports/${jobId}`);
    } catch (e) {
      Alert.alert('Upload failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Button mode="contained" icon="file-excel" onPress={pick} loading={busy}>Choose an .xlsx file</Button>
      <Button mode="outlined" icon="download" onPress={async () => shareFile(await api.imports.template(), 'bookstall-import-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Get the template</Button>
      {q.isLoading && <Loading />}
      {q.data?.items.length === 0 && <Empty title="No imports yet" />}
      {q.data?.items.map((j) => (
        <Card key={j.id} onPress={() => router.push(`/imports/${j.id}`)}>
          <Card.Content style={styles.between}><View2 j={j} /></Card.Content>
        </Card>
      ))}
    </Screen>
  );
}

function View2({ j }: { j: { originalName: string; status: string; totalRows: number; copiesCreated: number } }) {
  return (
    <>
      <Text style={{ flex: 1 }} numberOfLines={1}>{j.originalName}</Text>
      <Text variant="bodySmall">{j.totalRows} rows</Text>
      <Chip compact>{j.status.toLowerCase()}</Chip>
    </>
  );
}
