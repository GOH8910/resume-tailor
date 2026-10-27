import { z } from "zod";

/** Page margins in inches. */
export const MarginsSchema = z.object({
  top: z.number().min(0.2).max(2),
  bottom: z.number().min(0.2).max(2),
  left: z.number().min(0.2).max(2),
  right: z.number().min(0.2).max(2),
});

/** PDF layout: `fontSize` in points, or null to pick the largest size (8.5–12pt) that fills one page. */
export const LayoutSchema = z.object({
  fontSize: z.number().min(7).max(14).nullable(),
  margins: MarginsSchema,
});

export type Margins = z.infer<typeof MarginsSchema>;
export type Layout = z.infer<typeof LayoutSchema>;

/** Measured from CV_Edward.pdf. */
export const DEFAULT_LAYOUT: Layout = {
  fontSize: null,
  margins: { top: 0.8, bottom: 0.8, left: 0.75, right: 0.75 },
};

export const MARGIN_RANGE = { min: 0.2, max: 2, step: 0.05 } as const;
export const FONT_SIZE_OPTIONS = [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13] as const;

/** A resume's own layout wins over the profile default, which wins over the built-in one. */
export function resolveLayout(resume: Layout | undefined, profileDefault: Layout | undefined): Layout {
  return resume ?? profileDefault ?? DEFAULT_LAYOUT;
}

export function sameLayout(a: Layout | undefined, b: Layout | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.fontSize === b.fontSize &&
    a.margins.top === b.margins.top &&
    a.margins.bottom === b.margins.bottom &&
    a.margins.left === b.margins.left &&
    a.margins.right === b.margins.right
  );
}

function inches(value: number): string {
  return `${value.toFixed(2)}in`;
}

/**
 * LaTeX definitions the template reads for its page geometry and font size, as one line to prepend
 * to the template (the template's own \providecommand defaults then stay unused).
 * The font size travels as tenths of a point because the template's fitting loop counts in tenths.
 */
export function layoutPreamble(layout: Layout): string {
  const tenths = layout.fontSize === null ? 0 : Math.round(layout.fontSize * 10);
  const m = layout.margins;
  return [
    `\\def\\resumeFontTenths{${tenths}}`,
    `\\def\\resumeMarginTop{${inches(m.top)}}`,
    `\\def\\resumeMarginBottom{${inches(m.bottom)}}`,
    `\\def\\resumeMarginLeft{${inches(m.left)}}`,
    `\\def\\resumeMarginRight{${inches(m.right)}}`,
  ].join("");
}
