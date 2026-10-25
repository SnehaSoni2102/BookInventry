import { errorMessage } from '@bookstall/api-client';
import { passwordSchema } from '@bookstall/shared';
import { Alert, Button, Center, Paper, PasswordInput, Progress, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';

/** 0–4: rough strength for the meter. The server enforces the real rules (length + common-password list). */
export function strength(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return s;
}

export default function ChangePasswordPage() {
  const { me, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = me?.user.mustChangePassword;
  const s = strength(next);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid password');
    if (next !== again) return setError('The two new passwords do not match');
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      notifications.show({ color: 'green', message: 'Password changed' });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="80vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={420} maw="100%">
        <form onSubmit={submit}>
          <Stack>
            <Title order={3}>{forced ? 'Choose a new password' : 'Change password'}</Title>
            {forced && <Text size="sm" c="dimmed">For your security, set your own password before continuing.</Text>}
            <PasswordInput label={forced ? 'Temporary password' : 'Current password'} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.currentTarget.value)} />
            <PasswordInput label="New password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.currentTarget.value)} description="At least 8 characters; avoid common passwords." />
            <Progress value={(s / 4) * 100} color={['red', 'red', 'orange', 'yellow', 'green'][s]} size="sm" aria-label="Password strength" />
            <PasswordInput label="Repeat new password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.currentTarget.value)} />
            {error && <Alert color="red" role="alert">{error}</Alert>}
            <Button type="submit" loading={busy}>Change password</Button>
            {forced && <Button variant="subtle" color="gray" onClick={() => void logout()}>Sign out</Button>}
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
