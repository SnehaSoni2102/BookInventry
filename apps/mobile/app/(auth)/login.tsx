import { errorMessage } from '@bookstall/api-client';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { Screen } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { useOnline } from '../../src/lib/network';

export default function Login() {
  const { login } = useAuth();
  const online = useOnline();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await login(username.trim().toLowerCase(), password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ gap: 12, marginTop: 64 }}>
          <Image source={require('../../assets/goonj-logo.png')} style={{ width: 200, height: 128, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Goonj" />
          <Text variant="headlineSmall" style={{ fontWeight: '700' }}>Book Stall</Text>
          <Text style={{ opacity: 0.7 }}>Sign in to continue</Text>
          <TextInput label="Username" autoCapitalize="none" autoCorrect={false} textContentType="username" value={username} onChangeText={setUsername} testID="login-username" />
          <TextInput
            label="Password" secureTextEntry={!show} autoCapitalize="none" textContentType="password" value={password} onChangeText={setPassword} onSubmitEditing={submit}
            right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow((s) => !s)} />} testID="login-password"
          />
          {!online && <HelperText type="info" visible>No internet connection.</HelperText>}
          {error && <HelperText type="error" visible>{error}</HelperText>}
          <Button mode="contained" onPress={submit} loading={busy} disabled={!username || !password || !online} contentStyle={{ paddingVertical: 6 }} testID="login-submit">Sign in</Button>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
