import { errorMessage, qk, useGenres } from '@bookstall/api-client';
import type { GenreDto } from '@bookstall/shared';
import { ActionIcon, Alert, Button, ColorInput, Group, Modal, Stack, Switch, Table, TagsInput, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../app/api';
import { ErrorState, PageSkeleton } from '../../components/states';

export default function GenresPage() {
  const q = useGenres(true);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<GenreDto | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.genres() });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} />;
  const list = q.data!;

  // Genres follow this order along the shelves; swap neighbours to reorder.
  const move = async (i: number, dir: -1 | 1) => {
    const a = list[i]!;
    const b = list[i + dir];
    if (!b) return;
    try {
      await api.genres.update(a.id, { sortOrder: b.sortOrder });
      await api.genres.update(b.id, { sortOrder: a.sortOrder });
      await refresh();
    } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
  };

  return (
    <Stack>
      <Group justify="space-between"><Title order={2}>Genres</Title><Button onClick={() => setEditing('new')}>New genre</Button></Group>
      <Text size="sm" c="dimmed">The order here is the order of genres along the shelves. Keywords help suggest a genre from online book data.</Text>
      <Table verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th w={80}>Order</Table.Th><Table.Th>Genre</Table.Th><Table.Th>Code</Table.Th><Table.Th>Colour</Table.Th><Table.Th>Active</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {list.map((g, i) => (
            <Table.Tr key={g.id} style={{ opacity: g.isActive ? 1 : 0.5 }}>
              <Table.Td><Group gap={2} wrap="nowrap"><ActionIcon size="sm" variant="subtle" disabled={i === 0} aria-label={`Move ${g.name} up`} onClick={() => void move(i, -1)}><IconArrowUp size={14} /></ActionIcon><ActionIcon size="sm" variant="subtle" disabled={i === list.length - 1} aria-label={`Move ${g.name} down`} onClick={() => void move(i, 1)}><IconArrowDown size={14} /></ActionIcon></Group></Table.Td>
              <Table.Td fw={600}>{g.name}</Table.Td><Table.Td>{g.code}</Table.Td>
              <Table.Td><span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 4, background: g.color, verticalAlign: 'middle' }} /></Table.Td>
              <Table.Td>{g.isActive ? 'Yes' : 'No'}</Table.Td>
              <Table.Td><Button size="compact-xs" variant="light" onClick={() => setEditing(g)}>Edit</Button></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {editing && <GenreModal genre={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Stack>
  );
}

function GenreModal({ genre, onClose, onSaved }: { genre: GenreDto | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: genre?.name ?? '', code: genre?.code ?? '', color: genre?.color ?? '#4C6EF5', isActive: genre?.isActive ?? true });
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  if (genre && !loaded) {
    setLoaded(true);
    void api.genres.get(genre.id).then((g) => setKeywords(g.keywords?.map((k) => k.keyword) ?? []));
  }
  const save = async () => {
    setError(null);
    try {
      const saved = genre
        ? await api.genres.update(genre.id, { name: v.name, color: v.color, isActive: v.isActive })
        : await api.genres.create({ name: v.name, code: v.code, color: v.color });
      if (keywords) await api.genres.putKeywords(saved.id, keywords.map((k) => ({ keyword: k })));
      await onSaved();
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Modal opened onClose={onClose} title={genre ? `Edit ${genre.name}` : 'New genre'} centered>
      <Stack>
        <TextInput label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <TextInput label="Code" description="2–4 capital letters, used in shelf locations" disabled={Boolean(genre)} maxLength={4} value={v.code} onChange={(e) => setV({ ...v, code: e.currentTarget.value.toUpperCase() })} />
        <ColorInput label="Colour" value={v.color} onChange={(c) => setV({ ...v, color: c })} format="hex" />
        <TagsInput label="Keywords" description="Words in a book's subjects that point to this genre" value={keywords ?? []} onChange={setKeywords} disabled={Boolean(genre) && keywords === null} />
        {genre && <Switch label="Active" description="Inactive genres cannot be chosen for new books" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.currentTarget.checked })} />}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!v.name || (!genre && v.code.length < 2)}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
