import { useGenres } from '@bookstall/api-client';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Dialog, Portal, RadioButton, Text } from 'react-native-paper';

/** A button that opens a scrollable list of genres (27 do not fit in a dropdown on a phone). */
export function GenrePicker({ value, onChange, hint }: { value: string | null; onChange: (id: string) => void; hint?: string }) {
  const genres = useGenres();
  const [open, setOpen] = useState(false);
  const current = genres.data?.find((g) => g.id === value);
  return (
    <>
      <Button mode="outlined" icon="tag-outline" onPress={() => setOpen(true)} contentStyle={{ justifyContent: 'flex-start' }} testID="genre-picker">
        {current ? `${current.name} (${current.code})` : 'Choose a genre'}
      </Button>
      {hint ? <Text variant="bodySmall" style={{ opacity: 0.7 }}>{hint}</Text> : null}
      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)}>
          <Dialog.Title>Genre (decides the shelf)</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 420 }}>
            <ScrollView>
              <RadioButton.Group value={value ?? ''} onValueChange={(v) => { onChange(v); setOpen(false); }}>
                {(genres.data ?? []).map((g) => <RadioButton.Item key={g.id} label={`${g.name} (${g.code})`} value={g.id} />)}
              </RadioButton.Group>
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
    </>
  );
}
