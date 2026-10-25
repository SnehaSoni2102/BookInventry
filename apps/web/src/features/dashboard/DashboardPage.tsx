import { useDashboard } from '@bookstall/api-client';
import { Alert, Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconScan } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useAuth } from '../../app/auth';
import { LiveStallTotals } from '../../components/LiveStallTotals';
import { ErrorState, PageSkeleton } from '../../components/states';
import { useFormat } from '../../lib/format';

function Kpi({ label, value, to, color }: { label: string; value: string | number; to?: string; color?: string }) {
  const body = (
    <Card withBorder padding="md" h="100%">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={800} c={color} data-testid={`kpi-${label}`}>{value}</Text>
    </Card>
  );
  return to ? <Anchor component={Link} to={to} underline="never" c="inherit">{body}</Anchor> : body;
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const q = useDashboard();
  const fmt = useFormat();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;

  return (
    <Stack>
      <Title order={2}>Hello, {me?.user.displayName}</Title>

      {d.myStall && (
        <>
          {d.myStall.stall ? (
            <Group>
              <Title order={4}>{d.myStall.stall.name}</Title>
              <Badge color={d.myStall.stall.status === 'ACTIVE' ? 'green' : 'yellow'}>{d.myStall.stall.status.toLowerCase()}</Badge>
            </Group>
          ) : (
            <Alert color="yellow" title="No stall assigned">Ask an administrator to assign you to a stall before you can sell.</Alert>
          )}
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Kpi label="Books at stall" value={d.myStall.booksAtStall} to="/my-stall" />
            <Kpi label="Value at stall" value={fmt.money(d.myStall.valueAtStallMinor)} />
            <Kpi label="My sales today" value={d.myStall.today.salesCount} to="/sales" />
            <Kpi label="My revenue today" value={fmt.money(d.myStall.today.revenueMinor)} color="green" />
          </SimpleGrid>
          <Button component={Link} to="/scan?mode=sell" size="xl" leftSection={<IconScan />} disabled={!d.myStall.stall}>Scan to sell</Button>
        </>
      )}

      {d.inventory && (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
          <Kpi label="Titles" value={d.inventory.titles.toLocaleString('en-IN')} to="/inventory" />
          <Kpi label="In stock" value={d.inventory.inStock.toLocaleString('en-IN')} to="/inventory" />
          <Kpi label="At stalls" value={d.inventory.atStalls.toLocaleString('en-IN')} to="/inventory?status=atStalls" />
          <Kpi label="Unshelved" value={d.inventory.unshelved} to="/shelves" color={d.inventory.unshelved ? 'red' : undefined} />
          <Kpi label="Labels pending" value={d.inventory.labelsPending} to="/labels" color={d.inventory.labelsPending ? 'orange' : undefined} />
          {d.salesToday && <Kpi label="Revenue today" value={fmt.money(d.salesToday.total.revenueMinor)} to="/sales" color="green" />}
        </SimpleGrid>
      )}

      {d.shelfAlerts && d.shelfAlerts.length > 0 && (
        <Alert color="yellow" title="Shelf space is running low">
          {d.shelfAlerts.map((a) => `${a.code} ${a.percentFull}%`).join(' · ')} — <Anchor component={Link} to="/shelves">add rows</Anchor>
        </Alert>
      )}

      {d.salesToday && (
        <Stack gap="xs">
          <Title order={4}>Today by stall</Title>
          <LiveStallTotals rows={d.salesToday.rows} total={d.salesToday.total} />
        </Stack>
      )}

      {!d.salesToday && d.activeStalls && can('stall.checkout') && (
        <Stack gap="xs">
          <Title order={4}>Active stalls</Title>
          {d.activeStalls.length === 0 ? <Text c="dimmed">No stalls are active right now.</Text> : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {d.activeStalls.map((s) => (
                <Card key={s.id} withBorder component={Link} to={`/stalls/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <Text fw={600}>{s.name}</Text><Text size="sm" c="dimmed">{s.counts.atStall} books out</Text>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      )}

      {d.inventory && !d.myStall && (
        <Group>
          {can('copy.create') && <Button component={Link} to="/books/new">Add a book</Button>}
          <Button component={Link} to="/scan" variant="light">Scan station</Button>
          {can('stall.checkin') && <Button component={Link} to="/scan?mode=checkin" variant="light">Check in</Button>}
        </Group>
      )}

      {d.recentSales && d.recentSales.length > 0 && (
        <Stack gap="xs">
          <Title order={4}>Latest sales</Title>
          {d.recentSales.map((s) => (
            <Group key={s.id} justify="space-between" wrap="nowrap">
              <Text size="sm"><b>{s.receiptNo}</b> · {s.soldAtLabel} · {s.itemsCount} book{s.itemsCount === 1 ? '' : 's'}</Text>
              <Text size="sm" fw={600}>{fmt.money(s.totalMinor)}</Text>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
