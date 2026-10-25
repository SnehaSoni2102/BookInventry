import { ActionIcon, Alert, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconBulb, IconBulbOff } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  opened: boolean;
  onClose: () => void;
  onScan: (raw: string) => void;
  /** Keep scanning after a hit (scan station) instead of closing. */
  continuous?: boolean;
}

/**
 * Camera scanner for QR labels and book barcodes (EAN-13). Needs HTTPS or localhost.
 * The zxing code is loaded only when this modal opens, keeping it out of the main bundle.
 */
export default function CameraScanModal({ opened, onClose, onScan, continuous }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  const track = useRef<MediaStreamTrack | null>(null);
  const last = useRef({ value: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!opened) return;
    let stopped = false;
    let controls: { stop: () => void } | undefined;
    setError(null);
    setReady(false);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera here. Open the site over HTTPS.');
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.CODE_128]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          video.current!,
          (result) => {
            if (!result) return;
            const value = result.getText();
            const now = Date.now();
            if (value === last.current.value && now - last.current.at < 2000) return; // same label re-read
            last.current = { value, at: now };
            onScanRef.current(value);
          },
        );
        if (stopped) {
          controls.stop();
          return;
        }
        const stream = video.current?.srcObject as MediaStream | null;
        track.current = stream?.getVideoTracks()[0] ?? null;
        const caps = track.current?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorch(caps?.torch ? false : null);
        setReady(true);
      } catch (e) {
        const name = (e as Error)?.name;
        setError(
          name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings and try again.'
          : name === 'NotFoundError' ? 'No camera was found on this device.'
          : (e as Error)?.message ?? 'Could not start the camera.',
        );
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
      track.current = null;
    };
  }, [opened]);

  const toggleTorch = async () => {
    const next = !torch;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorch(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={continuous ? 'Scan books (keeps scanning)' : 'Scan a label or barcode'} size="lg" centered>
      <Stack>
        {error ? (
          <Alert color="red" title="Camera unavailable">{error}</Alert>
        ) : (
          <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3' }}>
            <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {!ready && <Loader style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}
            <div style={{ position: 'absolute', inset: '25% 15%', border: '2px solid rgba(255,255,255,.85)', borderRadius: 12, pointerEvents: 'none' }} />
            {torch !== null && (
              <ActionIcon variant="filled" color={torch ? 'yellow' : 'gray'} style={{ position: 'absolute', right: 10, bottom: 10 }} onClick={toggleTorch} aria-label="Torch">
                {torch ? <IconBulb /> : <IconBulbOff />}
              </ActionIcon>
            )}
          </div>
        )}
        <Text size="sm" c="dimmed">Point the camera at the QR sticker, or at the barcode on the back cover to look up a book.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>
      </Stack>
    </Modal>
  );
}
