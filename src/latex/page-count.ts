/**
 * Counts page objects in a PDF. Relies on page objects being uncompressed,
 * which templates/resume.tex guarantees with \pdfobjcompresslevel=0.
 * Returns 0 when no page objects are found, which callers should treat as unknown
 * (for example when object streams are compressed).
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?!\w)/g);
  return matches ? matches.length : 0;
}
