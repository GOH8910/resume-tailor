import type { ReactNode } from "react";

type Tone = "error" | "warn" | "ok" | "info";

const TONES: Record<Tone, string> = {
  error: "border-accent/30 bg-accent-soft text-accent-deep",
  warn: "border-warn/30 bg-warn-soft text-warn",
  ok: "border-ok/30 bg-ok-soft text-ok",
  info: "border-rule bg-paper-deep text-ink-soft",
};

export function Banner({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3.5 py-2.5 text-sm ${TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}
