import { errorMessage, qk } from '@bookstall/api-client';
import type { ImportJobDto } from '@bookstall/shared';
import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../app/api';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/states';
import { useFormat } from '../../lib/format';
import { saveBlob } from '../../lib/print';

export const IMPORT_COLOR: Record<string, string> = { UPLOADED: 'gray', VALIDATING: 'blue', READY: 'yellow', COMMITTING: 'blue', COMPLETED: 'green', FAILED: 'red' };

export default function ImportsPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: qk.imports.list(), queryFn: () => api.imports.list({ pageSize: 25 }), refetchInterval: (query) => (query.state.data?.items.some((j) => j.status === 'VALIDATING' || j.status === 'COMMITTING') ? 3000 : false) });

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { jobId } = await api.imports.upload(fd);
      navigate(`/imports/${jobId}`);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Upload failed', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ImportJobDto>[] = [
    { key: 'file', header: 'File', cell: (j) => <Text fw={600} size="sm">{j.originalName}</Text> },
    { key: 'status', header: 'Status', cell: (j) => <Badge color={IMPORT_COLOR[j.status]} variant="light">{j.status.toLowerCase()}</Badge> },
    { key: 'rows', header: 'Rows', align: 'right', cell: (j) => j.totalRows },
    { key: 'made', header: 'Copies created', align: 'right', hideBelow: 'sm', cell: (j) => j.copiesCreated },
    { key: 'at', header: 'Uploaded', hideBelow: 'sm', cell: (j) => fmt.dateTime(j.createdAt) },
  ];
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Bulk import</Title>
        <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={async () => saveBlob(await api.imports.template(), 'bookstall-import-template.xlsx')}>Download template</Button>
      </Group>
      <Dropzone onDrop={(files) => files[0] && void upload(files[0])} loading={busy} multiple={false} maxSize={10 * 1024 * 1024} accept={['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']} onReject={() => notifications.show({ color: 'red', message: 'Use an .xlsx file under 10 MB' })} data-testid="import-dropzone">
        <Group justify="center" mih={120} style={{ pointerEvents: 'none' }}>
          <IconUpload size={32} />
          <div><Text size="lg">Drop an Excel file here, or click to choose</Text><Text size="sm" c="dimmed">Up to 5,000 rows. You'll review everything before anything is saved.</Text></div>
        </Group>
      </Dropzone>
      <DataTable columns={columns} rows={q.data?.items} rowKey={(j) => j.id} loading={q.isLoading} onRowClick={(j) => navigate(`/imports/${j.id}`)} empty={<EmptyState title="No imports yet" />} />
    </Stack>
  );
}
