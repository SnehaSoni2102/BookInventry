import { errorMessage, useCreateCopies, useGenres } from '@bookstall/api-client';
import type { BookCondition, CatalogLookupResult, CatalogSearchHit, CopyWarning, CreateCopiesBody, CreateCopiesResponse } from '@bookstall/shared';
import { BookCondition as Conditions, cleanIsbn, parseScan, toIsbn13 } from '@bookstall/shared';
import { Alert, Anchor, Badge, Button, Card, Chip, FileButton, Group, Image, Loader, NumberInput, Paper, Select, SegmentedControl, Stack, TagsInput, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../app/api';
import { useAuth } from '../../app/auth';
import { BookCover } from '../../components/BookCover';
import { LabelPrintDialog } from '../../components/LabelPrintDialog';
import { LocationCode } from '../../components/LocationCode';
import { feedback } from '../../lib/audio';
import { useFormat } from '../../lib/format';
import { useScanHandler } from '../../lib/scanner';

interface FormValues {
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishedYear: number | string;
  language: string;
  pageCount: number | string;
  isbn: string;
  genreId: string | null;
  summary: string;
  condition: BookCondition;
  conditionNotes: string;
  originalPrice: number | string;
  sellingPrice: number | string;
  quantity: number | string;
  donor: string;
  notes: string;
}

const EMPTY: FormValues = {
  title: '', subtitle: '', authors: [], publisher: '', publishedYear: '', language: '', pageCount: '', isbn: '', genreId: null, summary: '',
  condition: 'GOOD', conditionNotes: '', originalPrice: '', sellingPrice: '', quantity: 1, donor: '', notes: '',
};

const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['mr', 'Marathi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'], ['sa', 'Sanskrit'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish']].map(([value, label]) => ({ value: value!, label: label! }));
const toMinor = (v: number | string) => (v === '' || v === undefined ? undefined : Math.round(Number(v) * 100));
const num = (v: number | string) => (v === '' ? undefined : Number(v));

type Phase = 'find' | 'form' | 'done';

export default function AddBookPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const genres = useGenres();
  const create = useCreateCopies();

  const [phase, setPhase] = useState<Phase>('find');
  const [query, setQuery] = useState(sp.get('isbn') ?? '');
  const [looking, setLooking] = useState(false);
  const [lookup, setLookup] = useState<CatalogLookupResult | null>(null);
  const [hits, setHits] = useState<CatalogSearchHit[] | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [existing, setExisting] = useState<{ titleId: string } | null>(null);
  const [result, setResult] = useState<CreateCopiesResponse | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const clientRef = useRef(crypto.randomUUID());
  const form = useForm<FormValues>({ defaultValues: EMPTY, mode: 'onBlur' });
  const { control, register, watch, setValue, reset, handleSubmit, formState: { errors, isDirty } } = form;
  const findRef = useRef<HTMLInputElement>(null);

  const condition = watch('condition');
  const original = watch('originalPrice');
  const selling = watch('sellingPrice');
  const summaryText = watch('summary');

  // ── price suggestion (advisory only: the user confirms or overrides it) ──
  const [dOriginal] = useDebouncedValue(original, 400);
  const suggestion = useQuery({
    queryKey: ['catalog', 'price', dOriginal, condition],
    queryFn: () => api.catalog.priceSuggestion(Math.round(Number(dOriginal) * 100), condition),
    enabled: dOriginal !== '' && Number(dOriginal) > 0,
  });

  // ── step 1: find ──
  const applyMetadata = (r: CatalogLookupResult) => {
    const m = r.metadata;
    if (!m) return;
    reset({
      ...EMPTY,
      title: m.title, subtitle: m.subtitle ?? '', authors: m.authors, publisher: m.publisher ?? '', publishedYear: m.publishedYear ?? '',
      language: m.language ?? '', pageCount: m.pageCount ?? '', isbn: m.isbn13 ?? m.isbn10 ?? '', genreId: r.suggestedGenreId ?? null, summary: m.summary ?? '',
    });
    setCoverUrl(m.coverUrl);
  };

  const runLookup = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setLooking(true);
    setHits(null);
    setLookupNote(null);
    setCoverFile(null);
    try {
      const parsed = parseScan(text);
      if (parsed.kind === 'copy') return void navigate(`/copies/${parsed.code}`);
      const isbn = parsed.kind === 'isbn' ? parsed.isbn13 : toIsbn13(cleanIsbn(text));
      if (isbn) {
        const r = await api.catalog.lookup(isbn);
        setLookup(r);
        setQuery(isbn);
        if (r.inInventory) {
          setExisting({ titleId: r.titleId! });
          applyMetadata(r);
          setPhase('form');
        } else if (r.found) {
          setExisting(null);
          applyMetadata(r);
          setLookupNote(r.warnings?.length ? 'One online source did not answer, so some details may be missing.' : null);
          setPhase('form');
        } else {
          setExisting(null);
          reset({ ...EMPTY, isbn });
          setCoverUrl(null);
          setLookupNote(r.warnings?.length ? 'The online lookup is unavailable right now. Please fill in the details.' : 'Not found online. Please fill in the details.');
          setPhase('form');
        }
        feedback.success();
      } else {
        const r = await api.catalog.search(text);
        setHits(r.hits);
        if (!r.hits.length) setLookupNote(r.warnings.length ? 'The online search is unavailable. You can enter the book by hand.' : 'No matches. You can enter the book by hand.');
      }
    } catch (e) {
      feedback.error();
      notifications.show({ color: 'red', title: 'Lookup failed', message: errorMessage(e) });
    } finally {
      setLooking(false);
    }
  };

  // initial ?isbn= (from a scan elsewhere) and scans while on this page
  const initial = useRef(sp.get('isbn'));
  useEffect(() => {
    if (initial.current) {
      void runLookup(initial.current);
      initial.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useScanHandler((raw) => {
    if (phase === 'done') return;
    setQuery(raw);
    void runLookup(raw);
  });

  const pickHit = (h: CatalogSearchHit) => {
    if (h.isbn13) return void runLookup(h.isbn13);
    setLookup(null);
    setExisting(h.titleId ? { titleId: h.titleId } : null);
    reset({ ...EMPTY, title: h.title, authors: h.authors, publishedYear: h.firstPublishYear ?? '' });
    setCoverUrl(h.coverUrl);
    setPhase('form');
  };
  const manual = () => {
    setLookup(null);
    setExisting(null);
    reset({ ...EMPTY, title: hits ? query : '' });
    setCoverUrl(null);
    setPhase('form');
  };

  // ── submit ──
  const submit = handleSubmit(async (v) => {
    if (!v.genreId && !existing) return void notifications.show({ color: 'red', message: 'Choose a genre' });
    const copy = {
      condition: v.condition,
      ...(v.conditionNotes ? { conditionNotes: v.conditionNotes } : {}),
      ...(toMinor(v.originalPrice) !== undefined ? { originalPriceMinor: toMinor(v.originalPrice) } : {}),
      sellingPriceMinor: toMinor(v.sellingPrice) ?? 0,
      ...(v.donor ? { donorName: v.donor } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
    };
    const source = lookup?.source === 'OPEN_LIBRARY' ? 'OPEN_LIBRARY' : lookup?.source === 'GOOGLE_BOOKS' ? 'GOOGLE_BOOKS' : 'MANUAL';
    const body = {
      clientRef: clientRef.current,
      quantity: Number(v.quantity) || 1,
      copy,
      ...(existing
        ? { titleId: existing.titleId }
        : {
            title: {
              title: v.title.trim(), authors: v.authors, genreId: v.genreId!, source,
              subjects: lookup?.metadata?.subjects ?? [], externalIds: lookup?.metadata?.externalIds ?? {},
              ...(v.subtitle ? { subtitle: v.subtitle } : {}),
              ...(v.publisher ? { publisher: v.publisher } : {}),
              ...(num(v.publishedYear) ? { publishedYear: num(v.publishedYear) } : {}),
              ...(v.language ? { language: v.language } : {}),
              ...(num(v.pageCount) ? { pageCount: num(v.pageCount) } : {}),
              ...(v.summary ? { summary: v.summary } : {}),
              ...(v.isbn ? { isbn13: v.isbn } : {}),
              ...(coverUrl && !coverFile ? { coverUrl } : {}),
            },
          }),
    } as unknown as CreateCopiesBody;
    try {
      const res = await create.mutateAsync(body);
      if (coverFile) {
        const fd = new FormData();
        fd.append('file', coverFile);
        await api.titles.uploadCover(res.title.id, fd).catch(() => notifications.show({ color: 'yellow', message: 'The books were added, but the cover photo could not be uploaded.' }));
      }
      feedback.success();
      setResult(res);
      setPhase('done');
    } catch (e) {
      feedback.error();
      notifications.show({ color: 'red', title: 'Could not add the book', message: errorMessage(e) });
    }
  });
  useHotkeys([['mod+Enter', () => phase === 'form' && void submit()]], ['INPUT', 'TEXTAREA']);
  // inputs: handled by the form itself
  const onCtrlEnter = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
  };

  // leaving with unsaved edits asks first
  const blocker = useBlocker(({ currentLocation, nextLocation }) => phase === 'form' && isDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked' && window.confirm('You have unsaved changes. Leave this page?')) blocker.proceed();
    else if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);

  const restart = (keepTitle: boolean) => {
    clientRef.current = crypto.randomUUID();
    setResult(null);
    setCoverFile(null);
    if (keepTitle && result) {
      setExisting({ titleId: result.title.id });
      setLookup(null);
      reset({ ...form.getValues(), conditionNotes: '', notes: '', condition: 'GOOD', quantity: 1, originalPrice: '', sellingPrice: '' });
      setPhase('form');
    } else {
      setExisting(null);
      setLookup(null);
      setHits(null);
      setQuery('');
      reset(EMPTY);
      setCoverUrl(null);
      setPhase('find');
      setSp({}, { replace: true });
      setTimeout(() => findRef.current?.focus(), 50);
    }
  };

  const genreOptions = useMemo(() => (genres.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` })), [genres.data]);
  const suggestedGenre = lookup?.suggestedGenreId ? genres.data?.find((g) => g.id === lookup.suggestedGenreId) : undefined;
  const readOnly = Boolean(existing);

  // ───────── render ─────────
  if (phase === 'done' && result) {
    const placed = result.copies.filter((c) => c.locationCode);
    return (
      <Stack maw={720} data-testid="add-success">
        <Title order={2}>Added {result.copies.length} cop{result.copies.length === 1 ? 'y' : 'ies'} of “{result.title.title}”</Title>
        {result.warnings.includes('NO_SHELF_SPACE' as CopyWarning) && (
          <Alert color="red" title="No shelf space">Not every copy could be shelved for this genre. Those are listed as unshelved. <Anchor component={Link} to="/shelves">Add shelf rows</Anchor> and place them.</Alert>
        )}
        {result.warnings.includes('TITLE_EXISTS_METADATA_IGNORED' as CopyWarning) && <Alert color="blue">This ISBN was already in the catalogue, so the copies were added to the existing title.</Alert>}
        <Card withBorder>
          <Text fw={600} mb="xs">Put on the shelf at</Text>
          <Stack gap={6}>
            {result.copies.map((c) => (
              <Group key={c.id} gap="md">
                <Text fw={700}>{c.code}</Text>
                <LocationCode code={c.locationCode} size="lg" />
                <Text c="dimmed">{t(`condition.${c.condition}`)} · {fmt.money(c.sellingPriceMinor)}</Text>
              </Group>
            ))}
          </Stack>
          {placed.length === 0 && <Text c="red" size="sm" mt="xs">None of the copies has a shelf slot yet.</Text>}
        </Card>
        <Group>
          <Button onClick={() => setPrintOpen(true)} data-testid="print-now">Print labels now</Button>
          <Button variant="light" onClick={() => notifications.show({ message: 'In the print queue. Print it any time from Labels.' })}>Add to print queue</Button>
        </Group>
        <Group>
          <Button variant="default" onClick={() => restart(true)} data-testid="add-another-copy">Add another copy of this book</Button>
          <Button variant="default" onClick={() => restart(false)}>Add a different book</Button>
        </Group>
        <LabelPrintDialog opened={printOpen} onClose={() => setPrintOpen(false)} copyIds={result.copies.map((c) => c.id)} canMarkPrinted={can('inventory.read')} />
      </Stack>
    );
  }

  return (
    <Stack maw={860} onKeyDown={onCtrlEnter}>
      <Title order={2}>Add books</Title>

      <Paper withBorder p="md">
        <form onSubmit={(e) => { e.preventDefault(); void runLookup(query); }}>
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              ref={findRef} flex={1} label="1. Find the book" description="Scan the barcode on the back cover, type an ISBN, or search by title / author"
              placeholder="978… or title" leftSection={looking ? <Loader size={14} /> : <IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)}
              data-testid="find-input" autoFocus
            />
            <Button type="submit" loading={looking}>Look up</Button>
          </Group>
        </form>
        {hits && (
          <Stack mt="sm" gap="xs">
            {hits.map((h, i) => (
              <Card key={i} withBorder padding="xs" onClick={() => pickHit(h)} style={{ cursor: 'pointer' }} data-testid="search-hit">
                <Group wrap="nowrap">
                  {h.coverUrl ? <Image src={h.coverUrl} w={36} h={52} fit="cover" radius="xs" /> : <BookCover title={h.title} width={36} />}
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} size="sm" lineClamp={1}>{h.title}</Text>
                    <Text size="xs" c="dimmed">{h.authors.join(', ')} {h.firstPublishYear ? `· ${h.firstPublishYear}` : ''} {h.source === 'LOCAL' && <Badge size="xs" ml={4}>In inventory</Badge>}</Text>
                  </div>
                </Group>
              </Card>
            ))}
            <Anchor component="button" type="button" onClick={manual} size="sm" ta="left">None of these: enter the book by hand</Anchor>
          </Stack>
        )}
        {!hits && phase === 'find' && <Anchor component="button" type="button" mt="xs" size="sm" onClick={manual}>No ISBN? Enter the book by hand</Anchor>}
        {lookupNote && phase !== 'done' && <Alert mt="sm" color={lookup?.warnings?.length ? 'yellow' : 'blue'}>{lookupNote}</Alert>}
      </Paper>

      {phase === 'form' && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <Stack>
            {existing && lookup?.inInventory && (
              <Alert color="blue" title={`Already in inventory: ${lookup.copyGroups?.reduce((a, g) => a + g.quantity, 0) ?? 0} cop${(lookup.copyGroups?.reduce((a, g) => a + g.quantity, 0) ?? 0) === 1 ? 'y' : 'ies'}`} data-testid="in-inventory">
                {lookup.copyGroups?.map((g) => `${g.quantity} × ${t(`condition.${g.condition}`)} ${fmt.money(g.sellingPriceMinor)}`).join(', ')}.{' '}
                The book details are locked; <Anchor component={Link} to={`/inventory/titles/${existing.titleId}`}>edit the title</Anchor> to change them.
              </Alert>
            )}

            <Paper withBorder p="md">
              <Title order={4} mb="sm">2. Book details</Title>
              <Group align="flex-start" wrap="nowrap">
                <Stack gap={6} align="center" w={120}>
                  {coverFile ? <Image src={URL.createObjectURL(coverFile)} w={100} fit="cover" radius="sm" /> : <BookCover url={coverUrl} title={watch('title') || 'New'} width={100} />}
                  {!readOnly && (
                    <>
                      <FileButton onChange={(f) => f && setCoverFile(f)} accept="image/png,image/jpeg,image/webp">{(props) => <Button size="compact-xs" variant="light" {...props}>Upload photo</Button>}</FileButton>
                      {(coverUrl || coverFile) && <Button size="compact-xs" variant="subtle" color="red" onClick={() => { setCoverUrl(null); setCoverFile(null); }}>Remove</Button>}
                    </>
                  )}
                </Stack>
                <Stack flex={1} gap="xs" style={{ minWidth: 0 }}>
                  <TextInput label="Title" required disabled={readOnly} {...register('title', { required: 'Title is required' })} error={errors.title?.message} data-testid="field-title" />
                  <TextInput label="Subtitle" disabled={readOnly} {...register('subtitle')} />
                  <Controller control={control} name="authors" render={({ field }) => <TagsInput label="Authors" description="Press Enter after each author" disabled={readOnly} value={field.value} onChange={field.onChange} data-testid="field-authors" />} />
                  <Group grow>
                    <TextInput label="Publisher" disabled={readOnly} {...register('publisher')} />
                    <Controller control={control} name="publishedYear" render={({ field }) => <NumberInput label="Year" min={1400} max={2100} allowDecimal={false} disabled={readOnly} value={field.value} onChange={field.onChange} />} />
                  </Group>
                  <Group grow>
                    <Controller control={control} name="language" render={({ field }) => <Select label="Language" data={LANGS} clearable searchable disabled={readOnly} value={field.value || null} onChange={(v) => field.onChange(v ?? '')} />} />
                    <Controller control={control} name="pageCount" render={({ field }) => <NumberInput label="Pages" min={1} allowDecimal={false} disabled={readOnly} value={field.value} onChange={field.onChange} />} />
                    <TextInput label="ISBN" disabled={readOnly} {...register('isbn', { validate: (v) => !v || !!toIsbn13(cleanIsbn(v)) || 'Not a valid ISBN' })} error={errors.isbn?.message} />
                  </Group>
                  <Controller
                    control={control} name="genreId" rules={{ required: !existing }}
                    render={({ field, fieldState }) => (
                      <Select
                        label="Genre (decides the shelf)" required={!existing} searchable data={genreOptions} disabled={readOnly} value={field.value} onChange={field.onChange}
                        description={suggestedGenre && field.value === suggestedGenre.id ? `Suggested from the book's subjects: ${(lookup?.metadata?.subjects ?? []).slice(0, 3).join(', ')}` : undefined}
                        error={fieldState.error ? 'Choose a genre' : undefined} data-testid="field-genre"
                      />
                    )}
                  />
                  <Textarea label="Summary" autosize minRows={2} maxRows={6} maxLength={4000} disabled={readOnly} {...register('summary')} description={`${summaryText.length} / 4000`} />
                </Stack>
              </Group>
            </Paper>

            <Paper withBorder p="md">
              <Title order={4} mb="sm">3. This copy</Title>
              <Stack gap="xs">
                <Controller
                  control={control} name="condition"
                  render={({ field }) => (
                    <div>
                      <Text size="sm" fw={500} mb={4}>Condition</Text>
                      <SegmentedControl
                        fullWidth value={field.value} onChange={(v) => field.onChange(v)} data-testid="field-condition"
                        data={Conditions.values.map((c) => ({ value: c, label: <Tooltip label={t(`conditionHelp.${c}`)} withArrow><span>{t(`condition.${c}`)}</span></Tooltip> }))}
                      />
                    </div>
                  )}
                />
                <TextInput label="Condition notes" placeholder="e.g. cover creased, name inside" {...register('conditionNotes')} />
                <Group grow align="flex-start">
                  <Controller control={control} name="originalPrice" render={({ field }) => <NumberInput label="Original price (MRP)" prefix="₹" min={0} decimalScale={2} value={field.value} onChange={field.onChange} />} />
                  <Controller
                    control={control} name="sellingPrice" rules={{ validate: (v) => v !== '' || 'Enter the selling price' }}
                    render={({ field, fieldState }) => (
                      <NumberInput
                        label="Selling price" required prefix="₹" min={0} decimalScale={2} value={field.value} onChange={field.onChange} error={fieldState.error?.message} data-testid="field-price"
                        description={suggestion.data && suggestion.data.suggestedMinor > 0 ? (
                          <Chip checked={false} size="xs" variant="outline" onClick={() => field.onChange(suggestion.data!.suggestedMinor / 100)}>Suggested {fmt.money(suggestion.data.suggestedMinor)}</Chip>
                        ) : 'You decide the price'}
                      />
                    )}
                  />
                  <Controller control={control} name="quantity" render={({ field }) => <NumberInput label="Quantity" description="Identical copies" min={1} max={200} allowDecimal={false} value={field.value} onChange={field.onChange} data-testid="field-qty" />} />
                </Group>
                <Group grow>
                  <TextInput label="Donor" {...register('donor')} />
                  <TextInput label="Internal notes" {...register('notes')} />
                </Group>
              </Stack>
            </Paper>

            <Group justify="space-between">
              <Text size="xs" c="dimmed">Ctrl+Enter to save</Text>
              <Button type="submit" size="md" loading={create.isPending} data-testid="submit-book">
                Add {Number(watch('quantity')) || 1} cop{Number(watch('quantity')) === 1 || !watch('quantity') ? 'y' : 'ies'}
                {selling !== '' && Number(selling) > 0 ? ` at ${fmt.money(toMinor(selling))}` : ''}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
