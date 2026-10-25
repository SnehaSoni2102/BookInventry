import { Group, Pagination, Select, Skeleton, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { Key, ReactNode } from 'react';
import { EmptyState } from './states';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Server-side sort key; omit for non-sortable columns. */
  sort?: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => Key;
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  onPageSize?: (size: number) => void;
  sort?: { key: string; order: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  caption?: string;
}

/** Server-paginated, server-sorted table: the sort/page state lives in the URL, the server does the work. */
export function DataTable<T>({ columns, rows, rowKey, loading, total = 0, page = 1, pageSize = 25, onPage, onPageSize, sort, onSort, onRowClick, empty, caption }: Props<T>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div>
      <Table.ScrollContainer minWidth={560}>
        <Table highlightOnHover={Boolean(onRowClick)} stickyHeader verticalSpacing="xs" aria-busy={loading}>
          {caption && <Table.Caption>{caption}</Table.Caption>}
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c.key} w={c.width} ta={c.align} visibleFrom={c.hideBelow} aria-sort={sort && sort.key === c.sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sort && onSort ? (
                    <UnstyledButton onClick={() => onSort(c.sort!)} fw={600} fz="sm">
                      <Group gap={4} wrap="nowrap">
                        {c.header}
                        {sort && sort.key === c.sort ? sort.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} /> : <IconSelector size={14} opacity={0.4} />}
                      </Group>
                    </UnstyledButton>
                  ) : (
                    c.header
                  )}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && !rows?.length
              ? Array.from({ length: 5 }, (_, i) => (
                  <Table.Tr key={i}>{columns.map((c) => <Table.Td key={c.key} visibleFrom={c.hideBelow}><Skeleton h={18} /></Table.Td>)}</Table.Tr>
                ))
              : rows?.map((r) => (
                  <Table.Tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
                    {columns.map((c) => <Table.Td key={c.key} ta={c.align} visibleFrom={c.hideBelow}>{c.cell(r)}</Table.Td>)}
                  </Table.Tr>
                ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!loading && rows?.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
      {onPage && total > 0 && (
        <Group justify="space-between" mt="sm" wrap="wrap">
          <Text size="sm" c="dimmed">{total.toLocaleString('en-IN')} total</Text>
          <Group gap="sm">
            {onPageSize && <Select aria-label="Rows per page" w={86} size="xs" value={String(pageSize)} data={['25', '50', '100']} onChange={(v) => v && onPageSize(Number(v))} allowDeselect={false} />}
            <Pagination value={page} onChange={onPage} total={pages} size="sm" />
          </Group>
        </Group>
      )}
    </div>
  );
}
