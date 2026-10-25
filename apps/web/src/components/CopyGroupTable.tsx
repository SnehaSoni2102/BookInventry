import type { CopyGroup } from '@bookstall/shared';
import { ActionIcon, Anchor, Button, Collapse, Group, Table, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useFormat } from '../lib/format';
import { ConditionBadge, StatusBadge } from './badges';
import { LocationCode } from './LocationCode';

interface Props {
  groups: CopyGroup[];
  canSell?: boolean | ((g: CopyGroup) => boolean);
  canCheckout?: boolean;
  canPrint?: boolean;
  canCheckin?: boolean;
  onSell?: (g: CopyGroup) => void;
  onCheckout?: (g: CopyGroup) => void;
  onLabels?: (g: CopyGroup) => void;
  onCheckin?: (g: CopyGroup) => void;
  /** Adds one more copy of the group to the sale cart; `inCart` says how many of its copies are already there. */
  onAddToCart?: (g: CopyGroup) => void;
  inCart?: (copyId: string) => boolean;
}

/** Copies of one title grouped by condition × price × where they are, with the individual copies one click away. */
export function CopyGroupTable({ groups, canSell, canCheckout, canPrint, canCheckin, onSell, onCheckout, onLabels, onCheckin, onAddToCart, inCart }: Props) {
  const fmt = useFormat();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <Table.ScrollContainer minWidth={640}>
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr><Table.Th w={36} /><Table.Th>Condition</Table.Th><Table.Th>Price</Table.Th><Table.Th>MRP</Table.Th><Table.Th>Status</Table.Th><Table.Th ta="right">Qty</Table.Th><Table.Th ta="right">Actions</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((g, i) => (
            <FragmentRow key={`${g.condition}-${g.sellingPriceMinor}-${g.status}-${g.stall?.id ?? ''}`}>
              <Table.Tr data-testid="copy-group">
                <Table.Td><ActionIcon variant="subtle" size="sm" onClick={() => toggle(i)} aria-label={open.has(i) ? 'Hide copies' : 'Show copies'} aria-expanded={open.has(i)}>{open.has(i) ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}</ActionIcon></Table.Td>
                <Table.Td><ConditionBadge condition={g.condition} /></Table.Td>
                <Table.Td fw={600}>{fmt.money(g.sellingPriceMinor)}</Table.Td>
                <Table.Td c="dimmed">{g.originalPriceMinor !== null ? fmt.money(g.originalPriceMinor) : '—'}</Table.Td>
                <Table.Td><StatusBadge status={g.status} stall={g.stall?.name} /></Table.Td>
                <Table.Td ta="right">{g.quantity}</Table.Td>
                <Table.Td>
                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    {(typeof canSell === 'function' ? canSell(g) : canSell) && onSell && <Button size="compact-sm" onClick={() => onSell(g)}>Sell</Button>}
                    {(typeof canSell === 'function' ? canSell(g) : canSell) && onAddToCart && (() => {
                      const left = g.copies.filter((c) => !inCart?.(c.id)).length;
                      return <Button size="compact-sm" variant="light" disabled={left === 0} onClick={() => onAddToCart(g)} data-testid="group-add-to-cart">{left === 0 ? 'All in cart' : 'Add to cart'}</Button>;
                    })()}
                    {canCheckout && g.status === 'IN_STOCK' && onCheckout && <Button size="compact-sm" variant="light" onClick={() => onCheckout(g)}>Check out</Button>}
                    {canCheckin && g.status === 'AT_STALL' && onCheckin && <Button size="compact-sm" variant="light" onClick={() => onCheckin(g)}>Check in</Button>}
                    {canPrint && onLabels && <Button size="compact-sm" variant="subtle" onClick={() => onLabels(g)}>Labels</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
              <Table.Tr style={{ display: open.has(i) ? undefined : 'none' }}>
                <Table.Td colSpan={7} p={0}>
                  <Collapse expanded={open.has(i)}>
                    <Table withRowBorders={false} bg="var(--mantine-color-gray-light)">
                      <Table.Tbody>
                        {g.copies.map((c) => (
                          <Table.Tr key={c.id}>
                            <Table.Td w={36} />
                            <Table.Td><Anchor component={Link} to={`/copies/${c.code}`} fw={600} size="sm">{c.code}</Anchor></Table.Td>
                            <Table.Td><LocationCode code={c.locationCode} /></Table.Td>
                            <Table.Td><Text size="xs" c="dimmed">added {fmt.date(c.createdAt)}</Text></Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Collapse>
                </Table.Td>
              </Table.Tr>
            </FragmentRow>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
