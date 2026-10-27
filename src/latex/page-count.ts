/**
 * Counts page objects in a PDF. Relies on page objects being uncompressed,
 * which templates/resume.tex guarantees with \pdfobjcompresslevel=0.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches ? matches.length : 0;
}
