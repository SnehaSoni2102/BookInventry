import { Redirect, useLocalSearchParams } from 'expo-router';

/** Deep link target for https://<domain>/b/BK0000123 (a sticker scanned with the phone's own camera). */
export default function DeepLinkedCopy() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/copies/${String(code).toUpperCase()}`} />;
}
