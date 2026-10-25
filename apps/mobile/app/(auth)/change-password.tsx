import { errorMessage } from '@bookstall/api-client';
import { passwordSchema } from '@bookstall/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, ProgressBar, Text, TextInput } from 'react-native-paper';
import { Screen } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';

const strength = (p: string) => [p.length >= 8, p.length >= 12, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p) && /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;

export default function ChangePassword() {
  const { me, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = me?.user.mustChangePassword;

  const submit = async () => {
    setError(null);
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid password');
    if (next !== again) return setError('The two new passwords do not match');
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: 12, marginTop: 48 }}>
        <Text variant="headlineSmall">{forced ? 'Choose a new password' : 'Change password'}</Text>
        {forced && <Text style={{ opacity: 0.7 }}>Set your own password before continuing.</Text>}
        <TextInput label={forced ? 'Temporary password' : 'Current password'} secureTextEntry value={current} onChangeText={setCurrent} />
        <TextInput label="New password" secureTextEntry value={next} onChangeText={setNext} />
        <ProgressBar progress={strength(next) / 4} color={['#e03131', '#e03131', '#f08c00', '#fab005', '#2f9e44'][strength(next)]} />
        <TextInput label="Repeat new password" secureTextEntry value={again} onChangeText={setAgain} />
        {error && <HelperText type="error" visible>{error}</HelperText>}
        <Button mode="contained" onPress={submit} loading={busy} disabled={!current || !next || !again}>Change password</Button>
        {forced && <Button onPress={() => void logout()}>Sign out</Button>}
      </View>
    </Screen>
  );
}
