import { qk } from '@bookstall/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, List } from 'react-native-paper';
import { LabelSheet } from '../../src/components/LabelSheet';
import { Empty, ErrorBox, Loading, Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useFormat } from '../../src/lib/format';

export default function LabelQueue() {
  const fmt = useFormat();
  const q = useQuery({ queryKey: qk.labels.queue({ m: true }), queryFn: () => api.labels.queue({ pageSize: 100 }) });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const ids = sel.size ? [...sel] : items.map((i) => i.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} />}
      {q.data && items.length === 0 && <Empty title="All labels are printed" />}
      <View>
        {items.map((i) => (
          <List.Item key={i.id} title={i.title} description={`${i.code} · ${i.locationCode ?? 'unshelved'} · ${fmt.money(i.sellingPriceMinor)}`} left={() => <Checkbox status={sel.has(i.id) ? 'checked' : 'unchecked'} onPress={() => toggle(i.id)} />} onPress={() => toggle(i.id)} />
        ))}
      </View>
      <Button mode="contained" disabled={!items.length} onPress={() => setOpen(true)}>Print {sel.size ? `${sel.size} selected` : `all ${items.length}`}</Button>
      <LabelSheet visible={open} onClose={() => setOpen(false)} copyIds={ids} onPrinted={() => { setSel(new Set()); void q.refetch(); }} />
    </Screen>
  );
}
