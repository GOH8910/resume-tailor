import { describe, expect, it } from "vitest";
import { buildTex, CONTENT_MARKER, renderContent } from "./build";
import { exampleDocument } from "./fixture";
import { loadTemplate } from "./template";

describe("renderContent", () => {
  const tex = renderContent(exampleDocument);

  it("renders the header with escaped name and contact icons", () => {
    expect(tex).toContain("\\resumeName{Alex Example}");
    expect(tex).toContain("\\faEnvelope\\ \\href{mailto:alex@example.com}{alex@example.com}");
    expect(tex).toContain("\\faLinkedin\\ \\href{https://linkedin.com/in/alex-example}{LinkedIn}");
  });

  it("escapes special characters in text", () => {
    expect(tex).toContain("backend services \\& developer tools");
    expect(tex).toContain("\\textasciitilde{}90\\%");
    expect(tex).toContain("Systems \\& Infrastructure");
  });

  it("renders entries with dates and location on the right", () => {
    expect(tex).toContain("\\resumeEntry{\\textbf{Software Engineer Intern}, Acme Corp}{Jul 2024 -- Jan 2025 ~|~ London, UK}");
  });

  it("links a project title when a link is present", () => {
    expect(tex).toContain("\\resumeEntry{\\href{https://github.com/alex-example/trail-planner}{\\textbf{Trail Planner}}}{Jan 2024 -- Present}");
  });

  it("omits empty sections", () => {
    const tex2 = renderContent({ ...exampleDocument, projects: [], skills: [] });
    expect(tex2).not.toContain("\\section{Projects}");
    expect(tex2).not.toContain("\\section{Skills}");
  });

  it("skips untitled draft entries and blank bullets", () => {
    const tex3 = renderContent({
      ...exampleDocument,
      projects: [
        { title: "  ", start: "", end: "", bullets: ["ghost"] },
        { title: "Real", start: "", end: "", bullets: ["", "  ", "kept"] },
      ],
      skills: [...exampleDocument.skills, { id: "s_draft", name: "  ", items: ["phantom"] }],
    });
    expect(tex3).not.toContain("ghost");
    expect(tex3).not.toContain("phantom");
    expect(tex3).toContain("\\resumeEntry{\\textbf{Real}}{}");
    expect(tex3.match(/\\item\{\} /g)?.length).toBe(
      exampleDocument.education[0].bullets.length + exampleDocument.experience[0].bullets.length + 1 + exampleDocument.skills.length,
    );
  });

  it("uses \\item{} so bullets starting with [ keep their bullet glyph", () => {
    const tex4 = renderContent({ ...exampleDocument, projects: [{ title: "P", start: "", end: "", bullets: ["[WIP] tool"] }] });
    expect(tex4).toContain("\\item{} [WIP] tool");
  });

  it("drops a pasted bullet glyph at the start of a bullet", () => {
    const tex6 = renderContent({ ...exampleDocument, projects: [{ title: "P", start: "", end: "", bullets: ["• pasted", "- dashed", "plain"] }] });
    expect(tex6).toContain("\\item{} pasted");
    expect(tex6).toContain("\\item{} dashed");
    expect(tex6).toContain("\\item{} plain");
  });

  it("collapses blank lines in single-line fields", () => {
    const tex5 = renderContent({ ...exampleDocument, experience: [{ ...exampleDocument.experience[0], title: "Lead\n\nEngineer", org: " Acme \n Corp " }] });
    expect(tex5).toContain("\\resumeEntry{\\textbf{Lead Engineer}, Acme Corp}");
  });

  it("escapes % and # in URLs instead of deleting them", () => {
    const tex = renderContent({ ...exampleDocument, profile: { ...exampleDocument.profile, linkedin: "https://x.com/in/jos%C3%A9?x=1&y=2#frag" } });
    expect(tex).toContain("\\href{https://x.com/in/jos\\%C3\\%A9?x=1&y=2\\#frag}{LinkedIn}");
  });

  it("escapes ^ in URLs so TeX ^^xx notation cannot smuggle characters", () => {
    const tex = renderContent({ ...exampleDocument, profile: { ...exampleDocument.profile, website: "https://x.com/a^^5cb" } });
    expect(tex).toContain("\\href{https://x.com/a\\%5E\\%5E5cb}{Website}");
  });

  it("omits whitespace-only contact fields and links", () => {
    const tex = renderContent({
      ...exampleDocument,
      profile: { ...exampleDocument.profile, email: "  ", github: " ", website: "\t" },
      projects: [{ ...exampleDocument.projects[0], link: "  " }],
    });
    expect(tex).not.toContain("\\faEnvelope");
    expect(tex).not.toContain("\\faGithub");
    expect(tex).not.toContain("\\faGlobe");
    expect(tex).toContain("\\resumeEntry{\\textbf{Trail Planner}}");
  });

  it("drops skill categories whose items are all blank", () => {
    const tex = renderContent({ ...exampleDocument, skills: [{ id: "s", name: "Empty", items: ["", "  "] }, ...exampleDocument.skills] });
    expect(tex).not.toContain("Empty");
  });

  it("drops bullets that are only a glyph and strips a symbol-font bullet", () => {
    const tex = renderContent({ ...exampleDocument, projects: [{ title: "P", start: "", end: "", bullets: ["•", "\uF0B7 word", "-", "- real"] }] });
    expect(tex.match(/\\item\{\} /g)?.length).toBe(
      exampleDocument.education[0].bullets.length + exampleDocument.experience[0].bullets.length + 2 + exampleDocument.skills.length,
    );
    expect(tex).toContain("\\item{} word");
    expect(tex).toContain("\\item{} real");
  });

  it("matches the snapshot", () => {
    expect(tex).toMatchSnapshot();
  });
});

describe("buildTex", () => {
  it("fills the template marker", async () => {
    const template = await loadTemplate();
    const out = buildTex(exampleDocument, template);
    expect(out).not.toContain(CONTENT_MARKER);
    expect(out).toContain("\\begin{document}");
    expect(out).toContain("\\resumeName{Alex Example}");
  });
  it("throws when the marker is missing", () => {
    expect(() => buildTex(exampleDocument, "\\documentclass{article}")).toThrow(/marker/);
  });
  it("ignores a marker mentioned inside a comment and fills the marker line", () => {
    const template = "%% uses %%CONTENT%%\n\\begin{document}\n%%CONTENT%%\n\\end{document}\n";
    const out = buildTex(exampleDocument, template);
    expect(out).toContain("%% uses %%CONTENT%%\n\\begin{document}\n\\resumeName");
  });
  it("prepends the layout definitions on the template's first line", () => {
    const doc = { ...exampleDocument, layout: { fontSize: 10.5, margins: { top: 0.5, bottom: 0.6, left: 0.7, right: 0.8 } } };
    const out = buildTex(doc, "%% t\n%%CONTENT%%\n");
    expect(out.split("\n")[0]).toBe(
      "\\def\\resumeFontTenths{105}\\def\\resumeMarginTop{0.50in}\\def\\resumeMarginBottom{0.60in}\\def\\resumeMarginLeft{0.70in}\\def\\resumeMarginRight{0.80in}%% t",
    );
  });
  it("encodes an automatic font size as zero tenths", () => {
    const out = buildTex(exampleDocument, "%%CONTENT%%\n");
    expect(out.startsWith("\\def\\resumeFontTenths{0}")).toBe(true);
  });
});
