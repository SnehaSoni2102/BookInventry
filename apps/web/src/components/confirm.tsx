import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';

/** Destructive or irreversible actions always go through here (void, delete stall, write-off, ...). */
export function confirmAction(opts: { title: string; message: string; confirmLabel: string; color?: string; onConfirm: () => void | Promise<void> }) {
  modals.openConfirmModal({
    title: opts.title,
    centered: true,
    children: <Text size="sm">{opts.message}</Text>,
    labels: { confirm: opts.confirmLabel, cancel: 'Cancel' },
    confirmProps: { color: opts.color ?? 'red' },
    onConfirm: opts.onConfirm,
  });
}
