"use client";

import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import { type Bullet, type Entry, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";

type Props = { section: SectionKey; entries: Entry[]; onChange: (entries: Entry[]) => void };

const TITLE_LABEL: Record<SectionKey, string> = { experience: "Role title", projects: "Project name", education: "Institution" };
const ORG_LABEL: Record<SectionKey, string> = { experience: "Company", projects: "Organisation (optional)", education: "Degree" };

type TextField = "title" | "org" | "location" | "start" | "end" | "link";

export function EntryEditor({ section, entries, onChange }: Props) {
  const replace = (id: string, fn: (e: Entry) => Entry) => onChange(entries.map((e) => (e.id === id ? fn(e) : e)));
  const setField = (id: string, key: TextField, value: string) => replace(id, (e) => ({ ...e, [key]: value }));
  const add = () =>
    onChange([...entries, { id: newId("e"), title: "", org: "", location: "", start: "", end: "", link: "", bullets: [] }]);

  return (
    <div className="grid gap-5">
      {entries.length === 0 && <p className="text-ink-soft">No {SECTION_LABELS[section].toLowerCase()} yet.</p>}
      {entries.map((entry, index) => (
        <article key={entry.id} className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={TITLE_LABEL[section]}>
              <TextInput value={entry.title} onChange={(e) => setField(entry.id, "title", e.target.value)} />
            </Field>
            <Field label={ORG_LABEL[section]}>
              <TextInput value={entry.org ?? ""} onChange={(e) => setField(entry.id, "org", e.target.value)} />
            </Field>
            <Field label="Start">
              <TextInput value={entry.start} placeholder="Jul 2025" onChange={(e) => setField(entry.id, "start", e.target.value)} />
            </Field>
            <Field label="End">
              <TextInput value={entry.end} placeholder="Present" onChange={(e) => setField(entry.id, "end", e.target.value)} />
            </Field>
            <Field label="Location (optional)">
              <TextInput value={entry.location ?? ""} placeholder="London, UK" onChange={(e) => setField(entry.id, "location", e.target.value)} />
            </Field>
            <Field label="Link (optional)">
              <TextInput value={entry.link ?? ""} placeholder="https://" onChange={(e) => setField(entry.id, "link", e.target.value)} />
            </Field>
          </div>

          <BulletList bullets={entry.bullets} onChange={(bullets) => replace(entry.id, (e) => ({ ...e, bullets }))} />

          <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
            <Button size="sm" variant="ghost" aria-label="Move entry up" disabled={index === 0} onClick={() => onChange(moveItem(entries, index, index - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move entry down" disabled={index === entries.length - 1} onClick={() => onChange(moveItem(entries, index, index + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" className="ml-auto" onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}>
              Delete entry
            </Button>
          </div>
        </article>
      ))}
      <div>
        <Button variant="primary" onClick={add}>
          Add {section === "projects" ? "project" : "entry"}
        </Button>
      </div>
    </div>
  );
}

function BulletList({ bullets, onChange }: { bullets: Bullet[]; onChange: (bullets: Bullet[]) => void }) {
  const replace = (id: string, fn: (b: Bullet) => Bullet) => onChange(bullets.map((b) => (b.id === id ? fn(b) : b)));
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Bullets <span className="font-normal text-ink-faint">({bullets.length})</span>
      </p>
      <ul className="grid gap-2">
        {bullets.map((bullet, i) => (
          <li key={bullet.id} className="flex gap-2">
            <TextArea
              rows={2}
              value={bullet.text}
              placeholder="New bullet"
              onChange={(e) => {
                const text = e.target.value;
                replace(bullet.id, (b) => ({ ...b, text }));
              }}
            />
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant={bullet.pinned ? "primary" : "ghost"}
                title="Pinned bullets are always included when this entry is on the resume"
                aria-pressed={Boolean(bullet.pinned)}
                onClick={() => replace(bullet.id, (b) => ({ ...b, pinned: !b.pinned }))}
              >
                Pin
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move bullet up" disabled={i === 0} onClick={() => onChange(moveItem(bullets, i, i - 1))}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move bullet down" disabled={i === bullets.length - 1} onClick={() => onChange(moveItem(bullets, i, i + 1))}>
                ↓
              </Button>
              <Button size="sm" variant="danger" aria-label="Delete bullet" onClick={() => onChange(bullets.filter((b) => b.id !== bullet.id))}>
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-2" onClick={() => onChange([...bullets, { id: newId("b"), text: "" }])}>
        Add bullet
      </Button>
    </div>
  );
}
