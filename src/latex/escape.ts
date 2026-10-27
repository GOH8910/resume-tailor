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
};

/** Escape user text for inclusion in LaTeX. Single pass so inserted braces are never re-escaped. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (ch) => REPLACEMENTS[ch]);
}
