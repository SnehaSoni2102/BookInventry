const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** `{GENRE}-{RACK}{ROW:2}-{SLOT:3}`, e.g. FIC-A03-017 */
export function formatLocation(
  genreCode: string,
  rackCode: string,
  rowNumber: number,
  slot: number,
): string {
  return `${genreCode}-${rackCode}${pad(rowNumber, 2)}-${pad(slot, 3)}`;
}
