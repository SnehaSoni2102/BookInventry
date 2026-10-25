import { useCopies, useGenres, useStalls, useTitles } from '@bookstall/api-client';
import type { BookCondition, CopyListItem, InventoryStatus, TitleListItem } from '@bookstall/shared';
import { BookCondition as Conditions } from '@bookstall/shared';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Collapse, Group, MultiSelect, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAdjustments, IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { BookCover } from '../../components/BookCover';
import { ConditionBadge, GenreChip, StatusBadge } from '../../components/badges';
import { CheckoutDialog } from '../../components/CheckoutDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { LocationCode } from '../../components/LocationCode';
import { EmptyState, ErrorState } from '../../components/states';
import { useListParams } from '../../components/useListParams';
import { useCart } from '../../lib/cart';
import { useFormat } from '../../lib/format';

const SORTS = [
  { value: 'title:asc', label: 'Title A–Z' }, { value: 'title:desc', label: 'Title Z–A' }, { value: 'author:asc', label: 'Author' },
  { value: 'price:asc', label: 'Price: low → high' }, { value: 'price:desc', label: 'Price: high → low' },
  { value: 'newest:desc', label: 'Newest first' }, { value: 'quantity:desc', label: 'Most copies' },
];
const rupeesToMinor = (v: string) => (v === '' ? undefined : Math.round(Number(v) * 100));

/** Search & browse. Staff/admin see central stock; a stall manager sees only the books at their stall (the server enforces it). */
export default function InventoryPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const { can, me } = useAuth();
  const cart = useCart();
  const isStallView = !can('inventory.read');
  const params = useListParams({ view: 'titles', status: 'available', sort: 'title:asc' });
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);
  const genres = useGenres();
  const stalls = useStalls();

  // search box: debounced into the URL
  const [text, setText] = useState(params.get('q'));
  const [debounced] = useDebouncedValue(text, 300);
  useEffect(() => { if (debounced !== params.get('q')) params.set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sortKey, order] = params.get('sort').split(':') as [string, 'asc' | 'desc'];
  const query = {
    q: params.get('q') || undefined,
    genreId: params.getAll('genreId'),
    condition: params.getAll('condition') as BookCondition[],
    minPrice: rupeesToMinor(params.get('min')),
    maxPrice: rupeesToMinor(params.get('max')),
    status: params.get('status') as InventoryStatus,
    stallId: params.get('stall') || undefined,
    sort: sortKey as never,
    order,
    page: params.page,
    pageSize: params.pageSize,
  };
  const view = params.get('view');
  const titlesQ = useTitles(view === 'titles' ? query : { ...query, pageSize: 1 });
  const copiesQ = useCopies(view === 'copies' ? (query as never) : { page: 1, pageSize: 1 });
  const active = view === 'titles' ? titlesQ : copiesQ;
  const data = active.data as { items: unknown[]; total: number; exactMatch?: { type: 'copy' | 'isbn'; code?: string; titleId?: string }; noActiveStall?: boolean } | undefined;

  // a pasted code / ISBN jumps straight to the book
  useEffect(() => {
    const m = data?.exactMatch;
    if (!m || !params.get('q')) return;
    if (m.type === 'copy' && m.code) navigate(`/copies/${m.code}`, { replace: true });
    else if (m.type === 'isbn' && m.titleId) navigate(`/inventory/titles/${m.titleId}`, { replace: true });
  }, [data?.exactMatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // bulk selection (copies view)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'checkout' | 'labels' | null>(null);
  useEffect(() => setSelected(new Set()), [view, params.sp.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = (copiesQ.data?.items ?? []) as CopyListItem[];
  const picked = rows.filter((r) => selected.has(r.id));

  const addToCart = () => {
    let added = 0;
    for (const r of picked) if (cart.add({ copyId: r.id, code: r.code, title: r.title, condition: r.condition, sellingPriceMinor: r.sellingPriceMinor, locationCode: r.locationCode, stallName: r.stall?.name ?? null }) === 'added') added++;
    notifications.show({ color: 'green', message: `${added} added to the cart` });
    setSelected(new Set());
  };

  const copyColumns: Column<CopyListItem>[] = [
    { key: 'sel', header: <Checkbox aria-label="Select all" checked={rows.length > 0 && selected.size === rows.length} indeterminate={selected.size > 0 && selected.size < rows.length} onChange={(e) => setSelected(e.currentTarget.checked ? new Set(rows.map((r) => r.id)) : new Set())} />, cell: (r) => <Checkbox aria-label={`Select ${r.code}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />, width: 40 },
    { key: 'code', header: 'Code', sort: 'code', cell: (r) => <Anchor component={Link} to={`/copies/${r.code}`} fw={600} size="sm" onClick={(e) => e.stopPropagation()}>{r.code}</Anchor> },
    { key: 'title', header: 'Title', sort: 'title', cell: (r) => <div><Text size="sm" fw={500} lineClamp={1}>{r.title}</Text><Text size="xs" c="dimmed" lineClamp={1}>{r.authors.join(', ')}</Text></div> },
    { key: 'cond', header: 'Condition', cell: (r) => <ConditionBadge condition={r.condition} />, hideBelow: 'sm' },
    { key: 'price', header: 'Price', sort: 'price', align: 'right', cell: (r) => <Text size="sm" fw={600}>{fmt.money(r.sellingPriceMinor)}</Text> },
    { key: 'loc', header: 'Location', sort: 'location', cell: (r) => <LocationCode code={r.locationCode} />, hideBelow: 'md' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} stall={r.stall?.name} />, hideBelow: 'md' },
  ];

  const stallValue = useMemo(() => (isStallView ? undefined : undefined), [isStallView]);
  void stallValue;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>{isStallView ? (me?.activeStall ? `Books at ${me.activeStall.name}` : 'My stall') : 'Inventory'}</Title>
          {isStallView && data && <Text c="dimmed" size="sm">{data.total} book{data.total === 1 ? '' : 's'}</Text>}
        </div>
        <SegmentedControl value={view} onChange={(v) => params.set({ view: v, sort: v === 'copies' && sortKey === 'quantity' ? 'title:asc' : params.get('sort') })} data={[{ value: 'titles', label: 'Titles' }, { value: 'copies', label: 'Copies' }]} />
      </Group>

      <Group wrap="nowrap">
        <TextInput flex={1} leftSection={<IconSearch size={16} />} placeholder="Search title, author, ISBN or book code" value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Search inventory" data-testid="inventory-search" />
        <Select aria-label="Sort" w={190} data={view === 'copies' ? [...SORTS.filter((s) => !s.value.startsWith('quantity')), { value: 'location:asc', label: 'Shelf location' }] : SORTS} value={params.get('sort')} onChange={(v) => v && params.set({ sort: v })} allowDeselect={false} />
        <ActionIcon variant={filtersOpen ? 'filled' : 'default'} size="lg" aria-label="Filters" onClick={toggleFilters}><IconAdjustments size={18} /></ActionIcon>
      </Group>

      <Collapse expanded={filtersOpen}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
          <MultiSelect label="Genre" data={(genres.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} value={params.getAll('genreId')} onChange={(v) => params.set({ genreId: v })} searchable clearable />
          <MultiSelect label="Condition" data={Conditions.values.map((c) => ({ value: c, label: t(`condition.${c}`) }))} value={params.getAll('condition')} onChange={(v) => params.set({ condition: v })} clearable />
          <Group grow align="flex-end">
            <NumberInput label="Price from" prefix="₹" min={0} value={params.get('min')} onChange={(v) => params.set({ min: String(v) })} />
            <NumberInput label="to" prefix="₹" min={0} value={params.get('max')} onChange={(v) => params.set({ max: String(v) })} />
          </Group>
          {!isStallView && (
            <Stack gap={4}>
              <SegmentedControl size="xs" value={params.get('status')} onChange={(v) => params.set({ status: v })} data={[{ value: 'available', label: 'Available' }, { value: 'atStalls', label: 'At stalls' }, { value: 'all', label: 'All' }]} />
              <Select placeholder="Any stall" size="xs" clearable data={(stalls.data ?? []).map((s) => ({ value: s.id, label: s.name }))} value={params.get('stall') || null} onChange={(v) => params.set({ stall: v })} />
            </Stack>
          )}
        </SimpleGrid>
      </Collapse>

      {view === 'copies' && selected.size > 0 && (
        <Group p="xs" style={{ background: 'var(--mantine-color-goonj-light)', borderRadius: 8 }}>
          <Text size="sm" fw={600}>{selected.size} selected</Text>
          {can('stall.checkout') && <Button size="compact-sm" onClick={() => setDialog('checkout')}>Check out to stall</Button>}
          {(can('sale.create.central') || can('sale.create.stall')) && <Button size="compact-sm" variant="light" onClick={addToCart}>Add to cart (sell)</Button>}
          {can('label.print') && <Button size="compact-sm" variant="light" onClick={() => setDialog('labels')}>Print labels</Button>}
          <Button size="compact-sm" variant="subtle" onClick={() => setSelected(new Set())}>Clear</Button>
        </Group>
      )}

      {active.isError ? <ErrorState error={active.error} onRetry={() => active.refetch()} /> : data?.noActiveStall ? (
        <Alert color="yellow" title="No stall assigned">You are not on an active stall yet.</Alert>
      ) : view === 'titles' ? (
        <>
          {!active.isLoading && data?.items.length === 0 && <EmptyState title="No books match">{params.get('q') ? 'Try a different spelling or fewer words.' : 'Nothing here yet.'}</EmptyState>}
          <Stack gap="xs">
            {(titlesQ.data?.items ?? []).map((tt: TitleListItem) => (
              <Card key={tt.id} withBorder padding="sm" component={Link} to={`/inventory/titles/${tt.id}`} style={{ textDecoration: 'none', color: 'inherit' }} data-testid="title-card">
                <Group wrap="nowrap" align="flex-start">
                  <BookCover url={tt.coverThumbUrl} title={tt.title} color={tt.genre.color} width={52} />
                  <Stack gap={2} flex={1} style={{ minWidth: 0 }}>
                    <Text fw={600} lineClamp={2}>{tt.title}</Text>
                    <Text size="sm" c="dimmed" lineClamp={1}>{tt.authors.join(', ') || '—'}</Text>
                    <Group gap={6}><GenreChip genre={tt.genre} />{tt.conditions.map((c) => <ConditionBadge key={c} condition={c} />)}</Group>
                  </Stack>
                  <Stack gap={0} align="flex-end">
                    <Text fw={700}>{tt.minPriceMinor === tt.maxPriceMinor ? fmt.money(tt.minPriceMinor) : `${fmt.money(tt.minPriceMinor)} – ${fmt.money(tt.maxPriceMinor)}`}</Text>
                    <Badge variant="light">{tt.availableCount} cop{tt.availableCount === 1 ? 'y' : 'ies'}</Badge>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Stack>
          {titlesQ.data && titlesQ.data.total > 0 && <Pager total={titlesQ.data.total} params={params} />}
        </>
      ) : (
        <DataTable
          columns={copyColumns} rows={rows} rowKey={(r) => r.id} loading={copiesQ.isLoading} total={copiesQ.data?.total} page={params.page} pageSize={params.pageSize}
          onPage={(p) => params.set({ page: p }, { keepPage: true })} onPageSize={(n) => params.set({ pageSize: n })}
          sort={{ key: sortKey, order }} onSort={(k) => params.set({ sort: `${k}:${sortKey === k && order === 'asc' ? 'desc' : 'asc'}` })}
          onRowClick={(r) => navigate(`/copies/${r.code}`)} empty={<EmptyState title="No copies match" />}
        />
      )}

      <CheckoutDialog opened={dialog === 'checkout'} onClose={() => setDialog(null)} mode={{ kind: 'copies', copyIds: picked.map((p) => p.id) }} onDone={() => setSelected(new Set())} />
      <LabelPrintDialog opened={dialog === 'labels'} onClose={() => setDialog(null)} copyIds={picked.map((p) => p.id)} canMarkPrinted={can('inventory.read')} />
    </Stack>
  );
}

function Pager({ total, params }: { total: number; params: ReturnType<typeof useListParams> }) {
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">{total.toLocaleString('en-IN')} titles</Text>
      <Group gap="xs">
        <Select aria-label="Per page" w={86} size="xs" data={['25', '50', '100']} value={String(params.pageSize)} onChange={(v) => v && params.set({ pageSize: v })} allowDeselect={false} />
        <Button size="compact-sm" variant="default" disabled={params.page <= 1} onClick={() => params.set({ page: params.page - 1 }, { keepPage: true })}>Previous</Button>
        <Text size="sm">Page {params.page} of {pages}</Text>
        <Button size="compact-sm" variant="default" disabled={params.page >= pages} onClick={() => params.set({ page: params.page + 1 }, { keepPage: true })}>Next</Button>
      </Group>
    </Group>
  );
}
