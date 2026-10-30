"use client";

import { useRef, useState } from "react";
import type { ResumeBullet, ResumeEntry } from "@/applications/schema";
import type { Bullet, Entry } from "@/bank/schema";
import { MAX_CHARS } from "@/lib/input-caps";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { BulletDiff } from "./BulletDiff";

type Props = {
  entry: Entry;
  state: ResumeEntry;
  isFirst: boolean;
  isLast: boolean;
  onMoveEntry: (direction: -1 | 1) => void;
  onExclude: () => void;
  onSetText: (bulletId: string, text: string) => void;
  onRevert: (bulletId: string) => void;
  onRemove: (bulletId: string) => void;
  onMoveBullet: (bulletId: string, direction: -1 | 1) => void;
  onAdd: (bullet: Bullet) => void;
};

export function EntryReview(props: Props) {
  const { entry, state } = props;
  const selected = new Set(state.bullets.map((b) => b.bulletId));
  const unselected = entry.bullets.filter((b) => !selected.has(b.id) && b.text.trim());
  const dates = [entry.start, entry.end].filter(Boolean).join(" – ");

  return (
    <article className="rounded-lg border border-rule bg-card p-4 shadow-card">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-tight">
            {entry.title}
            {entry.org && <span className="font-normal text-ink-soft">, {entry.org}</span>}
          </h3>
          <p className="text-xs text-ink-faint">
            {dates}
            {entry.location && ` · ${entry.location}`}
          </p>
          {state.rationale && <p className="mt-1 text-xs italic text-ink-soft">{state.rationale}</p>}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Move entry up" disabled={props.isFirst} onClick={() => props.onMoveEntry(-1)}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move entry down" disabled={props.isLast} onClick={() => props.onMoveEntry(1)}>
            ↓
          </Button>
          <Button size="sm" variant="danger" onClick={props.onExclude}>
            Remove
          </Button>
        </div>
      </header>

      <ul className="mt-3 grid gap-2">
        {state.bullets.map((bullet, i) => (
          <BulletRow
            key={bullet.bulletId}
            bullet={bullet}
            isFirst={i === 0}
            isLast={i === state.bullets.length - 1}
            onSetText={(text) => props.onSetText(bullet.bulletId, text)}
            onRevert={() => props.onRevert(bullet.bulletId)}
            onRemove={() => props.onRemove(bullet.bulletId)}
            onMove={(d) => props.onMoveBullet(bullet.bulletId, d)}
          />
        ))}
        {state.bullets.length === 0 && <li className="text-sm text-ink-faint">No bullets selected.</li>}
      </ul>

      {unselected.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            Show {unselected.length} more from the bank
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {unselected.map((b) => (
              <li key={b.id} className="flex items-start gap-2 rounded-md bg-paper-deep/60 px-3 py-2">
                <p className="flex-1 text-sm text-ink-soft">{b.text}</p>
                <Button size="sm" onClick={() => props.onAdd(b)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

type RowProps = {
  bullet: ResumeBullet;
  isFirst: boolean;
  isLast: boolean;
  onSetText: (text: string) => void;
  onRevert: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
};

function BulletRow({ bullet, isFirst, isLast, onSetText, onRevert, onRemove, onMove }: RowProps) {
  const [editing, setEditing] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const changed = bullet.text !== bullet.original;

  const closeEditor = () => {
    setEditing(false);
    toggle.current?.focus();
  };

  return (
    <li className="grid gap-2 rounded-md border border-rule/70 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        {editing ? (
          <TextArea
            rows={3}
            autoFocus
            maxLength={MAX_CHARS.bullet}
            value={bullet.text}
            onChange={(e) => onSetText(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              closeEditor();
            }}
          />
        ) : changed ? (
          <BulletDiff original={bullet.original} text={bullet.text} />
        ) : (
          <p className="text-sm leading-relaxed">{bullet.text}</p>
        )}
        {changed && !editing && <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">edited from bank</p>}
      </div>
      <div className="flex flex-wrap items-start gap-1">
        {/* Prevent the mousedown blur from closing the editor before the click toggles it. */}
        <Button
          ref={toggle}
          size="sm"
          variant="ghost"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (editing ? closeEditor() : setEditing(true))}
        >
          {editing ? "Done" : "Edit"}
        </Button>
        {changed && (
          <Button size="sm" variant="ghost" onClick={onRevert}>
            Revert
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Move bullet up" disabled={isFirst} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" aria-label="Move bullet down" disabled={isLast} onClick={() => onMove(1)}>
          ↓
        </Button>
        <Button size="sm" variant="danger" aria-label="Remove bullet" onClick={onRemove}>
          ✕
        </Button>
      </div>
    </li>
  );
}
