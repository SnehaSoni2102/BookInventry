import type { BookCondition, CopyListItem, InventoryPage, InventoryStatus, TitleListItem } from '@bookstall/shared';
import { BookCondition as Conditions } from '@bookstall/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, RefreshControl, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Menu, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GenrePicker } from '../../../src/components/GenrePicker';
import { Empty, ErrorBox, styles } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';
import { useAuth } from '../../../src/lib/auth';
import { useCart } from '../../../src/lib/cart';
import { CONDITION_LABEL, STATUS_LABEL, useFormat } from '../../../src/lib/format';
import { APP_URL } from '../../../src/lib/config';

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'title:asc', label: 'Title A–Z' }, { key: 'author:asc', label: 'Author' }, { key: 'price:asc', label: 'Price ↑' },
  { key: 'price:desc', label: 'Price ↓' }, { key: 'newest:desc', label: 'Newest' }, { key: 'quantity:desc', label: 'Most copies' },
];
const absolute = (u: string | null) => (u ? (u.startsWith('http') ? u : `${APP_URL}${u}`) : null);

/** Search & browse with infinite scroll. Managers see only their stall (enforced by the server). */
export default function InventoryScreen() {
  const fmt = useFormat();
  const { can } = useAuth();
  const cart = useCart();
  const stallView = !can('inventory.read');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'titles' | 'copies'>('titles');
  const [sort, setSort] = useState('title:asc');
  const [status, setStatus] = useState<InventoryStatus>('available');
  const [conditions, setConditions] = useState<BookCondition[]>([]);
  const [genreId, setGenreId] = useState<string | null>(null);
  const [sortMenu, setSortMenu] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const [sortKey, order] = sort.split(':') as [string, 'asc' | 'desc'];
  const params = { q: q || undefined, status, condition: conditions.length ? conditions : undefined, genreId: genreId ? [genreId] : undefined, sort: (view === 'copies' && sortKey === 'quantity' ? 'title' : sortKey) as never, order, pageSize: 25 };
  const query = useInfiniteQuery({
    queryKey: ['titles', 'infinite', view, params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      (view === 'titles' ? api.titles.list({ ...params, page: pageParam }) : api.copies.list({ ...params, page: pageParam })) as Promise<InventoryPage<TitleListItem | CopyListItem>>,
    getNextPageParam: (last, all) => (all.length * 25 < last.total ? all.length + 1 : undefined),
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const first = query.data?.pages[0];

  useEffect(() => {
    const m = first?.exactMatch;
    if (!m || !q) return;
    if (m.type === 'copy' && m.code) router.replace(`/copies/${m.code}`);
    else if (m.type === 'isbn' && m.titleId) router.replace(`/inventory/${m.titleId}`);
  }, [first?.exactMatch, q]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = (items as CopyListItem[]).filter((c) => selected.has(c.id));

  const header = (
    <View style={{ gap: 8, padding: 12 }}>
      <Searchbar placeholder="Title, author, ISBN or code" value={text} onChangeText={setText} testID="inventory-search" />
      <SegmentedButtons density="small" value={view} onValueChange={(v) => { setView(v as typeof view); setSelected(new Set()); }} buttons={[{ value: 'titles', label: 'Titles' }, { value: 'copies', label: 'Copies' }]} />
      <View style={styles.wrap}>
        <Menu visible={sortMenu} onDismiss={() => setSortMenu(false)} anchor={<Chip icon="sort" onPress={() => setSortMenu(true)}>{SORTS.find((s) => s.key === sort)?.label}</Chip>}>
          {SORTS.filter((s) => view === 'titles' || !s.key.startsWith('quantity')).map((s) => <Menu.Item key={s.key} title={s.label} onPress={() => { setSort(s.key); setSortMenu(false); }} />)}
        </Menu>
        {!stallView && (['available', 'atStalls', 'all'] as const).map((s) => <Chip key={s} selected={status === s} showSelectedCheck={false} onPress={() => setStatus(s)}>{s === 'available' ? 'Available' : s === 'atStalls' ? 'At stalls' : 'All'}</Chip>)}
      </View>
      <View style={styles.wrap}>
        {Conditions.values.map((c) => <Chip key={c} compact selected={conditions.includes(c)} showSelectedCheck={false} onPress={() => setConditions((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}>{CONDITION_LABEL[c]}</Chip>)}
      </View>
      <GenrePicker value={genreId} onChange={setGenreId} />
      {genreId && <Button compact onPress={() => setGenreId(null)}>Clear genre</Button>}
      {view === 'copies' && selected.size > 0 && (
        <View style={styles.wrap}>
          <Text variant="labelLarge">{selected.size} selected</Text>
          {can('stall.checkout') && <Button compact mode="contained" onPress={() => router.push({ pathname: '/stalls/checkout', params: { copyIds: picked.map((p) => p.id).join(','), n: String(picked.length) } })}>Check out</Button>}
          {(can('sale.create.central') || can('sale.create.stall')) && <Button compact mode="outlined" onPress={() => { picked.forEach((p) => cart.add({ copyId: p.id, code: p.code, title: p.title, condition: p.condition, sellingPriceMinor: p.sellingPriceMinor, locationCode: p.locationCode, stallName: p.stall?.name ?? null })); setSelected(new Set()); }}>Add to cart</Button>}
          <Button compact onPress={() => setSelected(new Set())}>Clear</Button>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.fill}>
      <FlatList
        data={items as Array<TitleListItem | CopyListItem>}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} />}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<>{query.isLoading ? <ActivityIndicator style={{ margin: 32 }} /> : query.isError ? <ErrorBox error={query.error} onRetry={() => void query.refetch()} /> : first?.noActiveStall ? <Empty title="No stall assigned" /> : <Empty title="No books match" />}</>}
        ListFooterComponent={<>{query.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} /> : null}</>}
        renderItem={({ item }) =>
          view === 'titles' ? (
            <TitleRow t={item as TitleListItem} price={fmt.money} />
          ) : (
            <CopyRow c={item as CopyListItem} price={fmt.money} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} selecting={selected.size > 0} />
          )
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

function TitleRow({ t, price }: { t: TitleListItem; price: (m: number) => string }) {
  const cover = absolute(t.coverThumbUrl);
  return (
    <Card style={{ marginHorizontal: 12, marginBottom: 8 }} onPress={() => router.push(`/inventory/${t.id}`)} testID="title-card">
      <Card.Content style={[styles.row, { alignItems: 'flex-start' }]}>
        {cover ? <Image source={{ uri: cover }} style={{ width: 44, height: 64, borderRadius: 4 }} /> : <View style={{ width: 44, height: 64, borderRadius: 4, backgroundColor: t.genre.color }} />}
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={2}>{t.title}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.7 }} numberOfLines={1}>{t.authors.join(', ')}</Text>
          <Text variant="bodySmall">{t.genre.code} · {t.conditions.map((c) => CONDITION_LABEL[c]).join(', ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="titleSmall">{t.minPriceMinor === t.maxPriceMinor ? price(t.minPriceMinor) : `${price(t.minPriceMinor)}+`}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.7 }}>{t.availableCount} cop{t.availableCount === 1 ? 'y' : 'ies'}</Text>
        </View>
      </Card.Content>
    </Card>
  );
}

function CopyRow({ c, price, selected, onToggle, selecting }: { c: CopyListItem; price: (m: number) => string; selected: boolean; onToggle: () => void; selecting: boolean }) {
  return (
    <Card style={{ marginHorizontal: 12, marginBottom: 8, borderWidth: selected ? 2 : 0, borderColor: '#B8763F' }} onPress={() => (selecting ? onToggle() : router.push(`/copies/${c.code}`))} onLongPress={onToggle}>
      <Card.Content style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1}>{c.title}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.7 }}>{c.code} · {CONDITION_LABEL[c.condition]} · {c.status === 'AT_STALL' && c.stall ? `at ${c.stall.name}` : STATUS_LABEL[c.status]}</Text>
          <Text variant="bodySmall" style={{ fontWeight: '700' }}>{c.locationCode ?? 'UNSHELVED'}</Text>
        </View>
        <Text variant="titleSmall">{price(c.sellingPriceMinor)}</Text>
      </Card.Content>
    </Card>
  );
}
