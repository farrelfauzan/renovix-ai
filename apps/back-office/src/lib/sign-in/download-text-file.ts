/**
 * Saves `text` as a plain-text file named `fileName` (RNX-333: the recovery codes). The file is built in the browser
 * as a blob: URL, so nothing is sent anywhere; the URL is released right after the download starts.
 */
export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
