import { errorMessage, useCreateCopies, useGenres } from '@bookstall/api-client';
import { BookCondition, cleanIsbn, parseScan, toIsbn13, type CatalogLookupResult, type CatalogSearchHit, type CreateCopiesBody, type CreateCopiesResponse } from '@bookstall/shared';
import { useQuery } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { Button, Card, Chip, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { GenrePicker } from '../../src/components/GenrePicker';
import { LabelSheet } from '../../src/components/LabelSheet';
import { ScannerView } from '../../src/components/ScannerView';
import { Screen, styles } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { feedback } from '../../src/lib/feedback';
import { CONDITION_LABEL, useFormat } from '../../src/lib/format';
import { useOnline } from '../../src/lib/network';

const rupeesToMinor = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v) * 100));
const EMPTY = { title: '', authors: '', publisher: '', year: '', pages: '', isbn: '', genreId: null as string | null, summary: '', condition: 'GOOD' as (typeof BookCondition.values)[number], notes: '', mrp: '', price: '', qty: '1', donor: '' };

/** Add a book: scan its ISBN barcode (or search), check the prefilled details, set condition/price, save. */
export default function AddBook() {
  const params = useLocalSearchParams<{ isbn?: string }>();
  const fmt = useFormat();
  const online = useOnline();
  const create = useCreateCopies();
  const genres = useGenres();
  const clientRef = useRef(crypto.randomUUID());
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState(params.isbn ?? '');
  const [looking, setLooking] = useState(false);
  const [hits, setHits] = useState<CatalogSearchHit[] | null>(null);
  const [lookup, setLookup] = useState<CatalogLookupResult | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [step, setStep] = useState<'find' | 'form'>('find');
  const [result, setResult] = useState<CreateCopiesResponse | null>(null);
  const [labels, setLabels] = useState(false);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const suggestion = useQuery({
    queryKey: ['price', form.mrp, form.condition],
    queryFn: () => api.catalog.priceSuggestion(Math.round(Number(form.mrp) * 100), form.condition),
    enabled: Number(form.mrp) > 0,
  });

  const fill = (r: CatalogLookupResult) => {
    const m = r.metadata;
    if (!m) return;
    setForm({ ...EMPTY, title: m.title, authors: m.authors.join(', '), publisher: m.publisher ?? '', year: m.publishedYear ? String(m.publishedYear) : '', pages: m.pageCount ? String(m.pageCount) : '', isbn: m.isbn13 ?? '', genreId: r.suggestedGenreId ?? null, summary: m.summary ?? '' });
    setCoverUrl(m.coverUrl);
  };

  const run = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setLooking(true);
    setHits(null);
    setNote(null);
    try {
      const parsed = parseScan(text);
      if (parsed.kind === 'copy') return void router.push(`/copies/${parsed.code}`);
      const isbn = parsed.kind === 'isbn' ? parsed.isbn13 : toIsbn13(cleanIsbn(text));
      if (isbn) {
        const r = await api.catalog.lookup(isbn);
        setLookup(r);
        setQuery(isbn);
        if (r.inInventory) { setExisting(r.titleId ?? null); fill(r); }
        else if (r.found) { setExisting(null); fill(r); if (r.warnings?.length) setNote('One online source did not answer, so details may be incomplete.'); }
        else { setExisting(null); setForm({ ...EMPTY, isbn }); setCoverUrl(null); setNote(r.warnings?.length ? 'Online lookup is unavailable. Please fill in the details.' : 'Not found online. Please fill in the details.'); }
        feedback.success();
        setStep('form');
      } else {
        const r = await api.catalog.search(text);
        setHits(r.hits);
        if (!r.hits.length) setNote('No matches. You can enter the book by hand.');
      }
    } catch (e) {
      feedback.error();
      Alert.alert('Lookup failed', errorMessage(e));
    } finally {
      setLooking(false);
    }
  };

  useEffect(() => {
    if (params.isbn) void run(params.isbn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.isbn]);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera permission is needed to take a cover photo');
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (shot.canceled || !shot.assets[0]) return;
    // shrink before uploading: covers are shown at 400 px anyway
    const small = await ImageManipulator.manipulateAsync(shot.assets[0].uri, [{ resize: { width: 900 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    setPhoto(small.uri);
  };

  const save = async () => {
    if (!existing && (!form.title.trim() || !form.genreId)) return Alert.alert('Title and genre are required');
    if (form.price.trim() === '') return Alert.alert('Enter the selling price');
    const body = {
      clientRef: clientRef.current,
      quantity: Number(form.qty) || 1,
      copy: {
        condition: form.condition,
        ...(form.notes ? { notes: form.notes } : {}),
        ...(rupeesToMinor(form.mrp) !== undefined ? { originalPriceMinor: rupeesToMinor(form.mrp) } : {}),
        sellingPriceMinor: rupeesToMinor(form.price) ?? 0,
        ...(form.donor ? { donorName: form.donor } : {}),
      },
      ...(existing
        ? { titleId: existing }
        : {
            title: {
              title: form.title.trim(), genreId: form.genreId!, authors: form.authors.split(',').map((a) => a.trim()).filter(Boolean),
              source: lookup?.source === 'OPEN_LIBRARY' ? 'OPEN_LIBRARY' : lookup?.source === 'GOOGLE_BOOKS' ? 'GOOGLE_BOOKS' : 'MANUAL',
              subjects: lookup?.metadata?.subjects ?? [], externalIds: lookup?.metadata?.externalIds ?? {},
              ...(form.publisher ? { publisher: form.publisher } : {}), ...(Number(form.year) ? { publishedYear: Number(form.year) } : {}),
              ...(Number(form.pages) ? { pageCount: Number(form.pages) } : {}), ...(form.isbn ? { isbn13: form.isbn } : {}),
              ...(form.summary ? { summary: form.summary } : {}), ...(coverUrl && !photo ? { coverUrl } : {}),
            },
          }),
    } as unknown as CreateCopiesBody;
    try {
      const res = await create.mutateAsync(body);
      if (photo) {
        const fd = new FormData();
        fd.append('file', { uri: photo, name: 'cover.jpg', type: 'image/jpeg' } as unknown as Blob);
        await api.titles.uploadCover(res.title.id, fd).catch(() => Alert.alert('Saved, but the cover photo could not be uploaded'));
      }
      feedback.success();
      setResult(res);
    } catch (e) {
      feedback.error();
      Alert.alert('Could not add the book', errorMessage(e));
    }
  };

  const restart = (keep: boolean) => {
    clientRef.current = crypto.randomUUID();
    if (keep && result) { setExisting(result.title.id); setForm((f) => ({ ...f, price: '', mrp: '', notes: '', qty: '1' })); setResult(null); setStep('form'); }
    else { setResult(null); setExisting(null); setLookup(null); setForm(EMPTY); setCoverUrl(null); setPhoto(null); setQuery(''); setHits(null); setStep('find'); }
  };

  if (result) {
    return (
      <Screen>
        <Text variant="headlineSmall">Added {result.copies.length} cop{result.copies.length === 1 ? 'y' : 'ies'}</Text>
        {result.warnings.includes('NO_SHELF_SPACE') && <Card style={{ backgroundColor: '#ffe3e3' }}><Card.Content><Text>Not every copy could be shelved: that genre is out of space.</Text></Card.Content></Card>}
        <Card><Card.Content style={{ gap: 6 }}>
          <Text variant="labelLarge">Put on the shelf at</Text>
          {result.copies.map((c) => <View key={c.id} style={styles.between}><Text variant="titleSmall">{c.code}</Text><Text variant="titleLarge" style={{ fontWeight: '700' }}>{c.locationCode ?? 'UNSHELVED'}</Text></View>)}
        </Card.Content></Card>
        <Button mode="contained" icon="printer" onPress={() => setLabels(true)}>Print or share labels</Button>
        <Button mode="outlined" onPress={() => restart(true)}>Add another copy of this book</Button>
        <Button mode="outlined" onPress={() => restart(false)}>Add a different book</Button>
        <LabelSheet visible={labels} onClose={() => setLabels(false)} copyIds={result.copies.map((c) => c.id)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="titleMedium">1. Find the book</Text>
      {scanning && <ScannerView height={240} onScan={(raw) => { setScanning(false); void run(raw); }} />}
      <View style={styles.row}>
        <TextInput style={{ flex: 1 }} dense mode="outlined" label="ISBN, title or author" value={query} onChangeText={setQuery} onSubmitEditing={() => void run(query)} testID="find-input" />
        <IconButton icon="barcode-scan" mode="contained" onPress={() => setScanning((s) => !s)} accessibilityLabel="Scan the barcode" />
      </View>
      <Button mode="contained-tonal" onPress={() => void run(query)} loading={looking} disabled={!query.trim()}>Look up</Button>
      {hits?.map((h, i) => (
        <Card key={i} onPress={() => (h.isbn13 ? void run(h.isbn13) : (setExisting(h.titleId ?? null), setForm({ ...EMPTY, title: h.title, authors: h.authors.join(', ') }), setStep('form')))}>
          <Card.Content><Text variant="titleSmall">{h.title}</Text><Text variant="bodySmall" style={{ opacity: 0.7 }}>{h.authors.join(', ')} {h.firstPublishYear ?? ''}</Text></Card.Content>
        </Card>
      ))}
      {hits && <Button onPress={() => { setExisting(null); setForm({ ...EMPTY, title: query }); setStep('form'); }}>None of these: enter by hand</Button>}
      {step === 'find' && !hits && <Button onPress={() => { setExisting(null); setForm(EMPTY); setStep('form'); }}>No ISBN? Enter by hand</Button>}
      {note && <HelperText type="info" visible>{note}</HelperText>}

      {step === 'form' && (
        <View style={{ gap: 10 }}>
          {existing && lookup?.inInventory && <Card style={{ backgroundColor: '#e7f5ff' }}><Card.Content><Text>Already in inventory: {lookup.copyGroups?.reduce((a, g) => a + g.quantity, 0) ?? 0} copies ({lookup.copyGroups?.map((g) => `${g.quantity} × ${CONDITION_LABEL[g.condition]} ${fmt.money(g.sellingPriceMinor)}`).join(', ')}). Book details are locked.</Text></Card.Content></Card>}
          <Text variant="titleMedium">2. Book details</Text>
          <View style={styles.row}>
            {(photo ?? coverUrl) ? <Image source={{ uri: photo ?? coverUrl! }} style={{ width: 70, height: 100, borderRadius: 4 }} /> : null}
            <View style={{ flex: 1, gap: 6 }}>
              <Button mode="outlined" icon="camera" disabled={Boolean(existing)} onPress={takePhoto}>Take cover photo</Button>
              {(photo || coverUrl) && !existing && <Button onPress={() => { setPhoto(null); setCoverUrl(null); }}>Remove cover</Button>}
            </View>
          </View>
          <TextInput dense mode="outlined" label="Title *" value={form.title} onChangeText={(v) => set('title', v)} disabled={Boolean(existing)} testID="field-title" />
          <TextInput dense mode="outlined" label="Authors (comma separated)" value={form.authors} onChangeText={(v) => set('authors', v)} disabled={Boolean(existing)} />
          <View style={styles.row}>
            <TextInput style={{ flex: 1 }} dense mode="outlined" label="Publisher" value={form.publisher} onChangeText={(v) => set('publisher', v)} disabled={Boolean(existing)} />
            <TextInput style={{ width: 90 }} dense mode="outlined" label="Year" keyboardType="number-pad" value={form.year} onChangeText={(v) => set('year', v)} disabled={Boolean(existing)} />
          </View>
          {!existing && <GenrePicker value={form.genreId} onChange={(id) => set('genreId', id)} hint={lookup?.suggestedGenreId && form.genreId === lookup.suggestedGenreId ? `Suggested: ${genres.data?.find((g) => g.id === form.genreId)?.name}` : undefined} />}
          <TextInput dense mode="outlined" label="Summary" multiline numberOfLines={3} value={form.summary} onChangeText={(v) => set('summary', v)} disabled={Boolean(existing)} />

          <Text variant="titleMedium">3. This copy</Text>
          <View style={styles.wrap}>
            {BookCondition.values.map((c) => <Chip key={c} selected={form.condition === c} showSelectedCheck={false} onPress={() => set('condition', c)}>{CONDITION_LABEL[c]}</Chip>)}
          </View>
          <View style={styles.row}>
            <TextInput style={{ flex: 1 }} dense mode="outlined" label="MRP ₹" keyboardType="decimal-pad" value={form.mrp} onChangeText={(v) => set('mrp', v)} />
            <TextInput style={{ flex: 1 }} dense mode="outlined" label="Selling price ₹ *" keyboardType="decimal-pad" value={form.price} onChangeText={(v) => set('price', v)} testID="field-price" />
            <TextInput style={{ width: 70 }} dense mode="outlined" label="Qty" keyboardType="number-pad" value={form.qty} onChangeText={(v) => set('qty', v)} />
          </View>
          {suggestion.data && suggestion.data.suggestedMinor > 0 && <Chip icon="lightbulb-outline" onPress={() => set('price', String(suggestion.data!.suggestedMinor / 100))}>Suggested {fmt.money(suggestion.data.suggestedMinor)}: tap to use</Chip>}
          <TextInput dense mode="outlined" label="Donor" value={form.donor} onChangeText={(v) => set('donor', v)} />
          <TextInput dense mode="outlined" label="Notes" value={form.notes} onChangeText={(v) => set('notes', v)} />
          {!online && <HelperText type="error" visible>No internet: the book can’t be saved right now.</HelperText>}
          <Button mode="contained" contentStyle={{ paddingVertical: 8 }} onPress={save} loading={create.isPending} disabled={!online} testID="submit-book">Add {Number(form.qty) || 1} cop{Number(form.qty) === 1 || !form.qty ? 'y' : 'ies'}</Button>
        </View>
      )}
    </Screen>
  );
}
