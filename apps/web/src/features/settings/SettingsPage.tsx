import { errorMessage, qk, useUpdateSettings } from '@bookstall/api-client';
import { PUBLIC_FIELDS, BookCondition as Conditions, type UpdateSettingsBody } from '@bookstall/shared';
import { Alert, Button, Card, Chip, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api';
import { ErrorState, PageSkeleton } from '../../components/states';

type S = Record<string, unknown>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: qk.settings(), queryFn: api.settings.get });
  const update = useUpdateSettings();
  const [v, setV] = useState<S>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (q.data?.settings) setV(q.data.settings); }, [q.data]);
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} />;
  const orig = q.data!.settings ?? {};
  const set = (k: string, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const dirty = Object.keys(v).filter((k) => JSON.stringify(v[k]) !== JSON.stringify(orig[k]));

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync(Object.fromEntries(dirty.map((k) => [k, v[k]])) as UpdateSettingsBody);
      notifications.show({ color: 'green', message: 'Settings saved' });
    } catch (e) { setError(errorMessage(e)); }
  };
  const pct = (v['pricing.conditionPercent'] ?? {}) as Record<string, number>;

  return (
    <Stack maw={860}>
      <Group justify="space-between"><Title order={2}>Settings</Title><Button onClick={save} disabled={!dirty.length} loading={update.isPending} data-testid="save-settings">Save {dirty.length ? `(${dirty.length})` : ''}</Button></Group>
      {error && <Alert color="red" role="alert">{error}</Alert>}

      <Card withBorder><Title order={4} mb="sm">Organisation</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Name" value={String(v['org.name'] ?? '')} onChange={(e) => set('org.name', e.currentTarget.value)} data-testid="setting-org-name" />
          <TextInput label="Currency" description="3-letter code" value={String(v['org.currency'] ?? '')} onChange={(e) => set('org.currency', e.currentTarget.value.toUpperCase())} />
          <TextInput label="Locale" description="e.g. en-IN" value={String(v['org.locale'] ?? '')} onChange={(e) => set('org.locale', e.currentTarget.value)} />
          <TextInput label="Time zone" description="e.g. Asia/Kolkata" value={String(v['org.timezone'] ?? '')} onChange={(e) => set('org.timezone', e.currentTarget.value)} />
        </SimpleGrid>
      </Card>

      <Card withBorder><Title order={4} mb="xs">Pricing suggestions</Title>
        <Text size="sm" c="dimmed" mb="sm">The “suggested price” chip when adding a book is the MRP × the condition percentage, rounded. The person adding the book always decides the final price.</Text>
        <SimpleGrid cols={{ base: 2, sm: 3 }}>
          {Conditions.values.map((c) => <NumberInput key={c} label={t(`condition.${c}`)} suffix="%" min={0} max={100} allowDecimal={false} value={pct[c] ?? 0} onChange={(n) => set('pricing.conditionPercent', { ...pct, [c]: Number(n) })} />)}
          <NumberInput label="Round to (₹)" min={0.01} step={1} decimalScale={2} value={Number(v['pricing.roundToMinor'] ?? 1000) / 100} onChange={(n) => set('pricing.roundToMinor', Math.max(1, Math.round(Number(n) * 100)))} />
        </SimpleGrid>
      </Card>

      <Card withBorder><Title order={4} mb="sm">Sales and stalls</Title>
        <Stack>
          <Switch label="Stall managers see all sales of their stall" description="Off: they only see the sales they made themselves" checked={Boolean(v['sales.managerSeesWholeStall'])} onChange={(e) => set('sales.managerSeesWholeStall', e.currentTarget.checked)} />
          <Switch label="Deactivate managers when their stall closes" description="They can be reactivated for the next fair" checked={Boolean(v['stall.deactivateManagersOnClose'])} onChange={(e) => set('stall.deactivateManagersOnClose', e.currentTarget.checked)} />
        </Stack>
      </Card>

      <Card withBorder><Title order={4} mb="sm">Labels and books</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Default label type" allowDeselect={false} data={[{ value: 'THERMAL_50x25', label: 'Thermal 50 × 25 mm' }, { value: 'THERMAL_50x30_1D', label: 'Thermal 50 × 30 mm + barcode' }, { value: 'A4_24', label: 'A4 sheet (24)' }]} value={String(v['label.defaultTemplate'] ?? '')} onChange={(x) => set('label.defaultTemplate', x)} />
          <TextInput label="Book code prefix" description="Applies to books added from now on" maxLength={4} value={String(v['copy.codePrefix'] ?? '')} onChange={(e) => set('copy.codePrefix', e.currentTarget.value.toUpperCase())} />
          <NumberInput label="Warn when a genre's rows are this full" suffix="%" min={1} max={100} value={Number(v['shelf.lowSpaceThresholdPercent'] ?? 90)} onChange={(n) => set('shelf.lowSpaceThresholdPercent', Number(n))} />
        </SimpleGrid>
      </Card>

      <Card withBorder><Title order={4} mb="sm">Public QR page</Title>
        <Stack>
          <Switch label="Customers can scan a sticker to see the book" checked={Boolean(v['public.enabled'])} onChange={(e) => set('public.enabled', e.currentTarget.checked)} />
          <Text size="sm" c="dimmed">Shown on the public page. The shelf position, stall, donor and notes are never shown.</Text>
          <Chip.Group multiple value={(v['public.fields'] as string[]) ?? []} onChange={(x) => set('public.fields', x)}>
            <Group gap="xs">{PUBLIC_FIELDS.map((f) => <Chip key={f} value={f} size="sm">{f.replace(/([A-Z])/g, ' $1').toLowerCase()}</Chip>)}</Group>
          </Chip.Group>
        </Stack>
      </Card>

      <Card withBorder><Title order={4} mb="sm">Sessions</Title>
        <NumberInput label="Lock the screen after (minutes without activity)" description="0 turns it off" min={0} max={1440} w={280} value={Number(v['session.autoLockMinutes'] ?? 30)} onChange={(n) => set('session.autoLockMinutes', Number(n))} />
      </Card>
    </Stack>
  );
}
