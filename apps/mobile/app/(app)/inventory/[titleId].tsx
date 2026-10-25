import { useTitle } from '@bookstall/api-client';
import type { CopyGroup } from '@bookstall/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Text } from 'react-native-paper';
import { LabelSheet } from '../../../src/components/LabelSheet';
import { SaleForm } from '../../../src/components/SaleForm';
import { ErrorBox, Loading, Screen, styles } from '../../../src/components/ui';
import { useAuth } from '../../../src/lib/auth';
import { APP_URL } from '../../../src/lib/config';
import { CONDITION_LABEL, STATUS_LABEL, useFormat } from '../../../src/lib/format';

export default function TitleScreen() {
  const { titleId } = useLocalSearchParams<{ titleId: string }>();
  const q = useTitle(titleId);
  const fmt = useFormat();
  const { can } = useAuth();
  const [sell, setSell] = useState<CopyGroup | null>(null);
  const [pickCode, setPickCode] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [more, setMore] = useState(false);
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const t = q.data!;
  const cover = t.coverUrl ? (t.coverUrl.startsWith('http') ? t.coverUrl : `${APP_URL}${t.coverUrl}`) : null;
  const sellable = (g: CopyGroup) => (g.status === 'IN_STOCK' && can('sale.create.central')) || (g.status === 'AT_STALL' && (can('sale.create.central') || can('sale.create.stall')));
  const chosen = sell?.copies.find((c) => c.code === pickCode) ?? sell?.copies[0];

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        {cover ? <Image source={{ uri: cover }} style={{ width: 90, height: 130, borderRadius: 6 }} /> : <View style={{ width: 90, height: 130, borderRadius: 6, backgroundColor: t.genre.color }} />}
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="titleLarge">{t.title}</Text>
          {t.subtitle ? <Text style={{ opacity: 0.7 }}>{t.subtitle}</Text> : null}
          <Text>{t.authors.join(', ')}</Text>
          <Chip compact style={{ alignSelf: 'flex-start' }}>{t.genre.name}</Chip>
          <Text variant="bodySmall" style={{ opacity: 0.7 }}>{[t.publisher, t.publishedYear, t.pageCount ? `${t.pageCount} pages` : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      {t.summary ? <><Text numberOfLines={more ? undefined : 4}>{t.summary}</Text><Button compact onPress={() => setMore((m) => !m)}>{more ? 'Less' : 'More'}</Button></> : null}

      {t.copyGroups.map((g) => (
        <Card key={`${g.condition}-${g.sellingPriceMinor}-${g.status}-${g.stall?.id ?? ''}`}>
          <Card.Content style={{ gap: 6 }}>
            <View style={styles.between}>
              <Text variant="titleMedium">{g.quantity} × {CONDITION_LABEL[g.condition]} · {fmt.money(g.sellingPriceMinor)}</Text>
              <Chip compact>{g.status === 'AT_STALL' && g.stall ? `At ${g.stall.name}` : STATUS_LABEL[g.status]}</Chip>
            </View>
            {g.copies.slice(0, 6).map((c) => <Text key={c.id} variant="bodySmall" onPress={() => router.push(`/copies/${c.code}`)} style={{ color: '#B8763F' }}>{c.code} · {c.locationCode ?? 'unshelved'}</Text>)}
            {g.copies.length > 6 && <Text variant="bodySmall" style={{ opacity: 0.6 }}>+{g.copies.length - 6} more</Text>}
            <View style={styles.wrap}>
              {sellable(g) && <Button compact mode="contained" onPress={() => { setSell(g); setPickCode(null); }}>Sell</Button>}
              {can('stall.checkout') && g.status === 'IN_STOCK' && <Button compact mode="outlined" onPress={() => router.push({ pathname: '/stalls/checkout', params: { titleId: t.id, title: t.title, condition: g.condition, price: String(g.sellingPriceMinor), max: String(g.quantity) } })}>Check out</Button>}
              {can('label.print') && <Button compact onPress={() => setLabels(g.copies.map((c) => c.id))}>Labels</Button>}
            </View>
          </Card.Content>
        </Card>
      ))}
      {can('copy.create') && <Button mode="outlined" onPress={() => router.push({ pathname: '/add', params: t.isbn13 ? { isbn: t.isbn13 } : {} })}>Add a copy</Button>}

      <Portal>
        <Dialog visible={Boolean(sell)} onDismiss={() => { setSell(null); void q.refetch(); }}>
          <Dialog.Title>Sell this book</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 520 }}>
            <View style={{ gap: 8, paddingVertical: 8 }}>
              {chosen && sell && (
                <>
                  <Text>Take the copy with code <Text style={{ fontWeight: '700' }}>{chosen.code}</Text>{chosen.locationCode ? ` from ${chosen.locationCode}` : ''}.</Text>
                  {sell.copies.length > 1 && <View style={styles.wrap}>{sell.copies.slice(0, 8).map((c) => <Chip key={c.id} selected={c.code === chosen.code} onPress={() => setPickCode(c.code)}>{c.code}</Chip>)}</View>}
                  <SaleForm items={[{ copyId: chosen.id, code: chosen.code, title: t.title, condition: sell.condition, sellingPriceMinor: sell.sellingPriceMinor, locationCode: chosen.locationCode, stallName: chosen.stall?.name ?? null }]} onSold={() => undefined} onNewSale={() => { setSell(null); void q.refetch(); }} />
                </>
              )}
            </View>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
      <LabelSheet visible={Boolean(labels)} onClose={() => setLabels(null)} copyIds={labels ?? []} />
    </Screen>
  );
}
