import Link from "next/link";
import type { LegalBlock, LegalDocument } from "@/legal/types";
import { FOCUS_RING } from "@/ui/Button";
import { splitLinks } from "./inline-links";

const LINK_CLASS = `rounded-sm text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent-deep hover:decoration-accent-deep ${FOCUS_RING}`;

/** "2026-10-29" as "29 October 2026", whatever the server's time zone. */
function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function Inline({ text }: { text: string }) {
  return splitLinks(text).map((part, index) => {
    if (!part.href) return part.text;
    if (part.href.startsWith("/")) {
      return (
        <Link key={index} href={part.href} className={LINK_CLASS}>
          {part.text}
        </Link>
      );
    }
    return (
      <a key={index} href={part.href} className={LINK_CLASS}>
        {part.text}
      </a>
    );
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <p>
        <Inline text={block} />
      </p>
    );
  }
  return (
    <ul className="grid list-disc gap-2 pl-5 marker:text-accent">
      {block.map((item, index) => (
        <li key={index} className="pl-1">
          <Inline text={item} />
        </li>
      ))}
    </ul>
  );
}

/** A privacy, terms or cookies page: the text comes from src/legal/, so it can change without touching this. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:py-16">
      <article>
        <header className="border-b border-rule pb-8">
          <h1 className="text-4xl tracking-tight sm:text-5xl">{document.title}</h1>
          <p className="mt-3 text-sm text-ink-faint">
            This is not legal advice; last updated <time dateTime={document.updated}>{longDate(document.updated)}</time>.
          </p>
          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            <Inline text={document.intro} />
          </p>
        </header>
        {document.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-2xl tracking-tight">{section.heading}</h2>
            <div className="mt-3 grid gap-4 leading-relaxed text-ink">
              {section.body.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </div>
          </section>
        ))}
      </article>
    </main>
  );
}
