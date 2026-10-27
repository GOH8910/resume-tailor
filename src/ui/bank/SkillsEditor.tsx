"use client";

import { useState } from "react";
import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import type { SkillCategory } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";

import { splitItems } from "@/ui/split-items";

type Props = { skills: SkillCategory[]; onChange: (skills: SkillCategory[]) => void };

export function SkillsEditor({ skills, onChange }: Props) {
  const replace = (id: string, fn: (c: SkillCategory) => SkillCategory) =>
    onChange(skills.map((c) => (c.id === id ? fn(c) : c)));
  return (
    <div className="grid gap-4">
      {skills.length === 0 && <p className="text-ink-soft">No skill categories yet.</p>}
      {skills.map((cat, i) => (
        <div key={cat.id} className="grid gap-3 rounded-lg border border-rule bg-card p-5 shadow-card sm:grid-cols-[14rem_1fr_auto]">
          <Field label="Category">
            <TextInput
              value={cat.name}
              placeholder="Programming"
              onChange={(e) => {
                const name = e.target.value;
                replace(cat.id, (c) => ({ ...c, name }));
              }}
            />
          </Field>
          <ItemsField items={cat.items} onCommit={(items) => replace(cat.id, (c) => ({ ...c, items }))} />
          <div className="flex items-end gap-1">
            <Button size="sm" variant="ghost" aria-label="Move category up" disabled={i === 0} onClick={() => onChange(moveItem(skills, i, i - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move category down" disabled={i === skills.length - 1} onClick={() => onChange(moveItem(skills, i, i + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" onClick={() => onChange(skills.filter((c) => c.id !== cat.id))}>
              Delete
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="primary" onClick={() => onChange([...skills, { id: newId("s"), name: "", items: [] }])}>
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
      <TextInput
        value={editing ? text : items.join(", ")}
        placeholder="Python, Go, TypeScript"
        onFocus={() => {
          setText(items.join(", "));
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(splitItems(text));
        }}
      />
    </Field>
  );
}
