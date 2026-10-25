import { useNetInfo } from '@react-native-community/netinfo';
import { Banner } from 'react-native-paper';

/** True unless the phone knows it has no internet. (Offline selling is out of scope: D13.) */
export function useOnline(): boolean {
  const n = useNetInfo();
  return n.isConnected !== false && n.isInternetReachable !== false;
}

export function OfflineBanner() {
  const online = useOnline();
  return (
    <Banner visible={!online} icon="wifi-off" style={{ backgroundColor: '#fff3cd' }}>
      No internet. Sales and other changes can’t be saved right now.
    </Banner>
  );
}
