import { errorMessage, qk, useGenres, useTitle, useUpdateTitle } from '@bookstall/api-client';
import type { CopyGroup, MoveListItem, TitleDetail } from '@bookstall/shared';
import { Anchor, Badge, Button, FileButton, Group, Modal, NumberInput, Select, Stack, Table, TagsInput, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPencil } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { BookCover } from '../../components/BookCover';
import { GenreChip } from '../../components/badges';
import { CheckoutDialog, type CheckoutMode } from '../../components/CheckoutDialog';
import { confirmAction } from '../../components/confirm';
import { CopyGroupTable } from '../../components/CopyGroupTable';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { SellDialog } from '../../components/SellDialog';
import { ErrorState, PageSkeleton } from '../../components/states';
import { useCart } from '../../lib/cart';
import { useFormat } from '../../lib/format';

export default function TitleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const cart = useCart();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useTitle(id);
  const [sell, setSell] = useState<CopyGroup | null>(null);
  const [checkout, setCheckout] = useState<CheckoutMode | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [moves, setMoves] = useState<MoveListItem[] | null>(null);
  const [more, setMore] = useState(false);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data!;

  const checkinGroup = (g: CopyGroup) =>
    confirmAction({
      title: 'Check in these books?', message: `${g.quantity} cop${g.quantity === 1 ? 'y' : 'ies'} from ${g.stall?.name ?? 'the stall'} go back to their shelf slots.`, confirmLabel: 'Check in', color: 'blue',
      onConfirm: async () => {
        try {
          const res = await api.stalls.checkin({ clientRef: crypto.randomUUID(), copyIds: g.copies.map((c) => c.id) });
          notifications.show({ color: 'green', message: `${res.checkedIn.length} checked in`, autoClose: 8000 });
          await qc.invalidateQueries();
        } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
      },
    });

  const relocate = () =>
    confirmAction({
      title: 'Move copies to the new genre rows?', message: 'This finds new shelf slots for every copy and flags their labels for reprinting.', confirmLabel: 'Move copies', color: 'blue',
      onConfirm: async () => {
        try {
          const res = await api.titles.relocate(t.id);
          setMoves(res.moves);
          await qc.invalidateQueries();
        } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
      },
    });

  const uploadCover = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.titles.uploadCover(t.id, fd);
      await qc.invalidateQueries({ queryKey: qk.titles.all() });
      notifications.show({ color: 'green', message: 'Cover updated' });
    } catch (e) { notifications.show({ color: 'red', message: errorMessage(e) }); }
  };

  return (
    <Stack>
      <Group align="flex-start" wrap="nowrap">
        <Stack gap={6} align="center">
          <BookCover url={t.coverUrl} title={t.title} color={t.genre.color} width={120} />
          {can('title.write') && <FileButton onChange={(f) => f && void uploadCover(f)} accept="image/png,image/jpeg,image/webp">{(props) => <Button size="compact-xs" variant="subtle" {...props}>{t.coverUrl ? 'Replace cover' : 'Add cover'}</Button>}</FileButton>}
        </Stack>
        <Stack gap={4} flex={1} style={{ minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Title order={2} data-testid="title-heading">{t.title}</Title>
              {t.subtitle && <Text c="dimmed">{t.subtitle}</Text>}
              <Text>{t.authors.join(', ')}</Text>
            </div>
            {can('title.write') && <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>Edit title</Button>}
          </Group>
          <Group gap={8}>
            <GenreChip genre={t.genre} />
            <Badge variant="light" color="gray">{t.source === 'OPEN_LIBRARY' ? 'Open Library' : t.source === 'GOOGLE_BOOKS' ? 'Google Books' : t.source === 'IMPORT' ? 'Import' : 'Manual'}</Badge>
            {t.isbn13 && <Text size="sm" c="dimmed">ISBN {t.isbn13}</Text>}
          </Group>
          <Text size="sm" c="dimmed">{[t.publisher, t.publishedYear, t.pageCount ? `${t.pageCount} pages` : null, t.language?.toUpperCase()].filter(Boolean).join(' · ')}</Text>
          {t.summary && (
            <Text size="sm" lineClamp={more ? undefined : 3}>{t.summary} </Text>
          )}
          {t.summary && t.summary.length > 220 && <Anchor component="button" size="xs" onClick={() => setMore((m) => !m)}>{more ? 'Show less' : 'Show more'}</Anchor>}
        </Stack>
      </Group>

      <Tabs defaultValue="copies">
        <Tabs.List>
          <Tabs.Tab value="copies">Copies ({t.copyGroups.reduce((a, g) => a + g.quantity, 0)})</Tabs.Tab>
          {can('audit.read') && <Tabs.Tab value="history">History</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="copies" pt="md">
          <Stack>
            {t.copyGroups.length === 0 ? <Text c="dimmed">No copies available.</Text> : (
              <CopyGroupTable
                groups={t.copyGroups}
                canSell={(g) => (g.status === 'IN_STOCK' && can('sale.create.central')) || (g.status === 'AT_STALL' && (can('sale.create.central') || can('sale.create.stall')))}
                canCheckout={can('stall.checkout')} canCheckin={can('stall.checkin')} canPrint={can('label.print')}
                onSell={setSell}
                onCheckout={(g) => setCheckout({ kind: 'group', titleId: t.id, title: t.title, condition: g.condition, sellingPriceMinor: g.sellingPriceMinor, max: g.quantity })}
                onLabels={(g) => setLabels(g.copies.map((c) => c.id))}
                onCheckin={checkinGroup}
                inCart={cart.has}
                onAddToCart={(g) => {
                  const c = g.copies.find((x) => !cart.has(x.id));
                  if (!c) return notifications.show({ color: 'yellow', message: 'All copies of this group are already in the cart' });
                  cart.add({ copyId: c.id, code: c.code, title: t.title, condition: g.condition, sellingPriceMinor: g.sellingPriceMinor, locationCode: c.locationCode, stallName: g.stall?.name ?? null });
                  notifications.show({ color: 'green', message: `${c.code} added to the cart` });
                }}
              />
            )}
            <Group>
              {can('copy.create') && <Button component={Link} to={t.isbn13 ? `/books/new?isbn=${t.isbn13}` : '/books/new'} variant="light">Add a copy</Button>}
              {can('copy.update') && <Button variant="default" onClick={relocate}>Relocate to genre rows</Button>}
            </Group>
          </Stack>
        </Tabs.Panel>
        {can('audit.read') && <Tabs.Panel value="history" pt="md"><History titleId={t.id} /></Tabs.Panel>}
      </Tabs>

      {sell && (
        <SellDialog
          opened onClose={() => { setSell(null); void q.refetch(); }}
          title={t.title} condition={sell.condition} sellingPriceMinor={sell.sellingPriceMinor}
          candidates={sell.copies.map((c) => ({ copyId: c.id, code: c.code, locationCode: c.locationCode, stallName: c.stall?.name ?? null }))}
        />
      )}
      {checkout && <CheckoutDialog opened onClose={() => { setCheckout(null); void q.refetch(); }} mode={checkout} />}
      {labels && <LabelPrintDialog opened onClose={() => setLabels(null)} copyIds={labels} canMarkPrinted={can('inventory.read')} />}
      {editing && <EditTitleModal title={t} onClose={() => setEditing(false)} onRelocate={relocate} />}
      <Modal opened={Boolean(moves)} onClose={() => setMoves(null)} title="Copies moved" centered>
        {moves?.length === 0 ? <Text>Nothing needed to move.</Text> : (
          <Stack>
            <Text size="sm">Move these books to their new places, then reprint the labels from <Anchor component={Link} to="/labels">Labels</Anchor>.</Text>
            <Table><Table.Tbody>{moves?.map((m) => <Table.Tr key={m.code}><Table.Td>{m.code}</Table.Td><Table.Td c="dimmed">{m.from ?? 'unshelved'}</Table.Td><Table.Td fw={700}>→ {m.to}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
          </Stack>
        )}
      </Modal>
      <Text size="xs" c="dimmed">Prices shown in {fmt.currency}.</Text>
    </Stack>
  );
}

function History({ titleId }: { titleId: string }) {
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['audit', 'title', titleId], queryFn: () => api.audit.list({ entityType: 'title', entityId: titleId, pageSize: 50 }) });
  if (q.isLoading) return <PageSkeleton rows={3} />;
  return (
    <Table>
      <Table.Tbody>
        {q.data?.items.map((l) => <Table.Tr key={l.id}><Table.Td>{fmt.dateTime(l.createdAt)}</Table.Td><Table.Td fw={600}>{l.action}</Table.Td><Table.Td><Text size="xs" c="dimmed" lineClamp={2}>{JSON.stringify(l.after)}</Text></Table.Td></Table.Tr>)}
      </Table.Tbody>
    </Table>
  );
}

function EditTitleModal({ title, onClose, onRelocate }: { title: TitleDetail; onClose: () => void; onRelocate: () => void }) {
  const genres = useGenres();
  const update = useUpdateTitle(title.id);
  const [v, setV] = useState({
    title: title.title, subtitle: title.subtitle ?? '', authors: title.authors, publisher: title.publisher ?? '', year: title.publishedYear ?? ('' as number | string),
    pages: title.pageCount ?? ('' as number | string), language: title.language ?? '', genreId: title.genre.id, summary: title.summary ?? '',
  });
  const save = async () => {
    try {
      const res = await update.mutateAsync({
        version: title.version, title: v.title.trim(), subtitle: v.subtitle || null, authors: v.authors, publisher: v.publisher || null,
        publishedYear: v.year === '' ? null : Number(v.year), pageCount: v.pages === '' ? null : Number(v.pages), language: v.language || null,
        genreId: v.genreId, summary: v.summary || null,
      });
      notifications.show({ color: 'green', message: 'Title saved' });
      onClose();
      if (res.requiresRelocation > 0) {
        confirmAction({ title: 'Genre changed', message: `${res.requiresRelocation} cop${res.requiresRelocation === 1 ? 'y is' : 'ies are'} still on the old genre's shelves. Move them now?`, confirmLabel: 'Move copies', color: 'blue', onConfirm: onRelocate });
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Not saved', message: errorMessage(e) });
    }
  };
  return (
    <Modal opened onClose={onClose} title="Edit title" size="lg" centered>
      <Stack gap="xs">
        <TextInput label="Title" required value={v.title} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} />
        <TextInput label="Subtitle" value={v.subtitle} onChange={(e) => setV({ ...v, subtitle: e.currentTarget.value })} />
        <TagsInput label="Authors" value={v.authors} onChange={(a) => setV({ ...v, authors: a })} />
        <Group grow>
          <TextInput label="Publisher" value={v.publisher} onChange={(e) => setV({ ...v, publisher: e.currentTarget.value })} />
          <NumberInput label="Year" value={v.year} onChange={(n) => setV({ ...v, year: n })} min={1400} max={2100} allowDecimal={false} />
          <NumberInput label="Pages" value={v.pages} onChange={(n) => setV({ ...v, pages: n })} min={1} allowDecimal={false} />
        </Group>
        <Select label="Genre" searchable data={(genres.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} value={v.genreId} onChange={(g) => g && setV({ ...v, genreId: g })} allowDeselect={false} />
        <Textarea label="Summary" autosize minRows={3} maxRows={8} value={v.summary} onChange={(e) => setV({ ...v, summary: e.currentTarget.value })} />
        <Group justify="flex-end" mt="sm"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save} loading={update.isPending} disabled={!v.title.trim()}>Save</Button></Group>
      </Stack>
    </Modal>
  );
}
