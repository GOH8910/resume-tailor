import Link from "next/link";
import { LINK_CLASS } from "@/ui/Button";
import { LEGAL_PAGES } from "@/ui/legal/legal-pages";

export function PublicFooter({ sourceCodeUrl }: { sourceCodeUrl: string }) {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink-faint">Resume Tailor is free and open source (AGPL-3.0).</p>
        <nav aria-label="Footer" className="text-ink-soft">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <a href={sourceCodeUrl} className={LINK_CLASS}>
                Source code
              </a>
            </li>
            {LEGAL_PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className={LINK_CLASS}>
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
