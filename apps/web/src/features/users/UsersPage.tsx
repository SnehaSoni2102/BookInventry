import { errorMessage, qk, useCreateUser, useUpdateUser } from '@bookstall/api-client';
import { Role, type UserDto } from '@bookstall/shared';
import { Alert, Badge, Button, Group, Modal, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { confirmAction } from '../../components/confirm';
import { DataTable, type Column } from '../../components/DataTable';
import { ErrorState } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useFormat } from '../../lib/format';
import { CredentialsDialog } from '../stalls/StallsPage';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', INVENTORY_STAFF: 'Inventory staff', STALL_MANAGER: 'Stall manager' };

export default function UsersPage() {
  const fmt = useFormat();
  const { me } = useAuth();
  const qc = useQueryClient();
  const params = useListParams();
  const [text, setText] = useState(params.get('q'));
  const [debounced] = useDebouncedValue(text, 300);
  useEffect(() => { if (debounced !== params.get('q')) params.set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({
    queryKey: qk.users.list({ q: params.get('q'), role: params.get('role'), active: params.get('active'), page: params.page, size: params.pageSize }),
    queryFn: () => api.users.list({ q: params.get('q') || undefined, role: (params.get('role') || undefined) as never, active: params.get('active') ? params.get('active') === 'true' : undefined, page: params.page, pageSize: params.pageSize }),
  });
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [creds, setCreds] = useState<{ username: string; password: string; userId: string; slipToken?: string } | null>(null);

  const reset = (u: UserDto) =>
    confirmAction({
      title: `Reset ${u.displayName}'s password?`, message: 'They are signed out everywhere and must choose a new password. The new temporary password is shown once.', confirmLabel: 'Reset password', color: 'blue',
      onConfirm: async () => {
        try { const r = await api.users.resetPassword(u.id); setCreds({ username: u.username, password: r.temporaryPassword, userId: u.id, slipToken: r.slipToken }); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
      },
    });

  const columns: Column<UserDto>[] = [
    { key: 'name', header: 'Name', cell: (u) => <div><Text fw={600} size="sm">{u.displayName}{u.id === me?.user.id && <Badge ml={6} size="xs">you</Badge>}</Text><Text size="xs" c="dimmed">{u.username}</Text></div> },
    { key: 'role', header: 'Role', cell: (u) => ROLE_LABEL[u.role] },
    { key: 'stall', header: 'Active stall', hideBelow: 'sm', cell: (u) => u.activeStall?.name ?? '—' },
    { key: 'last', header: 'Last sign-in', hideBelow: 'md', cell: (u) => (u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : 'never') },
    { key: 'st', header: 'Status', cell: (u) => <Badge color={u.isActive ? 'green' : 'gray'} variant="light">{u.isActive ? 'active' : 'deactivated'}</Badge> },
    { key: 'a', header: '', cell: (u) => <Group gap={4} wrap="nowrap"><Button size="compact-xs" variant="light" onClick={() => setEditing(u)}>Edit</Button><Button size="compact-xs" variant="subtle" onClick={() => reset(u)}>Reset password</Button></Group> },
  ];

  return (
    <Stack>
      <Group justify="space-between"><Title order={2}>Users</Title><Button onClick={() => setEditing('new')} data-testid="new-user">New user</Button></Group>
      <Group>
        <TextInput placeholder="Search name or username" leftSection={<IconSearch size={16} />} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Select placeholder="Any role" clearable w={180} data={Role.values.map((r) => ({ value: r, label: ROLE_LABEL[r]! }))} value={params.get('role') || null} onChange={(v) => params.set({ role: v })} />
        <Select placeholder="Any status" clearable w={150} data={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Deactivated' }]} value={params.get('active') || null} onChange={(v) => params.set({ active: v })} />
      </Group>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <DataTable columns={columns} rows={q.data?.items} rowKey={(u) => u.id} loading={q.isLoading} total={q.data?.total} page={params.page} pageSize={params.pageSize} onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })} />}
      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onCreated={(r) => { setEditing(null); if (r.initialPassword) setCreds({ username: r.user.username, password: r.initialPassword, userId: r.user.id, slipToken: r.slipToken }); void qc.invalidateQueries({ queryKey: qk.users.all() }); }}
        />
      )}
      <CredentialsDialog info={creds} onClose={() => setCreds(null)} />
    </Stack>
  );
}

function UserModal({ user, onClose, onCreated }: { user: UserDto | null; onClose: () => void; onCreated: (r: import('@bookstall/shared').CreateUserResponse) => void }) {
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const [v, setV] = useState({ username: user?.username ?? '', displayName: user?.displayName ?? '', role: (user?.role ?? 'STALL_MANAGER') as UserDto['role'], isActive: user?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      if (user) { await update.mutateAsync({ displayName: v.displayName, role: v.role, isActive: v.isActive }); onClose(); }
      else onCreated(await create.mutateAsync({ username: v.username.trim().toLowerCase(), displayName: v.displayName.trim(), role: v.role }));
    } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Modal opened onClose={onClose} title={user ? `Edit ${user.displayName}` : 'New user'} centered>
      <Stack>
        <TextInput label="Username" description="Letters, numbers, dot, dash, underscore" disabled={Boolean(user)} value={v.username} onChange={(e) => setV({ ...v, username: e.currentTarget.value })} data-testid="user-username" />
        <TextInput label="Display name" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.currentTarget.value })} data-testid="user-displayname" />
        <Select label="Role" data={Role.values.map((r) => ({ value: r, label: ROLE_LABEL[r]! }))} value={v.role} onChange={(r) => r && setV({ ...v, role: r as never })} allowDeselect={false} />
        {user && <Switch label="Active" description="Deactivating signs them out immediately" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.currentTarget.checked })} />}
        {!user && <Text size="xs" c="dimmed">A temporary password is generated and shown once.</Text>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save} loading={create.isPending || update.isPending} disabled={!v.displayName.trim() || (!user && v.username.trim().length < 3)} data-testid="save-user">{user ? 'Save' : 'Create user'}</Button></Group>
      </Stack>
    </Modal>
  );
}
