/** Hands a blob to the browser as a file download. Nothing is rendered from the content. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveText(text: string, fileName: string, mimeType: string): void {
  saveBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), fileName);
}

/** File-name safe slug for exports ("Büromöbel Angebote" -> "bueromoebel-angebote"). */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "export";
}
