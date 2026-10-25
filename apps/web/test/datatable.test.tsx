import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '../src/components/DataTable';

interface Row { id: number; name: string; price: number }
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sort: 'name', cell: (r) => r.name },
  { key: 'price', header: 'Price', sort: 'price', align: 'right', cell: (r) => `₹${r.price}` },
];
const rows: Row[] = [{ id: 1, name: 'Alpha', price: 10 }, { id: 2, name: 'Beta', price: 20 }];
const wrap = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>);

describe('DataTable', () => {
  it('renders rows and handles row clicks', async () => {
    const onRow = vi.fn();
    wrap(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRow} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Beta'));
    expect(onRow).toHaveBeenCalledWith(rows[1]);
  });

  it('asks the server to sort when a header is clicked, and marks the active sort for assistive tech', async () => {
    const onSort = vi.fn();
    wrap(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'price', order: 'desc' }} onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith('name');
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('shows the empty state when there are no rows and skeletons while loading', () => {
    const { rerender } = wrap(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<div>Nothing found</div>} />);
    expect(screen.getByText('Nothing found')).toBeInTheDocument();
    rerender(<MantineProvider><DataTable columns={columns} rows={undefined} rowKey={(r) => r.id} loading /></MantineProvider>);
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('paginates with the total count', async () => {
    const onPage = vi.fn();
    wrap(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} total={120} page={1} pageSize={25} onPage={onPage} />);
    expect(screen.getByText('120 total')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
