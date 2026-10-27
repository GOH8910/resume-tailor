export function PdfPreview({ url, pages }: { url: string; pages: number }) {
  const unknown = pages === 0; // the counter found no page objects
  const onePage = pages === 1;
  const badge = unknown ? "bg-paper-deep text-ink-faint" : onePage ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn";
  return (
    <div className="rounded-lg border border-rule bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2 text-sm">
        <span className="font-medium">Preview</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
          {unknown ? "page count unknown" : `${pages} page${onePage ? "" : "s"}`}
        </span>
        {!unknown && !onePage && <span className="text-xs text-warn">Spills past one page. Remove a bullet or two and compile again.</span>}
      </div>
      <iframe title="Resume PDF preview" src={url} className="h-[80vh] w-full rounded-b-lg bg-white" />
    </div>
  );
}
