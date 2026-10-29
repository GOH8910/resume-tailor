import type { ReactNode } from "react";

/**
 * The sign-in card's frame for a page that only says what happened: not found, or an error. Classes only, no
 * style="" attributes: the production Content-Security-Policy blocks those.
 */
export function StatusCard({ title, message, children }: { title: string; message: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-card p-8 shadow-card">
        <p className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </p>
        <h1 className="mt-6 text-3xl tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">{children}</div>
      </div>
    </main>
  );
}
