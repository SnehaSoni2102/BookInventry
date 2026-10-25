import { errorMessage } from '@bookstall/api-client';
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../app/auth';

export default function LoginPage() {
  const { status, login, me } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status === 'authed') {
    const next = sp.get('next');
    return <Navigate to={me?.user.mustChangePassword ? '/change-password' : next && next.startsWith('/') ? next : '/'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(username.trim(), password);
      navigate(res.mustChangePassword ? '/change-password' : sp.get('next')?.startsWith('/') ? sp.get('next')! : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={380} maw="100%">
        <form onSubmit={submit}>
          <Stack>
            <img src="/goonj-logo.png" alt="Goonj" style={{ width: 220, maxWidth: '100%', alignSelf: 'center' }} />
            <div>
              <Title order={2}>Book Stall</Title>
              <Text c="dimmed" size="sm">Sign in to continue</Text>
            </div>
            <TextInput label="Username" autoComplete="username" autoCapitalize="none" autoFocus required value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
            <PasswordInput
              label="Password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
              description={caps ? 'Caps Lock is on' : undefined}
            />
            {error && <Alert color="red" role="alert">{error}</Alert>}
            <Button type="submit" loading={busy} fullWidth>Sign in</Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
