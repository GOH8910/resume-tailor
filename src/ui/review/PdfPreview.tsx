type Props = {
  url: string;
  pages: number;
  /** A newer version is being compiled; the current one stays visible, dimmed, until it lands. */
  compiling: boolean;
};

export function PdfPreview({ url, pages, compiling }: Props) {
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
        {!unknown && !onePage && (
          <span className="text-xs text-warn">Too long even at the smallest font size. Remove a bullet or two.</span>
        )}
        {compiling && <span className="ml-auto text-xs text-ink-faint">Updating…</span>}
      </div>
      {/* A4 proportions so the whole page is visible at once; view=Fit asks the viewer to fit the page. */}
      <iframe
        title="Resume PDF preview"
        src={`${url}#toolbar=0&navpanes=0&view=Fit`}
        className={`aspect-[210/297] w-full rounded-b-lg bg-white transition-opacity duration-300 ${compiling ? "opacity-60" : "opacity-100"}`}
      />
    </div>
  );
}
