/** "Python, Go , ,TypeScript" -> ["Python", "Go", "TypeScript"] */
export function splitItems(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
