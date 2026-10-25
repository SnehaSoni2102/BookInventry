import { Spotlight, type SpotlightActionData } from '@mantine/spotlight';
import { useDebouncedValue } from '@mantine/hooks';
import { IconBook, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from './api';
import { useAuth } from './auth';
import { visibleNav } from './nav';

/** Ctrl/⌘+K: jump to any page, or find a book by title / author / ISBN / code. */
export function AppSpotlight() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query.trim(), 250);
  const searching = debounced.length >= 2 && can('inventory.read');
  const books = useQuery({ queryKey: ['spotlight', debounced], queryFn: () => api.titles.list({ q: debounced, pageSize: 6, status: 'all' }), enabled: searching });

  const actions = useMemo<SpotlightActionData[]>(() => {
    const pages: SpotlightActionData[] = visibleNav(can).map((n) => ({
      id: `page-${n.to}-${n.labelKey}`, label: t(n.labelKey), description: 'Go to page', leftSection: n.icon, onClick: () => navigate(n.to),
    }));
    const found: SpotlightActionData[] = (books.data?.items ?? []).map((b) => ({
      id: `book-${b.id}`, label: b.title, description: `${b.authors.join(', ')} · ${b.availableCount} cop${b.availableCount === 1 ? 'y' : 'ies'}`,
      leftSection: <IconBook size={20} />, onClick: () => navigate(`/inventory/titles/${b.id}`),
    }));
    return [...found, ...pages];
  }, [books.data, can, navigate, t]);

  return (
    <Spotlight
      actions={actions}
      shortcut={['mod + K']}
      query={query}
      onQueryChange={setQuery}
      filter={(q, list) => (list as SpotlightActionData[]).filter((a) => a.id?.startsWith('book-') || `${a.label ?? ''}`.toLowerCase().includes(q.toLowerCase()))}
      nothingFound="Nothing found"
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Go to a page, or search books…' }}
      scrollable
      maxHeight={420}
    />
  );
}
