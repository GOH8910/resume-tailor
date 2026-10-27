import type { Profile, SkillCategory } from "@/bank/schema";
import type { DocEntry, ResumeDocument } from "./document";
import { escapeLatex } from "./escape";

export const CONTENT_MARKER = "%%CONTENT%%";
/** The marker must occupy a whole line, so a mention inside a comment is never replaced. */
const MARKER_LINE = /^%%CONTENT%%$/m;

/** Bullets pasted from Word or the web often start with their own bullet glyph; drop one. */
function stripLeadingMarker(bullet: string): string {
  // A dash or asterisk only counts as a marker when followed by whitespace ("-20%" is content).
  return bullet.replace(/^(?:[•●▪∙·]\s*|[-*]\s+)/, "");
}

/** Single-line fields (titles, names, dates) must not contain blank lines: they break \textbf{}. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildTex(doc: ResumeDocument, template: string): string {
  if (!MARKER_LINE.test(template)) {
    throw new Error(`Template is missing the ${CONTENT_MARKER} marker on its own line`);
  }
  // Function replacer: a string replacement would interpret "$&" patterns in the content.
  return template.replace(MARKER_LINE, () => renderContent(doc));
}

export function renderContent(doc: ResumeDocument): string {
  const parts = [
    renderHeader(doc.profile),
    doc.summary.trim() ? escapeLatex(doc.summary.trim()) : "",
    renderSection("Education", doc.education),
    renderSection("Experience", doc.experience),
    renderSection("Projects", doc.projects),
    renderSkills(doc.skills),
  ];
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

/** URLs go inside \href{...}; strip the characters that would break the argument. */
function safeUrl(url: string): string {
  return url.replace(/[{}\\%#\s]/g, "");
}

function renderHeader(p: Profile): string {
  const items: string[] = [];
  if (p.email) items.push(`\\faEnvelope\\ \\href{mailto:${safeUrl(p.email)}}{${escapeLatex(oneLine(p.email))}}`);
  if (p.phone) items.push(`\\faPhone\\ ${escapeLatex(oneLine(p.phone))}`);
  if (p.linkedin) items.push(`\\faLinkedin\\ \\href{${safeUrl(p.linkedin)}}{LinkedIn}`);
  if (p.github) items.push(`\\faGithub\\ \\href{${safeUrl(p.github)}}{GitHub}`);
  if (p.website) items.push(`\\faGlobe\\ \\href{${safeUrl(p.website)}}{Website}`);
  const contact = items.length ? `\\resumeContact{${items.join(" \\quad ")}}` : "";
  return [`\\resumeName{${escapeLatex(oneLine(p.name))}}`, contact].filter(Boolean).join("\n");
}

function renderDates(e: DocEntry): string {
  const start = oneLine(e.start);
  const end = oneLine(e.end);
  if (start && end) return `${escapeLatex(start)} -- ${escapeLatex(end)}`;
  return escapeLatex(start || end);
}

function renderEntry(e: DocEntry): string {
  const boldTitle = `\\textbf{${escapeLatex(oneLine(e.title))}}`;
  const title = e.link ? `\\href{${safeUrl(e.link)}}{${boldTitle}}` : boldTitle;
  const left = e.org?.trim() ? `${title}, ${escapeLatex(oneLine(e.org))}` : title;
  const right = [renderDates(e), e.location?.trim() ? escapeLatex(oneLine(e.location)) : ""].filter(Boolean).join(" ~|~ ");
  const bullets = e.bullets.map((b) => b.trim()).filter(Boolean);
  const lines = [`\\resumeEntry{${left}}{${right}}`];
  if (bullets.length > 0) {
    lines.push("\\begin{itemize}");
    // \item{} so a bullet starting with "[" is not read as an optional argument.
    for (const bullet of bullets) lines.push(`  \\item{} ${escapeLatex(stripLeadingMarker(bullet))}`);
    lines.push("\\end{itemize}");
  }
  return lines.join("\n");
}

function renderSection(title: string, entries: DocEntry[]): string {
  const real = entries.filter((e) => e.title.trim());
  if (real.length === 0) return "";
  return [`\\section{${title}}`, ...real.map(renderEntry)].join("\n");
}

function renderSkills(skills: SkillCategory[]): string {
  const categories = skills.filter((c) => c.name.trim() && c.items.length > 0);
  if (categories.length === 0) return "";
  const lines = ["\\section{Skills}", "\\begin{itemize}"];
  for (const c of categories) {
    const items = c.items.map((i) => escapeLatex(oneLine(i))).filter(Boolean);
    lines.push(`  \\item{} \\textbf{${escapeLatex(oneLine(c.name))}:} ${items.join(", ")}`);
  }
  lines.push("\\end{itemize}");
  return lines.join("\n");
}
