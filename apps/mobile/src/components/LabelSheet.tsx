import { errorMessage } from '@bookstall/api-client';
import type { LabelTemplate } from '@bookstall/shared';
import { useState } from 'react';
import { Button, Dialog, Portal, RadioButton, Text } from 'react-native-paper';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { printPdf, sharePdf } from '../lib/print';

const TEMPLATES: Array<{ value: LabelTemplate; label: string }> = [
  { value: 'THERMAL_50x25', label: 'Thermal 50 × 25 mm (QR)' },
  { value: 'THERMAL_50x30_1D', label: 'Thermal 50 × 30 mm (QR + barcode)' },
  { value: 'A4_24', label: 'A4 sheet, 24 labels' },
];

/** Print through the Android print service (Bluetooth label printers have a plug-in) or share the PDF. */
export function LabelSheet({ visible, onClose, copyIds, onPrinted }: { visible: boolean; onClose: () => void; copyIds: string[]; onPrinted?: () => void }) {
  const { me, can } = useAuth();
  const [template, setTemplate] = useState<LabelTemplate>((me?.settings.defaultLabelTemplate as LabelTemplate) ?? 'THERMAL_50x25');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'print' | 'share') => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.labels.pdf(copyIds, { template });
      if (kind === 'print') {
        await printPdf(blob, 'labels.pdf');
        if (can('inventory.read')) await api.labels.markPrinted(copyIds).catch(() => undefined);
        onPrinted?.();
      } else await sharePdf(blob, 'labels.pdf', 'Labels');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onClose}>
        <Dialog.Title>{copyIds.length} label{copyIds.length === 1 ? '' : 's'}</Dialog.Title>
        <Dialog.Content>
          <RadioButton.Group value={template} onValueChange={(v) => setTemplate(v as LabelTemplate)}>
            {TEMPLATES.map((t) => <RadioButton.Item key={t.value} label={t.label} value={t.value} />)}
          </RadioButton.Group>
          {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onClose}>Cancel</Button>
          <Button onPress={() => run('share')} disabled={busy}>Share PDF</Button>
          <Button mode="contained" onPress={() => run('print')} loading={busy}>Print</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
