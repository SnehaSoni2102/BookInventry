import { ScanDeduper } from '@bookstall/api-client';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import Slider from '@react-native-community/slider';

interface Props {
  onScan: (raw: string) => void;
  /** Pauses reading (e.g. while a result sheet is open). */
  paused?: boolean;
  height?: number;
}

/**
 * Full-width camera with a viewfinder, torch, zoom and a manual-entry fallback for damaged labels.
 * The same value is ignored for 2 s, and reading pauses for 300 ms after each accepted scan.
 */
export function ScannerView({ onScan, paused, height = 320 }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState('');
  const dedupe = useRef(new ScanDeduper(2000));
  const cooling = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const accept = (value: string) => {
    if (cooling.current || !value || !dedupe.current.accept(value)) return;
    cooling.current = true;
    setTimeout(() => (cooling.current = false), 300);
    onScan(value);
  };

  if (!permission) return <View style={{ height }} />;
  if (!permission.granted) {
    return (
      <View style={[styles.denied, { height }]}>
        <Text variant="titleMedium">Camera access needed</Text>
        <Text style={{ textAlign: 'center' }}>Bookstall scans QR stickers and ISBN barcodes with the camera.</Text>
        {permission.canAskAgain ? <Button mode="contained" onPress={requestPermission}>Allow camera</Button> : <Button mode="contained" onPress={() => Linking.openSettings()}>Open settings</Button>}
        <Button onPress={() => setManual(true)}>Type a code instead</Button>
        <ManualDialog visible={manual} value={typed} onChange={setTyped} onClose={() => setManual(false)} onSubmit={(v) => { setManual(false); setTyped(''); accept(v); }} />
      </View>
    );
  }

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        zoom={zoom}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'code128'] }}
        onBarcodeScanned={paused ? undefined : ({ data }) => accept(data)}
        accessibilityLabel="Camera scanner"
      />
      <View pointerEvents="none" style={styles.finder} />
      <View style={styles.controls}>
        <IconButton icon={torch ? 'flashlight' : 'flashlight-off'} mode="contained" onPress={() => setTorch((t) => !t)} accessibilityLabel="Torch" />
        <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={0.6} value={zoom} onValueChange={setZoom} accessibilityLabel="Zoom" />
        <IconButton icon="keyboard" mode="contained" onPress={() => setManual(true)} accessibilityLabel="Type a code" />
      </View>
      <ManualDialog visible={manual} value={typed} onChange={setTyped} onClose={() => setManual(false)} onSubmit={(v) => { setManual(false); setTyped(''); accept(v); }} />
    </View>
  );
}

function ManualDialog({ visible, value, onChange, onClose, onSubmit }: { visible: boolean; value: string; onChange: (v: string) => void; onClose: () => void; onSubmit: (v: string) => void }) {
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onClose}>
        <Dialog.Title>Type a code</Dialog.Title>
        <Dialog.Content>
          <TextInput autoFocus autoCapitalize="characters" label="Book code or ISBN" value={value} onChangeText={onChange} onSubmitEditing={() => onSubmit(value.trim())} />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onClose}>Cancel</Button>
          <Button onPress={() => onSubmit(value.trim())} disabled={!value.trim()}>Look up</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  denied: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, backgroundColor: '#eee', borderRadius: 12 },
  finder: { position: 'absolute', left: '12%', right: '12%', top: '22%', bottom: '28%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 14 },
  controls: { position: 'absolute', left: 8, right: 8, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
