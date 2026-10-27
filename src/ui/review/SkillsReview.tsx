"use client";

import { useState } from "react";
import { moveItem } from "@/applications/edit";
import type { Bank, SkillCategory } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { splitItems } from "@/ui/split-items";

type Props = { bank: Bank; skills: SkillCategory[]; onChange: (skills: SkillCategory[]) => void };

export function SkillsReview({ bank, skills, onChange }: Props) {
  const missing = bank.skills.filter((c) => c.name.trim() && !skills.some((s) => s.id === c.id));
  const replace = (id: string, fn: (c: SkillCategory) => SkillCategory) => onChange(skills.map((c) => (c.id === id ? fn(c) : c)));

  return (
    <section aria-labelledby="review-skills">
      <h2 id="review-skills" className="mb-3 border-b border-ink pb-1 text-2xl">
        Skills
      </h2>
      <div className="grid gap-2">
        {skills.map((cat, i) => (
          <div key={cat.id} className="flex items-center gap-2 rounded-lg border border-rule bg-card px-3 py-2 shadow-card">
            <span className="w-44 shrink-0 text-sm font-semibold">{cat.name}:</span>
            <ItemsInput items={cat.items} onCommit={(items) => replace(cat.id, (c) => ({ ...c, items }))} />
            <Button size="sm" variant="ghost" aria-label="Move category up" disabled={i === 0} onClick={() => onChange(moveItem(skills, i, i - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move category down" disabled={i === skills.length - 1} onClick={() => onChange(moveItem(skills, i, i + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" aria-label="Remove category" onClick={() => onChange(skills.filter((c) => c.id !== cat.id))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {missing.map((c) => (
            <Button key={c.id} size="sm" onClick={() => onChange([...skills, { ...c, items: [...c.items] }])}>
              + {c.name}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemsInput({ items, onCommit }: { items: string[]; onCommit: (items: string[]) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <TextInput
      aria-label="Skill items, comma-separated"
      value={editing ? text : items.join(", ")}
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
  );
}
