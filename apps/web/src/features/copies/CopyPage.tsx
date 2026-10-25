import type { CopyAction } from '@bookstall/shared';
import { Alert, Anchor, Badge, Card, Divider, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../../app/api';
import { qk } from '@bookstall/api-client';
import { BookCover } from '../../components/BookCover';
import { ConditionBadge, GenreChip, StatusBadge } from '../../components/badges';
import { LocationCode } from '../../components/LocationCode';
import { ErrorState, PageSkeleton } from '../../components/states';
import { useFormat } from '../../lib/format';
import { CopyActions } from './CopyActions';

/** The scan target: everything about one physical book, plus the actions this user may take on it. */
export default function CopyPage() {
  const { code = '' } = useParams();
  const fmt = useFormat();
  const q = useQuery({
    // under ['copies', ...] so the realtime handler's inventory invalidation refreshes it
    queryKey: [...qk.copies.byCode(code.toUpperCase()), 'resolve'],
    queryFn: () => api.scan.resolve(code),
    retry: false,
  });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  if (r.kind !== 'copy') return <ErrorState error={new Error('That code is not a book label')} />;
  if ('blocked' in r) {
    return (
      <Alert color="orange" title="This book isn't at your stall" data-testid="blocked">
        <Text>{r.copy.title}</Text>
        <Text size="sm" c="dimmed">{r.copy.code}. Only books checked out to your stall can be sold here.</Text>
      </Alert>
    );
  }
  const { copy, actions } = r;
  const t = copy.title;
  const sellingAt = (actions as CopyAction[]).find((a) => a.action === 'SELL');
  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group align="flex-start" wrap="nowrap">
          <BookCover url={t.coverUrl} title={t.title} color={t.genre.color} width={96} />
          <Stack gap={4}>
            <Title order={2} data-testid="copy-title">{t.title}</Title>
            {t.authors.length > 0 && <Text c="dimmed">{t.authors.join(', ')}</Text>}
            <Group gap={6}><GenreChip genre={t.genre} /><ConditionBadge condition={copy.condition} /><StatusBadge status={copy.status} stall={copy.stall?.name} /></Group>
            <Anchor component={Link} to={`/inventory/titles/${t.id}`} size="sm">All copies of this title</Anchor>
          </Stack>
        </Group>
        <Stack gap={2} align="flex-end">
          <Text size="xs" c="dimmed">Shelf location</Text>
          <LocationCode code={copy.locationCode} size="xl" />
          <Text size="xs" c="dimmed">{copy.code}</Text>
        </Stack>
      </Group>

      {copy.status === 'AT_STALL' && copy.stall && (
        <Alert color="violet" title={`Checked out to ${copy.stall.name}`}>
          {copy.openMovement ? `Since ${fmt.dateTime(copy.openMovement.checkedOutAt)} by ${copy.openMovement.checkedOutBy}. ` : ''}
          It goes back to <b>{copy.locationCode ?? 'a new slot'}</b>.
        </Alert>
      )}
      {copy.status === 'SOLD' && copy.sale && <Alert color="gray" title="Sold">On {fmt.dateTime(copy.sale.soldAt)} · receipt {copy.sale.receiptNo} · {fmt.money(copy.sale.soldPriceMinor)}</Alert>}
      {copy.status === 'WRITTEN_OFF' && <Alert color="red" title="Written off" />}

      <Card withBorder>
        <Group gap="xl" wrap="wrap">
          <div><Text size="xs" c="dimmed">Selling price</Text><Text size="28px" fw={800} data-testid="copy-price">{fmt.money(copy.sellingPriceMinor)}</Text></div>
          <div><Text size="xs" c="dimmed">MRP</Text><Text size="lg" td={copy.originalPriceMinor ? 'line-through' : undefined}>{fmt.money(copy.originalPriceMinor)}</Text></div>
          {copy.donorName && <div><Text size="xs" c="dimmed">Donor</Text><Text>{copy.donorName}</Text></div>}
        </Group>
        <Divider my="sm" />
        <CopyActions copy={copy} actions={actions} onChanged={() => void q.refetch()} />
        {!sellingAt && actions.length === 0 && <Text size="sm" c="dimmed">No actions are available for this book.</Text>}
      </Card>

      {t.summary && <Text size="sm">{t.summary}</Text>}
      <Table withRowBorders={false} verticalSpacing={2} w="fit-content">
        <Table.Tbody>
          {[['ISBN', t.isbn13], ['Publisher', t.publisher], ['Year', t.publishedYear], ['Pages', t.pageCount], ['Language', t.language]].map(([k, v]) => v ? <Table.Tr key={String(k)}><Table.Td c="dimmed">{k}</Table.Td><Table.Td>{String(v)}</Table.Td></Table.Tr> : null)}
        </Table.Tbody>
      </Table>
      {copy.conditionNotes && <Text size="sm"><b>Condition notes:</b> {copy.conditionNotes}</Text>}

      {copy.movements.length > 0 && (
        <Stack gap={4}>
          <Title order={5}>Stall history</Title>
          {copy.movements.map((m) => (
            <Group key={m.id} gap="xs"><Badge variant="light" color={m.outcome === 'OPEN' ? 'violet' : 'gray'}>{m.outcome.toLowerCase()}</Badge><Text size="sm">{m.stall.name} · out {fmt.dateTime(m.checkedOutAt)}{m.checkedInAt ? ` · back ${fmt.dateTime(m.checkedInAt)}` : ''}</Text></Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
