import { errorMessage, qk, useGenres, useShelfMap } from '@bookstall/api-client';
import type { ShelfMapRack, ShelfMapRow } from '@bookstall/shared';
import { Alert, Badge, Box, Button, Group, Modal, NumberInput, Progress, ScrollArea, Select, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { GenreChip } from '../../components/badges';
import { LocationCode } from '../../components/LocationCode';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/states';
import { openPdf } from '../../lib/print';

export default function ShelvesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const map = useShelfMap();
  const manage = can('shelf.manage');
  const [rowOpen, setRowOpen] = useState<ShelfMapRow | null>(null);
  const [edit, setEdit] = useState<ShelfMapRow | null>(null);
  const [addRack, setAddRack] = useState(false);
  const [bulkFor, setBulkFor] = useState<ShelfMapRack | null>(null);
  const unshelved = useQuery({ queryKey: qk.shelves.unshelved(), queryFn: () => api.shelves.unshelved({ pageSize: 50 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['shelves'] });

  if (map.isLoading) return <PageSkeleton />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => map.refetch()} />;
  const racks = map.data!;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Shelves</Title>
        <Group>
          {manage && <Button variant="default" onClick={() => void openPdf(() => api.shelves.rowSigns())}>Print row signs</Button>}
          {manage && <Button onClick={() => setAddRack(true)}>Add rack</Button>}
        </Group>
      </Group>

      {racks.length === 0 ? <EmptyState title="No shelves set up yet">{manage ? 'Add a rack, then add rows and give each row a genre.' : ''}</EmptyState> : (
        <ScrollArea>
          <Group align="flex-start" wrap="nowrap" gap="lg">
            {racks.map((rack) => (
              <Stack key={rack.id} gap={6} w={260} style={{ flex: 'none' }}>
                <Group justify="space-between"><Text fw={800}>Rack {rack.code}</Text>{manage && <Button size="compact-xs" variant="subtle" onClick={() => setBulkFor(rack)}>Add rows</Button>}</Group>
                {rack.rows.map((r) => (
                  <Box key={r.id} p={6} style={{ border: '1px solid var(--mantine-color-default-border)', borderLeft: `6px solid ${r.genre?.color ?? '#adb5bd'}`, borderRadius: 6, cursor: 'pointer', opacity: r.isActive ? 1 : 0.5 }} onClick={() => setRowOpen(r)} data-testid={`row-${r.code}`}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={700} size="sm">{r.code}</Text>
                      <Group gap={4} wrap="nowrap">
                        {r.isOverflow && <Badge size="xs" color="gray">overflow</Badge>}
                        {r.genre ? <GenreChip genre={r.genre} /> : <Badge size="xs" color="red" variant="outline">no genre</Badge>}
                      </Group>
                    </Group>
                    <Tooltip label={`${r.used} of ${r.capacity} slots used${r.reservedAtStall ? ` (${r.reservedAtStall} out at stalls)` : ''}`}>
                      <Progress mt={4} size="sm" value={r.percentFull} color={r.percentFull >= 90 ? 'red' : r.percentFull >= 70 ? 'yellow' : 'blue'} />
                    </Tooltip>
                    <Text size="xs" c="dimmed">{r.used}/{r.capacity} · {r.percentFull}%</Text>
                  </Box>
                ))}
              </Stack>
            ))}
          </Group>
        </ScrollArea>
      )}

      <Stack gap="xs" mt="md">
        <Group justify="space-between">
          <Title order={4}>Unshelved books ({unshelved.data?.total ?? 0})</Title>
          {manage || can('copy.update') ? <Button size="compact-sm" variant="light" disabled={!unshelved.data?.total} onClick={async () => { try { const r = await api.shelves.placeUnshelved(); notifications.show({ color: r.placed ? 'green' : 'yellow', message: `${r.placed} placed, ${r.stillUnshelved} still without a slot` }); await qc.invalidateQueries(); } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); } }}>Try placing now</Button> : null}
        </Group>
        {unshelved.data?.items.length ? (
          <Stack gap={2}>
            <Alert color="orange">These books have no shelf slot. Add rows for their genre (or an overflow row) and press “Try placing now”.</Alert>
            <Table verticalSpacing={2}><Table.Tbody>{unshelved.data.items.map((u) => <Table.Tr key={u.id}><Table.Td><Text component={Link} to={`/copies/${u.code}`} fw={600} size="sm">{u.code}</Text></Table.Td><Table.Td>{u.title}</Table.Td><Table.Td><Badge variant="outline">{u.genreCode}</Badge></Table.Td></Table.Tr>)}</Table.Tbody></Table>
          </Stack>
        ) : <Text size="sm" c="dimmed">Every book has a slot.</Text>}
      </Stack>

      {rowOpen && <SlotsModal row={rowOpen} onClose={() => setRowOpen(null)} onEdit={manage ? () => { setEdit(rowOpen); setRowOpen(null); } : undefined} />}
      {edit && <EditRowModal row={edit} onClose={() => setEdit(null)} onSaved={refresh} />}
      {addRack && <AddRackModal onClose={() => setAddRack(false)} onSaved={refresh} />}
      {bulkFor && <BulkRowsModal rack={bulkFor} onClose={() => setBulkFor(null)} onSaved={refresh} />}
    </Stack>
  );
}

function SlotsModal({ row, onClose, onEdit }: { row: ShelfMapRow; onClose: () => void; onEdit?: () => void }) {
  const q = useQuery({ queryKey: qk.shelves.slots(row.id), queryFn: () => api.shelves.slots(row.id) });
  return (
    <Modal opened onClose={onClose} title={`Row ${row.code}${row.genre ? ` · ${row.genre.name}` : ''}`} size="lg" centered>
      {q.isLoading ? <PageSkeleton rows={2} /> : (
        <Stack>
          <Group gap={4} wrap="wrap">
            {q.data?.slots.map((s) => (
              <Tooltip key={s.slot} label={s.copy ? `${s.copy.code} · ${s.copy.title}${s.copy.status === 'AT_STALL' ? ' (out at a stall)' : ''}` : `Slot ${s.slot}: empty`}>
                <Box w={30} h={30} style={{ display: 'grid', placeItems: 'center', fontSize: 11, borderRadius: 4, border: '1px solid var(--mantine-color-default-border)', background: !s.copy ? 'transparent' : s.copy.status === 'AT_STALL' ? 'var(--mantine-color-violet-light)' : 'var(--mantine-color-blue-light)' }}>{s.slot}</Box>
              </Tooltip>
            ))}
          </Group>
          <Group gap="md"><Badge variant="light">filled</Badge><Badge variant="light" color="violet">reserved at stall</Badge><Badge variant="outline" color="gray">empty</Badge></Group>
          {onEdit && <Button variant="default" onClick={onEdit}>Edit this row</Button>}
          <LocationCode code={`${row.genre?.code ?? 'XXX'}-${row.code}-001`} />
        </Stack>
      )}
    </Modal>
  );
}

function EditRowModal({ row, onClose, onSaved }: { row: ShelfMapRow; onClose: () => void; onSaved: () => void }) {
  const genres = useGenres();
  const [v, setV] = useState({ capacity: row.capacity as number | string, genreId: row.genreId, isOverflow: row.isOverflow, isActive: row.isActive });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await api.shelves.updateRow(row.id, { capacity: Number(v.capacity), genreId: v.genreId, isOverflow: v.isOverflow, isActive: v.isActive });
      await onSaved();
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Modal opened onClose={onClose} title={`Edit row ${row.code}`} centered>
      <Stack>
        <NumberInput label="Slots (columns)" min={1} max={999} allowDecimal={false} value={v.capacity} onChange={(n) => setV({ ...v, capacity: n })} />
        <Select label="Genre" clearable searchable data={(genres.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} value={v.genreId} onChange={(g) => setV({ ...v, genreId: g })} />
        <Switch label="Overflow row" description="Used when a genre's own rows are full" checked={v.isOverflow} onChange={(e) => setV({ ...v, isOverflow: e.currentTarget.checked })} />
        <Switch label="Active" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.currentTarget.checked })} />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}

function AddRackModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal opened onClose={onClose} title="Add a rack" centered>
      <Stack>
        <TextInput label="Rack letter(s)" placeholder="A" maxLength={2} value={code} onChange={(e) => setCode(e.currentTarget.value.toUpperCase())} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button disabled={!code} onClick={async () => { try { await api.shelves.createRack({ code }); await onSaved(); onClose(); } catch (e) { setError(errorMessage(e)); } }}>Add</Button></Group>
      </Stack>
    </Modal>
  );
}

function BulkRowsModal({ rack, onClose, onSaved }: { rack: ShelfMapRack; onClose: () => void; onSaved: () => void }) {
  const genres = useGenres();
  const [v, setV] = useState({ count: 5 as number | string, capacity: 40 as number | string, genreId: null as string | null });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal opened onClose={onClose} title={`Add rows to rack ${rack.code}`} centered>
      <Stack>
        <Group grow><NumberInput label="How many rows" min={1} max={99} value={v.count} onChange={(n) => setV({ ...v, count: n })} /><NumberInput label="Slots per row" min={1} max={999} value={v.capacity} onChange={(n) => setV({ ...v, capacity: n })} /></Group>
        <Select label="Genre (optional)" clearable searchable data={(genres.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} value={v.genreId} onChange={(g) => setV({ ...v, genreId: g })} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={async () => { try { await api.shelves.bulkRows(rack.id, { count: Number(v.count), capacity: Number(v.capacity), genreId: v.genreId }); await onSaved(); onClose(); } catch (e) { setError(errorMessage(e)); } }}>Add rows</Button></Group>
      </Stack>
    </Modal>
  );
}
