import { Alert, Modal, Stack, Text, TextInput } from '@mantine/core';
import { parseScan } from '@bookstall/shared';
import { useEffect, useState } from 'react';
import { SaleForm } from './SaleForm';
import { LocationCode } from './LocationCode';
import type { CartItem } from '../lib/cart';

export interface SellCandidate {
  copyId: string;
  code: string;
  locationCode: string | null;
  stallName: string | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  title: string;
  condition: string;
  sellingPriceMinor: number;
  /** One copy (copy page / scan), or every available copy of a group (the first is preselected). */
  candidates: SellCandidate[];
}

/**
 * Sells one copy. Because two copies of a title look identical on screen, the dialog names the sticker code
 * to pick off the shelf and lets the seller scan/type the code they actually hold, so the right copy leaves stock.
 */
export function SellDialog({ opened, onClose, title, condition, sellingPriceMinor, candidates }: Props) {
  const [selected, setSelected] = useState(candidates[0]?.code ?? '');
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setSelected(candidates[0]?.code ?? '');
      setTyped('');
      setProblem(null);
    }
  }, [opened, candidates]);

  const chosen = candidates.find((c) => c.code === selected);
  const applyTyped = () => {
    const parsed = parseScan(typed);
    const code = parsed.kind === 'copy' ? parsed.code : typed.trim().toUpperCase();
    if (!code) return;
    if (candidates.some((c) => c.code === code)) {
      setSelected(code);
      setProblem(null);
      setTyped('');
    } else setProblem(`${code} is not one of the available copies of this book`);
  };

  const items: CartItem[] = chosen ? [{ copyId: chosen.copyId, code: chosen.code, title, condition, sellingPriceMinor, locationCode: chosen.locationCode, stallName: chosen.stallName }] : [];
  return (
    <Modal opened={opened} onClose={onClose} title="Sell this book" centered size="md">
      <Stack>
        {chosen && (
          <Alert color="blue" variant="light" title="Confirm the sticker on the book">
            <Text>Code <b data-testid="sell-code">{chosen.code}</b> {chosen.stallName ? `· at ${chosen.stallName}` : <>· shelf <LocationCode code={chosen.locationCode} /></>}</Text>
            {candidates.length > 1 && (
              <TextInput mt="xs" size="xs" label="Holding a different copy? Scan or type its code" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyTyped())} onBlur={applyTyped} error={problem} />
            )}
          </Alert>
        )}
        <SaleForm items={items} onSold={() => undefined} onNewSale={onClose} />
      </Stack>
    </Modal>
  );
}
