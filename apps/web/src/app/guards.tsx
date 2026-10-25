import type { Permission } from '@bookstall/shared';
import { Button, Center, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { PageSkeleton } from '../components/states';
import { useAuth } from './auth';

export function RequireAuth() {
  const { status, me } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Center h="100vh" p="xl"><PageSkeleton /></Center>;
  if (status === 'anon') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me?.user.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

/** Pages guard themselves too; the API enforces everything independently. */
export function RequirePermission({ any, children }: { any: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  return any.some(can) ? <>{children}</> : <ForbiddenPage />;
}

export function ForbiddenPage() {
  return (
    <Center py={80}>
      <Stack align="center" gap="xs">
        <Title order={2}>403</Title>
        <Text c="dimmed">You don't have permission to see this page.</Text>
        <Button component={Link} to="/" variant="light">Back to the dashboard</Button>
      </Stack>
    </Center>
  );
}

export function NotFoundPage() {
  return (
    <Center py={80}>
      <Stack align="center" gap="xs">
        <Title order={2}>Page not found</Title>
        <Button component={Link} to="/" variant="light">Back to the dashboard</Button>
      </Stack>
    </Center>
  );
}
