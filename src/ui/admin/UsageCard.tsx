import type { UsageBreakdown } from "@/admin/summary";
import { modelName } from "@/tailor/model";
import { formatGbp } from "./format";

const KIND_LABELS: Record<string, string> = { tailor: "Tailor", chat: "Chat", seed: "Seed script" };

type Row = { label: string; calls: number; costGbp: number };

function BreakdownTable({ caption, column, rows }: { caption: string; column: string; rows: Row[] }) {
  return (
    <table className="mt-4 w-full text-sm">
      <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-ink-soft">{caption}</caption>
      <thead>
        <tr className="border-b border-rule text-left text-xs text-ink-faint">
          <th scope="col" className="py-1.5 pr-3 font-medium">
            {column}
          </th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">
            Calls
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-rule/60 last:border-0">
            <td className="break-words py-1.5 pr-3">{row.label}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{row.calls}</td>
            <td className="py-1.5 text-right tabular-nums">{formatGbp(row.costGbp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One period's costed Claude calls: the totals, then by model and by kind. */
export function UsageCard({ title, usage }: { title: string; usage: UsageBreakdown }) {
  const headingId = `usage-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id={headingId} className="text-2xl tracking-tight">
        {title}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-soft">Cost</dt>
          <dd className="font-serif text-3xl tabular-nums">{formatGbp(usage.costGbp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Free accounts</dt>
          <dd className="font-serif text-3xl tabular-nums">{formatGbp(usage.freeCostGbp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Calls</dt>
          <dd className="font-serif text-3xl tabular-nums">{usage.calls}</dd>
        </div>
      </dl>
      {usage.calls === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">No calls yet.</p>
      ) : (
        <>
          <BreakdownTable caption="By model" column="Model" rows={usage.byModel.map((row) => ({ ...row, label: modelName(row.model) }))} />
          <BreakdownTable caption="By kind" column="Kind" rows={usage.byKind.map((row) => ({ ...row, label: KIND_LABELS[row.kind] ?? row.kind }))} />
        </>
      )}
    </section>
  );
}
