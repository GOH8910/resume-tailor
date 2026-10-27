const REPLACEMENTS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "≈": "\\ensuremath{\\approx}",
  "≤": "\\ensuremath{\\leq}",
  "≥": "\\ensuremath{\\geq}",
  "−": "\\textminus{}",
  "′": "\\ensuremath{\\prime}",
  "μ": "\\textmu{}",
  "µ": "\\textmu{}",
};

const SPECIAL = /[\\&%$#_{}~^<>≈≤≥−′μµ]/g;

/**
 * Escape user text for inclusion in LaTeX. Single pass so inserted braces are never re-escaped.
 * Also normalises to NFC, turns line-break characters and typographic spaces into plain spaces,
 * and strips control, zero-width, bidi and variation-selector characters, so pasted text cannot
 * break pdflatex. Angle brackets are escaped because T1 ligatures would otherwise turn "<<"
 * into guillemets.
 */
export function escapeLatex(text: string): string {
  const cleaned = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u000B\u000C\u0085\u2028\u2029]/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFE00-\uFE0F\uFEFF]/g, "")
    .replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  return cleaned.replace(SPECIAL, (ch) => REPLACEMENTS[ch]);
}
