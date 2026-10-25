import { Alert, Button, Center, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@bookstall/api-client';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs" maw={420} ta="center">
        <IconInbox size={40} color="var(--mantine-color-dimmed)" />
        <Title order={4}>{title}</Title>
        {children && <Text c="dimmed" size="sm">{children}</Text>}
        {action}
      </Stack>
    </Center>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert color="red" icon={<IconAlertCircle />} title="Something went wrong" role="alert">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry && <Button size="xs" variant="light" onClick={onRetry}>Try again</Button>}
      </Stack>
    </Alert>
  );
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Stack gap="sm" aria-busy="true" aria-label="Loading">
      <Skeleton h={28} w="40%" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={44} />)}
    </Stack>
  );
}
