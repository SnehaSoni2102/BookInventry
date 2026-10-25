/**
 * Opens a PDF in a new tab (the browser's viewer has a print button).
 * The tab must be opened synchronously inside the click handler, before any `await`; otherwise the browser
 * treats it as a pop-up and blocks it. So: open a blank tab now, fill it when the PDF has arrived.
 */
export async function openPdf(getBlob: () => Promise<Blob>): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const blob = await getBlob();
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else saveBlob(blob, 'document.pdf'); // pop-ups are blocked outright: fall back to a download
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** @deprecated use openPdf() inside click handlers. Kept for callers that already hold a blob. */
export function openBlob(blob: Blob): void {
  void openPdf(async () => blob);
}

/** Prints a PDF blob through a hidden iframe so the OS print dialog (and the label printer) opens directly. */
export function printBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        openBlob(blob);
      }
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
        resolve();
      }, 1000);
    };
    document.body.appendChild(frame);
  });
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
