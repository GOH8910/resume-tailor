"use client";

import type { Bank } from "@/bank/schema";
import { Field, TextArea, TextInput } from "@/ui/Field";

type Props = { bank: Bank; onChange: (fn: (bank: Bank) => Bank) => void };

const FIELDS: Array<{ key: keyof Bank["profile"]; label: string; placeholder: string }> = [
  { key: "name", label: "Full name", placeholder: "Your name as it appears on the resume" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone", placeholder: "+44 ..." },
  { key: "linkedin", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/..." },
  { key: "github", label: "GitHub URL", placeholder: "https://github.com/..." },
  { key: "website", label: "Website URL", placeholder: "https://..." },
];

export function ProfileForm({ bank, onChange }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid gap-4 rounded-lg border border-rule bg-card p-5 shadow-card">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <TextInput
              value={bank.profile[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => {
                const value = e.target.value;
                onChange((b) => ({ ...b, profile: { ...b.profile, [f.key]: value } }));
              }}
            />
          </Field>
        ))}
      </div>
      <div className="rounded-lg border border-rule bg-card p-5 shadow-card">
        <Field
          label="Master summary"
          hint="Claude rewrites this for each job description using only facts from here and your bullets."
        >
          <TextArea
            rows={8}
            value={bank.summary}
            onChange={(e) => {
              const summary = e.target.value;
              onChange((b) => ({ ...b, summary }));
            }}
          />
        </Field>
      </div>
    </div>
  );
}
