import { api } from '../app/api';
import { useAuth } from '../app/auth';
import { errorMessage } from '@bookstall/api-client';
import { Alert, Button, Group, Modal, NumberInput, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { LabelTemplate } from '@bookstall/shared';
import { openPdf, printBlob } from '../lib/print';

const TEMPLATES: Array<{ value: LabelTemplate; label: string }> = [
  { value: 'THERMAL_50x25', label: 'Thermal label 50 × 25 mm (QR)' },
  { value: 'THERMAL_50x30_1D', label: 'Thermal label 50 × 30 mm (QR + barcode)' },
  { value: 'A4_24', label: 'A4 sticker sheet, 3 × 8 = 24 labels' },
];

interface Props {
  opened: boolean;
  onClose: () => void;
  copyIds: string[];
  /** Called after the user confirms the labels printed (the print queue was updated). */
  onPrinted?: () => void;
  /** A manager may reprint but not clear the queue. */
  canMarkPrinted?: boolean;
}

export function LabelPrintDialog({ opened, onClose, copyIds, onPrinted, canMarkPrinted = true }: Props) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [template, setTemplate] = useState<LabelTemplate>((me?.settings.defaultLabelTemplate as LabelTemplate) ?? 'THERMAL_50x25');
  const [start, setStart] = useState<number | string>(1);
  const [busy, setBusy] = useState(false);
  const [printed, setPrinted] = useState(false);

  const render = async () => api.labels.pdf(copyIds, { template, startPosition: template === 'A4_24' ? Number(start) || 1 : 1 });

  const run = async (action: 'print' | 'open') => {
    setBusy(true);
    try {
      if (action === 'open') await openPdf(render);
      else {
        await printBlob(await render());
        setPrinted(true);
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not make the labels', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const markPrinted = async () => {
    try {
      await api.labels.markPrinted(copyIds);
      await qc.invalidateQueries({ queryKey: ['labels'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      onPrinted?.();
      close();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not update the queue', message: errorMessage(e) });
    }
  };
  const close = () => {
    setPrinted(false);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title={`Print ${copyIds.length} label${copyIds.length === 1 ? '' : 's'}`} centered>
      <Stack>
        <Select label="Label type" data={TEMPLATES} value={template} onChange={(v) => v && setTemplate(v as LabelTemplate)} allowDeselect={false} />
        {template === 'A4_24' && <NumberInput label="Start at position" description="Reuse a partly used sheet: 1 is the top-left sticker, 24 the last" min={1} max={24} value={start} onChange={setStart} />}
        {printed && canMarkPrinted ? (
          <Alert color="blue" title="Did all the labels print correctly?">
            <Group mt="xs">
              <Button onClick={markPrinted}>Yes, mark as printed</Button>
              <Button variant="default" onClick={() => setPrinted(false)}>No, print again</Button>
            </Group>
          </Alert>
        ) : (
          <Group justify="space-between">
            <Button variant="default" loading={busy} onClick={() => run('open')}>Open PDF</Button>
            <Button loading={busy} onClick={() => run('print')}>Print</Button>
          </Group>
        )}
        <Text size="xs" c="dimmed">Tip: choose your label printer in the print dialog and set the paper size to match the label.</Text>
      </Stack>
    </Modal>
  );
}
