import { errorMessage, qk, useUpdateSettings } from '@bookstall/api-client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Divider, Switch, Text, TextInput } from 'react-native-paper';
import { ErrorBox, Loading, Screen, styles } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';

/** Quick settings. Pricing percentages, public-page fields and shelf set-up are easier on the web app. */
export default function Settings() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: qk.settings(), queryFn: api.settings.get });
  const update = useUpdateSettings();
  const [v, setV] = useState<Record<string, unknown>>({});
  useEffect(() => { if (q.data?.settings) setV(q.data.settings); }, [q.data]);
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorBox error={q.error} /></Screen>;
  if (!can('settings.manage')) return <Screen><Text>Settings are managed by administrators.</Text></Screen>;
  const orig = q.data?.settings ?? {};
  const dirty = Object.keys(v).filter((k) => JSON.stringify(v[k]) !== JSON.stringify(orig[k]));
  const set = (k: string, val: unknown) => setV((s) => ({ ...s, [k]: val }));

  const save = async () => {
    try { await update.mutateAsync(Object.fromEntries(dirty.map((k) => [k, v[k]])) as never); Alert.alert('Saved'); } catch (e) { Alert.alert('Not saved', errorMessage(e)); }
  };
  const toggle = (k: string, label: string, help?: string) => (
    <View style={styles.between}><View style={{ flex: 1 }}><Text>{label}</Text>{help ? <Text variant="bodySmall" style={{ opacity: 0.7 }}>{help}</Text> : null}</View><Switch value={Boolean(v[k])} onValueChange={(x) => set(k, x)} /></View>
  );

  return (
    <Screen>
      <TextInput mode="outlined" label="Organisation name" value={String(v['org.name'] ?? '')} onChangeText={(t) => set('org.name', t)} />
      <TextInput mode="outlined" label="Book code prefix" maxLength={4} autoCapitalize="characters" value={String(v['copy.codePrefix'] ?? '')} onChangeText={(t) => set('copy.codePrefix', t.toUpperCase())} />
      <TextInput mode="outlined" label="Lock after (minutes idle, 0 = off)" keyboardType="number-pad" value={String(v['session.autoLockMinutes'] ?? '')} onChangeText={(t) => set('session.autoLockMinutes', Number(t) || 0)} />
      <Divider />
      {toggle('sales.managerSeesWholeStall', 'Managers see the whole stall’s sales', 'Off: only their own sales')}
      {toggle('stall.deactivateManagersOnClose', 'Deactivate managers when a stall closes')}
      {toggle('public.enabled', 'Public QR page', 'Customers can scan a sticker to see the book')}
      <Button mode="contained" onPress={save} disabled={!dirty.length} loading={update.isPending}>Save {dirty.length ? `(${dirty.length})` : ''}</Button>
    </Screen>
  );
}
