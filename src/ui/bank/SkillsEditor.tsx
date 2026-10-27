"use client";

import { useState } from "react";
import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import type { SkillCategory } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { ReorderControls } from "@/ui/ReorderControls";
import { splitItems } from "@/ui/split-items";

type Props = { skills: SkillCategory[]; onChange: (skills: SkillCategory[]) => void };

export function SkillsEditor({ skills, onChange }: Props) {
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const replace = (id: string, fn: (c: SkillCategory) => SkillCategory) =>
    onChange(skills.map((c) => (c.id === id ? fn(c) : c)));
  const add = () => {
    const id = newId("s");
    setLastAddedId(id);
    onChange([...skills, { id, name: "", items: [] }]);
  };
  return (
    <div className="grid gap-4">
      {skills.length === 0 && <p className="text-ink-soft">No skill categories yet.</p>}
      {skills.map((cat, i) => (
        <div key={cat.id} className="grid gap-3 rounded-lg border border-rule bg-card p-5 shadow-card sm:grid-cols-[14rem_1fr]">
          <Field label="Category">
            <TextInput
              autoFocus={cat.id === lastAddedId}
              value={cat.name}
              placeholder="Programming"
              onChange={(e) => {
                const name = e.target.value;
                replace(cat.id, (c) => ({ ...c, name }));
              }}
            />
          </Field>
          <ItemsField items={cat.items} onCommit={(items) => replace(cat.id, (c) => ({ ...c, items }))} />
          <div className="flex flex-wrap items-center gap-1 sm:col-span-2">
            <ReorderControls
              noun="category"
              index={i}
              count={skills.length}
              onMove={(direction) => onChange(moveItem(skills, i, i + direction))}
              onDelete={() => onChange(skills.filter((c) => c.id !== cat.id))}
              confirmDelete
            />
          </div>
        </div>
      ))}
      <div>
        <Button variant="primary" onClick={add}>
          Add category
        </Button>
      </div>
    </div>
  );
}

/** Comma-separated editor that commits on blur, so typing a comma does not split mid-keystroke. */
function ItemsField({ items, onCommit }: { items: string[]; onCommit: (items: string[]) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <Field label="Items (comma-separated)">
      <TextArea
        rows={2}
        value={editing ? text : items.join(", ")}
        placeholder="Python, Go, TypeScript"
        onFocus={() => {
          setText(items.join(", "));
          setEditing(true);
        }}
        // Items are comma-separated, so a line break (Enter or a pasted list) becomes a separator.
        onChange={(e) => setText(e.target.value.replace(/\s*\n\s*/g, ", "))}
        onBlur={() => {
          setEditing(false);
          const next = splitItems(text);
          if (next.length !== items.length || next.some((item, i) => item !== items[i])) onCommit(next);
        }}
      />
    </Field>
  );
}
