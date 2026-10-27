"use client";

import * as edit from "@/applications/edit";
import type { ResumeState } from "@/applications/schema";
import { type Bank, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { EntryReview } from "./EntryReview";

type Props = {
  section: SectionKey;
  bank: Bank;
  resume: ResumeState;
  onChange: (fn: (state: ResumeState) => ResumeState) => void;
};

export function SectionReview({ section, bank, resume, onChange }: Props) {
  const included = resume[section];
  const byId = new Map(bank[section].map((e) => [e.id, e]));
  const excluded = bank[section].filter((e) => e.title.trim() && !included.some((r) => r.entryId === e.id));

  return (
    <section aria-labelledby={`review-${section}`}>
      <h2 id={`review-${section}`} className="mb-3 border-b border-ink pb-1 text-2xl">
        {SECTION_LABELS[section]}
      </h2>
      <div className="grid gap-3">
        {included.map((state, i) => {
          const entry = byId.get(state.entryId);
          if (!entry) return null;
          return (
            <EntryReview
              key={state.entryId}
              entry={entry}
              state={state}
              isFirst={i === 0}
              isLast={i === included.length - 1}
              onMoveEntry={(d) => onChange((s) => edit.moveEntry(s, section, entry.id, d))}
              onExclude={() => onChange((s) => edit.excludeEntry(s, section, entry.id))}
              onSetText={(bulletId, text) => onChange((s) => edit.setBulletText(s, section, entry.id, bulletId, text))}
              onRevert={(bulletId) => onChange((s) => edit.revertBullet(s, section, entry.id, bulletId))}
              onRemove={(bulletId) => onChange((s) => edit.removeBullet(s, section, entry.id, bulletId))}
              onMoveBullet={(bulletId, d) => onChange((s) => edit.moveBullet(s, section, entry.id, bulletId, d))}
              onAdd={(bullet) => onChange((s) => edit.addBullet(s, section, entry.id, bullet, bank))}
            />
          );
        })}
        {included.length === 0 && <p className="text-sm text-ink-faint">Nothing from this section is on the resume.</p>}
      </div>
      {excluded.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            Not included ({excluded.length})
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {excluded.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-md bg-paper-deep/60 px-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{e.title}</span>
                  {e.org && <span className="text-ink-soft">, {e.org}</span>}
                </span>
                <Button size="sm" onClick={() => onChange((s) => edit.includeEntry(s, bank, section, e.id))}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
