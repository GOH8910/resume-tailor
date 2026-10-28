"use client";

import { useState } from "react";
import { FONT_SIZE_OPTIONS, type Layout, MARGIN_RANGE, type Margins } from "@/latex/layout";
import { Button } from "@/ui/Button";
import { Field, Select, TextInput } from "@/ui/Field";

type Props = {
  /** The layout the next compile will use. */
  layout: Layout;
  /** True when this resume has its own layout rather than the profile default. */
  customised: boolean;
  onChange: (layout: Layout) => void;
  onReset: () => void;
  /** Makes the current layout the profile default. Rejections are reported by the caller. */
  onSaveDefault: () => Promise<void>;
};

const AUTO = "auto";
const MARGIN_FIELDS: { key: keyof Margins; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

function clampMargin(value: number): number {
  return Math.min(MARGIN_RANGE.max, Math.max(MARGIN_RANGE.min, value));
}

export function LayoutControls({ layout, customised, onChange, onReset, onSaveDefault }: Props) {
  const [savingDefault, setSavingDefault] = useState(false);

  function setMargin(key: keyof Margins, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return; // mid-typing; the blur handler tidies up
    onChange({ ...layout, margins: { ...layout.margins, [key]: clampMargin(value) } });
  }

  async function saveDefault() {
    setSavingDefault(true);
    try {
      await onSaveDefault();
    } finally {
      setSavingDefault(false);
    }
  }

  return (
    <fieldset className="rounded-lg border border-rule bg-card px-4 py-3 shadow-card">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Layout</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Field label="Font size">
            <Select
              value={layout.fontSize === null ? AUTO : String(layout.fontSize)}
              onChange={(e) => onChange({ ...layout, fontSize: e.target.value === AUTO ? null : Number(e.target.value) })}
            >
              <option value={AUTO}>Auto (fill page)</option>
              {FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} pt
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {MARGIN_FIELDS.map(({ key, label }) => (
          <div key={key} className="w-24">
            <Field label={`${label} (in)`}>
              <TextInput
                type="number"
                inputMode="decimal"
                min={MARGIN_RANGE.min}
                max={MARGIN_RANGE.max}
                step={MARGIN_RANGE.step}
                value={layout.margins[key]}
                onChange={(e) => setMargin(key, e.target.value)}
                onBlur={(e) => {
                  // Leave a cleared or out-of-range box showing the value that will actually be used.
                  e.currentTarget.value = String(layout.margins[key]);
                }}
              />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onReset} disabled={!customised}>
            Reset to default
          </Button>
          <Button size="sm" onClick={() => void saveDefault()} disabled={savingDefault}>
            {savingDefault ? "Saving…" : "Use for new resumes"}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        Auto picks the largest font size (8.5–12pt) that fits one page; a fixed size can spill onto a second page. The preview updates on its own.
      </p>
    </fieldset>
  );
}
