import { errorMessage, qk, useStalls } from '@bookstall/api-client';
import type { CreateStallResponse, StallDto } from '@bookstall/shared';
import { ActionIcon, Alert, Badge, Button, Code, CopyButton, Group, Menu, Modal, Radio, Select, Stack, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDotsVertical } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { confirmAction } from '../../components/confirm';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorState } from '../../components/states';
import { useFormat } from '../../lib/format';
import { printBlob } from '../../lib/print';

const STATUS_COLOR = { PLANNED: 'yellow', ACTIVE: 'green', CLOSED: 'gray' } as const;

/** Credentials are shown once. The slip PDF is generated from a one-time token the server returned. */
export function CredentialsDialog({ info, onClose }: { info: { username: string; password: string; userId: string; slipToken?: string } | null; onClose: () => void }) {
  if (!info) return null;
  return (
    <Modal opened onClose={onClose} title="Login details (shown only once)" centered>
      <Stack>
        <Alert color="yellow">Write these down or print the slip now. The password cannot be shown again; you can only reset it.</Alert>
        <div><Text size="xs" c="dimmed">Username</Text><Code fz="lg" data-testid="cred-username">{info.username}</Code></div>
        <div><Text size="xs" c="dimmed">Temporary password</Text><Code fz="lg" data-testid="cred-password">{info.password}</Code></div>
        <Group>
          <CopyButton value={`${info.username} / ${info.password}`}>{({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}</CopyButton>
          {info.slipToken && <Button onClick={async () => printBlob(await api.users.slip(info.userId, info.slipToken!))}>Print credential slip</Button>}
        </Group>
        <Text size="xs" c="dimmed">They will be asked to choose their own password at first sign-in.</Text>
        <Button onClick={onClose}>Done</Button>
      </Stack>
    </Modal>
  );
}

function CreateStallModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: CreateStallResponse) => void }) {
  const qc = useQueryClient();
  const managers = useQuery({ queryKey: [...qk.users.all(), 'mgrs'], queryFn: () => api.users.list({ role: 'STALL_MANAGER', active: true, pageSize: 100 }) });
  const [v, setV] = useState({ name: '', location: '', startsOn: '', endsOn: '', description: '' });
  const [mgr, setMgr] = useState<'none' | 'existing' | 'new'>('new');
  const [existing, setExisting] = useState<string | null>(null);
  const [nu, setNu] = useState({ username: '', displayName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.stalls.create({
        name: v.name.trim(),
        ...(v.location ? { location: v.location } : {}), ...(v.description ? { description: v.description } : {}),
        ...(v.startsOn ? { startsOn: v.startsOn } : {}), ...(v.endsOn ? { endsOn: v.endsOn } : {}),
        ...(mgr === 'existing' && existing ? { manager: { existingUserId: existing } } : {}),
        ...(mgr === 'new' && nu.username ? { manager: { username: nu.username.trim().toLowerCase(), displayName: nu.displayName.trim() || nu.username } } : {}),
      });
      await qc.invalidateQueries({ queryKey: qk.stalls.all() });
      onCreated(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="New stall" size="lg" centered>
      <Stack gap="xs">
        <TextInput label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} data-testid="stall-name" />
        <TextInput label="Location" value={v.location} onChange={(e) => setV({ ...v, location: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Starts on" type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.currentTarget.value })} />
          <TextInput label="Ends on" type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.currentTarget.value })} />
        </Group>
        <Textarea label="Notes" value={v.description} onChange={(e) => setV({ ...v, description: e.currentTarget.value })} autosize minRows={2} />
        <Radio.Group label="Manager" value={mgr} onChange={(x) => setMgr(x as typeof mgr)}>
          <Group mt={4}><Radio value="new" label="Create a new login" /><Radio value="existing" label="Use an existing manager" /><Radio value="none" label="Assign later" /></Group>
        </Radio.Group>
        {mgr === 'new' && (
          <Group grow>
            <TextInput label="Username" placeholder="e.g. mela.asha" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.currentTarget.value })} data-testid="mgr-username" />
            <TextInput label="Display name" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.currentTarget.value })} />
          </Group>
        )}
        {mgr === 'existing' && <Select label="Manager" searchable placeholder="Choose" data={(managers.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.displayName} (${u.username})${u.activeStall ? ` — on ${u.activeStall.name}` : ''}` }))} value={existing} onChange={setExisting} />}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end" mt="sm"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!v.name.trim()} data-testid="create-stall">Create stall</Button></Group>
      </Stack>
    </Modal>
  );
}

export default function StallsPage() {
  const { can } = useAuth();
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>('all');
  const q = useStalls(tab === 'all' ? undefined : tab);
  const [creating, setCreating] = useState(false);
  const [creds, setCreds] = useState<{ username: string; password: string; userId: string; slipToken?: string } | null>(null);
  const manage = can('stall.manage');

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: qk.stalls.all() }); notifications.show({ color: 'green', message: ok }); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
  };

  const columns: Column<StallDto>[] = [
    { key: 'name', header: 'Stall', cell: (s) => <div><Text fw={600} size="sm">{s.name}</Text><Text size="xs" c="dimmed">{s.location}</Text></div> },
    { key: 'status', header: 'Status', cell: (s) => <Badge color={STATUS_COLOR[s.status]} variant="light">{s.status.toLowerCase()}</Badge> },
    { key: 'dates', header: 'Dates', hideBelow: 'md', cell: (s) => <Text size="sm">{s.startsOn ? fmt.date(s.startsOn) : '—'}{s.endsOn ? ` → ${fmt.date(s.endsOn)}` : ''}</Text> },
    { key: 'mgr', header: 'Managers', hideBelow: 'sm', cell: (s) => <Text size="sm">{s.managers.map((m) => m.displayName).join(', ') || '—'}</Text> },
    { key: 'out', header: 'Books out', align: 'right', cell: (s) => s.counts.atStall },
    { key: 'sold', header: 'Sold', align: 'right', hideBelow: 'sm', cell: (s) => s.counts.sold },
    { key: 'rev', header: 'Revenue', align: 'right', cell: (s) => <Text fw={600} size="sm">{fmt.money(s.counts.revenueMinor)}</Text> },
    {
      key: 'act', header: '', width: 50,
      cell: (s) => manage ? (
        <Menu position="bottom-end">
          <Menu.Target><ActionIcon variant="subtle" aria-label={`Actions for ${s.name}`} onClick={(e) => e.stopPropagation()}><IconDotsVertical size={16} /></ActionIcon></Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            {s.status === 'PLANNED' && <Menu.Item onClick={() => void act(() => api.stalls.activate(s.id), `${s.name} is active`)}>Activate</Menu.Item>}
            <Menu.Item component={Link} to={`/stalls/${s.id}`}>Open</Menu.Item>
            {s.status !== 'CLOSED' && <Menu.Item component={Link} to={`/stalls/${s.id}?tab=close`}>Reconcile &amp; close</Menu.Item>}
            <Menu.Item color="red" onClick={() => confirmAction({ title: `Delete ${s.name}?`, message: s.counts.atStall ? `${s.counts.atStall} books are still out. Check them in or close the stall first.` : 'The stall is hidden from lists but its sales stay in reports.', confirmLabel: 'Delete', onConfirm: () => act(() => api.stalls.remove(s.id), 'Stall deleted') })}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : null,
    },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Stalls</Title>
        {manage && <Button onClick={() => setCreating(true)} data-testid="new-stall">New stall</Button>}
      </Group>
      <Tabs value={tab} onChange={(v) => setTab(v ?? 'all')}>
        <Tabs.List><Tabs.Tab value="all">All</Tabs.Tab><Tabs.Tab value="ACTIVE">Active</Tabs.Tab><Tabs.Tab value="PLANNED">Planned</Tabs.Tab><Tabs.Tab value="CLOSED">Closed</Tabs.Tab></Tabs.List>
      </Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable columns={columns} rows={q.data} rowKey={(s) => s.id} loading={q.isLoading} onRowClick={(s) => navigate(`/stalls/${s.id}`)} empty={<EmptyState title="No stalls yet">{manage ? 'Create a stall for your next fair or event.' : ''}</EmptyState>} />
      )}
      {creating && (
        <CreateStallModal
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            if (r.manager?.initialPassword) setCreds({ username: r.manager.user.username, password: r.manager.initialPassword, userId: r.manager.user.id, slipToken: r.manager.slipToken });
            else navigate(`/stalls/${r.stall.id}`);
          }}
        />
      )}
      <CredentialsDialog info={creds} onClose={() => setCreds(null)} />
    </Stack>
  );
}
