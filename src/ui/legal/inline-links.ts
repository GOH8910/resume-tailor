export type InlinePart = { text: string; href?: string };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
// A path on this site (not "//host"), an https URL or an email address: never javascript: or plain http.
const ALLOWED_HREF = /^(\/(?!\/)|https:\/\/|mailto:)/;

/** Splits text into plain runs and [text](href) links. Throws on a link to anything ALLOWED_HREF does not cover. */
export function splitLinks(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match;
    if (!ALLOWED_HREF.test(href)) throw new Error(`Refusing the link ${whole}: use a /path, https:// or mailto:`);
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: label, href });
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The text as a reader sees it: links reduced to their labels. */
export function plainText(text: string): string {
  return splitLinks(text)
    .map((part) => part.text)
    .join("");
}
