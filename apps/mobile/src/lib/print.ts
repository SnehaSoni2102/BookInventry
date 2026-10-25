import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/** React Native's FileReader turns a Blob into a data URL; strip the prefix to get plain base64. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

/** Saves a downloaded file into the cache directory and returns its file:// URI. */
export async function saveToCache(blob: Blob, filename: string): Promise<string> {
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, await blobToBase64(blob), { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Sends a PDF to the Android print service (Bluetooth label printers ship a plug-in for it). */
export async function printPdf(blob: Blob, filename = 'document.pdf'): Promise<void> {
  await Print.printAsync({ uri: await saveToCache(blob, filename) });
}

export async function sharePdf(blob: Blob, filename = 'document.pdf', dialogTitle?: string): Promise<void> {
  const uri = await saveToCache(blob, filename);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' });
}

export async function shareFile(blob: Blob, filename: string, mimeType: string): Promise<void> {
  const uri = await saveToCache(blob, filename);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType });
}
