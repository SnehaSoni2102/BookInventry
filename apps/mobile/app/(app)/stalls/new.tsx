import { errorMessage, qk } from '@bookstall/api-client';
import type { CreateStallResponse } from '@bookstall/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { Button, Card, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { Screen } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { sharePdf } from '../../../src/lib/print';

export default function NewStall() {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', location: '', startsOn: '', endsOn: '' });
  const [mgr, setMgr] = useState<'new' | 'none'>('new');
  const [nu, setNu] = useState({ username: '', displayName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CreateStallResponse | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.stalls.create({
        name: v.name.trim(), ...(v.location ? { location: v.location } : {}), ...(v.startsOn ? { startsOn: v.startsOn } : {}), ...(v.endsOn ? { endsOn: v.endsOn } : {}),
        ...(mgr === 'new' && nu.username ? { manager: { username: nu.username.trim().toLowerCase(), displayName: nu.displayName.trim() || nu.username } } : {}),
      });
      await qc.invalidateQueries({ queryKey: qk.stalls.all() });
      if (res.manager?.initialPassword) setDone(res);
      else router.replace(`/stalls/${res.stall.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done?.manager?.initialPassword) {
    const m = done.manager;
    return (
      <Screen>
        <Text variant="headlineSmall">Stall created</Text>
        <Card style={{ backgroundColor: '#fff3cd' }}><Card.Content style={{ gap: 6 }}>
          <Text variant="labelLarge">Login details: shown only once</Text>
          <Text>Username</Text><Text variant="titleLarge" selectable>{m.user.username}</Text>
          <Text>Temporary password</Text><Text variant="titleLarge" selectable>{m.initialPassword}</Text>
        </Card.Content></Card>
        <View style={{ gap: 8 }}>
          <Button mode="outlined" icon="share-variant" onPress={() => void Share.share({ message: `Bookstall login\nUsername: ${m.user.username}\nPassword: ${m.initialPassword}` })}>Share</Button>
          {m.slipToken && <Button mode="outlined" icon="printer" onPress={async () => sharePdf(await api.users.slip(m.user.id, m.slipToken!), 'login-slip.pdf', 'Login slip')}>Share credential slip (PDF)</Button>}
          <Button mode="contained" onPress={() => router.replace(`/stalls/${done.stall.id}`)}>Done</Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TextInput mode="outlined" label="Name *" value={v.name} onChangeText={(t) => setV({ ...v, name: t })} />
      <TextInput mode="outlined" label="Location" value={v.location} onChangeText={(t) => setV({ ...v, location: t })} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={{ flex: 1 }} mode="outlined" label="Starts (YYYY-MM-DD)" value={v.startsOn} onChangeText={(t) => setV({ ...v, startsOn: t })} />
        <TextInput style={{ flex: 1 }} mode="outlined" label="Ends" value={v.endsOn} onChangeText={(t) => setV({ ...v, endsOn: t })} />
      </View>
      <SegmentedButtons value={mgr} onValueChange={(x) => setMgr(x as typeof mgr)} buttons={[{ value: 'new', label: 'New manager login' }, { value: 'none', label: 'Assign later' }]} />
      {mgr === 'new' && (
        <>
          <TextInput mode="outlined" label="Username" autoCapitalize="none" value={nu.username} onChangeText={(t) => setNu({ ...nu, username: t })} />
          <TextInput mode="outlined" label="Display name" value={nu.displayName} onChangeText={(t) => setNu({ ...nu, displayName: t })} />
        </>
      )}
      {error && <HelperText type="error" visible>{error}</HelperText>}
      <Button mode="contained" onPress={save} loading={busy} disabled={!v.name.trim()}>Create stall</Button>
    </Screen>
  );
}
