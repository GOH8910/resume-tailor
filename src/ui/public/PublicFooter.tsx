import Link from "next/link";
import { SOURCE_CODE_URL } from "@/lib/site";
import { FOCUS_RING } from "@/ui/Button";

const LINK_CLASS = `rounded-sm text-ink-soft underline-offset-4 transition-colors hover:text-ink hover:underline ${FOCUS_RING}`;

const PAGES = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink-faint">Resume Tailor is free and open source (AGPL-3.0).</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <a href={SOURCE_CODE_URL} className={LINK_CLASS}>
                GitHub
              </a>
            </li>
            {PAGES.map((page) => (
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
