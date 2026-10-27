"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import { type Bullet, type Entry, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { ReorderControls } from "@/ui/ReorderControls";

type Props = { section: SectionKey; entries: Entry[]; onChange: (entries: Entry[]) => void };

const TITLE_LABEL: Record<SectionKey, string> = { experience: "Role title", projects: "Project name", education: "Institution" };
const ORG_LABEL: Record<SectionKey, string> = { experience: "Company", projects: "Organisation (optional)", education: "Degree" };

type TextField = "title" | "org" | "location" | "start" | "end" | "link";

export function EntryEditor({ section, entries, onChange }: Props) {
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const noun = section === "projects" ? "project" : "entry";
  const replace = (id: string, fn: (e: Entry) => Entry) => onChange(entries.map((e) => (e.id === id ? fn(e) : e)));
  const setField = (id: string, key: TextField, value: string) => replace(id, (e) => ({ ...e, [key]: value }));
  const add = () => {
    const id = newId("e");
    setLastAddedId(id);
    onChange([...entries, { id, title: "", org: "", location: "", start: "", end: "", link: "", bullets: [] }]);
  };

  return (
    <div className="grid gap-5">
      {entries.length === 0 && <p className="text-ink-soft">No {SECTION_LABELS[section].toLowerCase()} yet.</p>}
      {entries.map((entry, index) => (
        <article key={entry.id} className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className={`break-words text-lg leading-snug ${entry.title.trim() ? "" : "text-ink-faint"}`}>
                {entry.title.trim() || "Untitled"}
              </h2>
              {subtitle(entry) && <p className="text-sm text-ink-soft">{subtitle(entry)}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <ReorderControls
                noun={noun}
                index={index}
                count={entries.length}
                onMove={(direction) => onChange(moveItem(entries, index, index + direction))}
                onDelete={() => onChange(entries.filter((e) => e.id !== entry.id))}
                confirmDelete
              />
            </div>
          </header>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={TITLE_LABEL[section]}>
              <TextInput
                autoFocus={entry.id === lastAddedId}
                value={entry.title}
                onChange={(e) => setField(entry.id, "title", e.target.value)}
              />
            </Field>
            <Field label={ORG_LABEL[section]}>
              <TextInput value={entry.org ?? ""} onChange={(e) => setField(entry.id, "org", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <Field label="Start">
                <TextInput value={entry.start} placeholder="Jul 2025" onChange={(e) => setField(entry.id, "start", e.target.value)} />
              </Field>
              <Field label="End">
                <TextInput value={entry.end} placeholder="Present" onChange={(e) => setField(entry.id, "end", e.target.value)} />
              </Field>
            </div>
            <Field label="Location (optional)">
              <TextInput value={entry.location ?? ""} placeholder="London, UK" onChange={(e) => setField(entry.id, "location", e.target.value)} />
            </Field>
            <Field label="Link (optional)">
              <TextInput value={entry.link ?? ""} placeholder="https://" onChange={(e) => setField(entry.id, "link", e.target.value)} />
            </Field>
          </div>

          <BulletList bullets={entry.bullets} onChange={(bullets) => replace(entry.id, (e) => ({ ...e, bullets }))} />
        </article>
      ))}
      <div>
        <Button variant="primary" onClick={add}>
          Add {noun}
        </Button>
      </div>
    </div>
  );
}

/** "Acme Corp · Jul 2024 – Jan 2025", skipping whatever is blank. */
function subtitle(entry: Entry): string {
  const dates = [entry.start, entry.end].filter(Boolean).join(" – ");
  return [entry.org, dates].filter(Boolean).join(" · ");
}

function BulletList({ bullets, onChange }: { bullets: Bullet[]; onChange: (bullets: Bullet[]) => void }) {
  const pinHintId = useId();
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const replace = (id: string, fn: (b: Bullet) => Bullet) => onChange(bullets.map((b) => (b.id === id ? fn(b) : b)));
  const add = () => {
    const id = newId("b");
    setLastAddedId(id);
    onChange([...bullets, { id, text: "" }]);
  };
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Bullets <span className="font-normal text-ink-faint">({bullets.length})</span>
        <span id={pinHintId} className="ml-2 font-normal normal-case tracking-normal text-ink-faint">
          pinned bullets are always included
        </span>
      </p>
      <ul className="grid gap-2">
        {bullets.map((bullet, i) => (
          <li key={bullet.id} className="flex items-start gap-2">
            <BulletText
              label={`Bullet ${i + 1}`}
              text={bullet.text}
              pinned={Boolean(bullet.pinned)}
              autoFocus={bullet.id === lastAddedId}
              onChange={(text) => replace(bullet.id, (b) => ({ ...b, text }))}
            />
            <div className="flex flex-col gap-1 sm:mt-1.5 sm:flex-row">
              <Button
                size="sm"
                variant={bullet.pinned ? "primary" : "ghost"}
                aria-pressed={Boolean(bullet.pinned)}
                aria-describedby={pinHintId}
                onClick={() => replace(bullet.id, (b) => ({ ...b, pinned: !b.pinned }))}
              >
                Pin
              </Button>
              <ReorderControls
                noun="bullet"
                index={i}
                count={bullets.length}
                onMove={(direction) => onChange(moveItem(bullets, i, i + direction))}
                onDelete={() => onChange(bullets.filter((b) => b.id !== bullet.id))}
              />
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-2" onClick={add}>
        Add bullet
      </Button>
    </div>
  );
}

type BulletTextProps = { label: string; text: string; pinned: boolean; autoFocus: boolean; onChange: (text: string) => void };

/** A textarea that grows with its text, with an accent rule on the left when the bullet is pinned. */
function BulletText({ label, text, pinned, autoFocus, onChange }: BulletTextProps) {
  const wrapper = useRef<HTMLDivElement>(null);

  // TextArea does not forward a ref, so find the element through its wrapper.
  useLayoutEffect(() => {
    const textarea = wrapper.current?.querySelector("textarea");
    if (!textarea) return;
    const fit = () => {
      textarea.style.height = "auto";
      // scrollHeight excludes the border, which border-box sizing counts.
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit); // wrapping changes with the width
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  return (
    <div ref={wrapper} className={`min-w-0 flex-1 border-l-2 pl-2 ${pinned ? "border-accent" : "border-transparent"}`}>
      <TextArea
        rows={1}
        className="block resize-none"
        aria-label={label}
        autoFocus={autoFocus}
        value={text}
        placeholder="New bullet"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
