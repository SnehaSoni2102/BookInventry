import { errorMessage, qk, useCreateUser, useUpdateUser } from '@bookstall/api-client';
import { Role, type UserDto } from '@bookstall/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Searchbar, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { Empty, ErrorBox, Loading, Screen, styles } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { sharePdf } from '../../src/lib/print';

const ROLE = { ADMIN: 'Admin', INVENTORY_STAFF: 'Staff', STALL_MANAGER: 'Manager' } as const;

export default function Users() {
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: qk.users.list({ q: text }), queryFn: () => api.users.list({ q: text.trim() || undefined, pageSize: 50 }) });
  const [edit, setEdit] = useState<UserDto | 'new' | null>(null);
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Searchbar placeholder="Search users" value={text} onChangeText={setText} />
      <Button mode="contained" icon="account-plus" onPress={() => setEdit('new')}>New user</Button>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} />}
      {q.data?.items.length === 0 && <Empty title="No users" />}
      {q.data?.items.map((u) => (
        <Card key={u.id} onPress={() => setEdit(u)}>
          <Card.Content style={styles.between}>
            <View style={{ flex: 1 }}><Text variant="titleSmall">{u.displayName}</Text><Text variant="bodySmall" style={{ opacity: 0.7 }}>{u.username}{u.activeStall ? ` · ${u.activeStall.name}` : ''}</Text></View>
            <Chip compact>{ROLE[u.role]}</Chip>{!u.isActive && <Chip compact>off</Chip>}
          </Card.Content>
        </Card>
      ))}
      {edit && <UserDialog user={edit === 'new' ? null : edit} onClose={() => { setEdit(null); void q.refetch(); }} />}
    </Screen>
  );
}

function UserDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const [v, setV] = useState({ username: user?.username ?? '', displayName: user?.displayName ?? '', role: (user?.role ?? 'STALL_MANAGER') as UserDto['role'], isActive: user?.isActive ?? true });
  const save = async () => {
    try {
      if (user) { await update.mutateAsync({ displayName: v.displayName, role: v.role, isActive: v.isActive }); onClose(); return; }
      const r = await create.mutateAsync({ username: v.username.trim().toLowerCase(), displayName: v.displayName.trim(), role: v.role });
      onClose();
      Alert.alert('Login details (shown once)', `${r.user.username}\n${r.initialPassword}`, [
        { text: 'Share', onPress: () => void Share.share({ message: `Bookstall login\nUsername: ${r.user.username}\nPassword: ${r.initialPassword}` }) },
        ...(r.slipToken ? [{ text: 'Slip PDF', onPress: async () => sharePdf(await api.users.slip(r.user.id, r.slipToken!), 'login-slip.pdf') }] : []),
        { text: 'Done' },
      ]);
    } catch (e) {
      Alert.alert('Not saved', errorMessage(e));
    }
  };
  const reset = async () => {
    if (!user) return;
    try { const r = await api.users.resetPassword(user.id); Alert.alert('Temporary password', `${user.username}\n${r.temporaryPassword}\n\nShown only once.`); } catch (e) { Alert.alert('Failed', errorMessage(e)); }
  };
  return (
    <Portal>
      <Dialog visible onDismiss={onClose}>
        <Dialog.Title>{user ? user.displayName : 'New user'}</Dialog.Title>
        <Dialog.Content style={{ gap: 8 }}>
          <TextInput mode="outlined" dense label="Username" autoCapitalize="none" disabled={Boolean(user)} value={v.username} onChangeText={(t) => setV({ ...v, username: t })} />
          <TextInput mode="outlined" dense label="Display name" value={v.displayName} onChangeText={(t) => setV({ ...v, displayName: t })} />
          <SegmentedButtons density="small" value={v.role} onValueChange={(r) => setV({ ...v, role: r as UserDto['role'] })} buttons={Role.values.map((r) => ({ value: r, label: ROLE[r] }))} />
          {user && <View style={styles.between}><Text>Active</Text><Switch value={v.isActive} onValueChange={(a) => setV({ ...v, isActive: a })} /></View>}
          {user && <Button onPress={reset}>Reset password</Button>}
        </Dialog.Content>
        <Dialog.Actions><Button onPress={onClose}>Cancel</Button><Button mode="contained" onPress={save} disabled={!v.displayName.trim() || (!user && v.username.trim().length < 3)}>Save</Button></Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
