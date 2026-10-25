import { Alert, Badge, Card, Center, Container, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { useFormat } from '../../lib/format';
import { ConditionBadge } from '../../components/badges';
import { BookCover } from '../../components/BookCover';

/**
 * The page behind every QR sticker. A customer's phone camera lands here without logging in: it shows only
 * what the server chose to publish. A signed-in volunteer is sent to the full copy page instead.
 */
export default function PublicCopyPage() {
  const { code = '' } = useParams();
  const { status } = useAuth();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['public', code], queryFn: () => api.publicPages.copy(code), enabled: status === 'anon', retry: false });

  if (status === 'authed') return <Navigate to={`/copies/${code}`} replace />;
  if (status === 'loading' || q.isLoading) return <Center h="100vh"><Loader /></Center>;
  if (q.isError || !q.data) {
    return (
      <Container size="xs" py="xl">
        <Alert color="gray" title="Book not found">This sticker doesn't match a book we know about.</Alert>
      </Container>
    );
  }
  const b = q.data;
  const sold = b.availability !== 'AVAILABLE';
  return (
    <Container size="xs" py="md">
      <Stack gap="md">
        <img src="/goonj-logo.png" alt={b.orgName} style={{ width: 160, maxWidth: '60%' }} />
        <Card withBorder padding="lg">
          <Stack>
            <Group wrap="nowrap" align="flex-start">
              {b.coverUrl !== undefined && <BookCover url={b.coverUrl} title={b.title ?? ''} color={b.genre?.color} width={110} />}
              <Stack gap={4} style={{ minWidth: 0 }}>
                {b.title && <Title order={3}>{b.title}</Title>}
                {b.authors?.length ? <Text c="dimmed">{b.authors.join(', ')}</Text> : null}
                <Group gap={6}>
                  {b.genre && <Badge variant="outline" style={{ borderColor: b.genre.color, color: 'inherit' }}>{b.genre.name}</Badge>}
                  {b.condition && <ConditionBadge condition={b.condition} />}
                </Group>
              </Stack>
            </Group>
            {b.sellingPriceMinor !== undefined && (
              <Group align="baseline" gap="sm">
                <Text size="32px" fw={800} data-testid="public-price">{fmt.money(b.sellingPriceMinor)}</Text>
                {b.originalPriceMinor ? <Text td="line-through" c="dimmed">{fmt.money(b.originalPriceMinor)}</Text> : null}
              </Group>
            )}
            <Badge size="lg" color={sold ? 'gray' : 'green'} variant="light">{b.availability === 'AVAILABLE' ? 'Available' : b.availability === 'SOLD' ? 'Sold' : 'Not available'}</Badge>
            {b.summary && <Text size="sm">{b.summary}</Text>}
            <Text size="xs" c="dimmed">Book {b.code}</Text>
          </Stack>
        </Card>
        <Text size="xs" c="dimmed" ta="center">Volunteer? <a href={`/login?next=/copies/${b.code}`}>Log in</a></Text>
      </Stack>
    </Container>
  );
}
