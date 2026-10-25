import { qk } from '@bookstall/api-client';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { CopyView } from '../../../src/components/CopyView';
import { ErrorBox, Loading, Screen } from '../../../src/components/ui';
import { api } from '../../../src/lib/api';

/** Scan target and App Link target: every detail of one copy plus the actions this user may take. */
export default function CopyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const q = useQuery({ queryKey: [...qk.copies.byCode(String(code).toUpperCase()), 'resolve'], queryFn: () => api.scan.resolve(String(code)), retry: false });
  const r = q.data;
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {r?.kind === 'copy' && 'blocked' in r && <><Text variant="titleMedium">{r.copy.title}</Text><Text>This book isn’t at your stall, so it can’t be sold here.</Text></>}
      {r?.kind === 'copy' && !('blocked' in r) && <CopyView copy={r.copy} actions={r.actions} onChanged={() => void q.refetch()} />}
    </Screen>
  );
}
