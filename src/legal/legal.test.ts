import { describe, expect, it } from "vitest";
import { plainText } from "@/ui/legal/inline-links";
import { cookiePolicy } from "./cookies";
import { privacyPolicy } from "./privacy";
import { termsOfService } from "./terms";
import type { LegalContext, LegalDocument } from "./types";

const CONTEXT: LegalContext = { contactEmail: "privacy@example.com", adsEnabled: false };
const DOCUMENTS = { privacy: privacyPolicy, terms: termsOfService, cookies: cookiePolicy };
// The pages these texts may link to.
const PAGES = ["/", "/account", "/cookies", "/privacy", "/terms"];

/** Every text in the document, links reduced to their labels; plainText also throws on a link it would refuse. */
function texts(doc: LegalDocument): string[] {
  const blocks = doc.sections.flatMap((section) => [section.heading, ...section.body.flat()]);
  return [doc.title, doc.intro, ...blocks].map(plainText);
}

function links(doc: LegalDocument): string[] {
  const raw = [doc.intro, ...doc.sections.flatMap((section) => section.body.flat())].join("\n");
  return [...raw.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

describe.each(Object.entries(DOCUMENTS))("the %s page", (_name, build) => {
  const doc = build(CONTEXT);

  it("stays under about 900 words", () => {
    const words = texts(doc).join(" ").split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(900);
  });

  it("is dated with a real day", () => {
    expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${doc.updated}T00:00:00Z`).toISOString().slice(0, 10)).toBe(doc.updated);
  });

  it("links only to pages that exist, https sites and email", () => {
    for (const href of links(doc)) {
      if (href.startsWith("/")) expect(PAGES).toContain(href);
      else expect(href).toMatch(/^(https:\/\/|mailto:)/);
    }
  });
});

describe("privacyPolicy", () => {
  const text = texts(privacyPolicy(CONTEXT)).join("\n");

  it.each(["Anthropic", "Neon", "Fly.io", "Resend", "Google Ad Manager"])("names the processor %s", (name) => {
    expect(text).toContain(name);
  });

  it("gives the configured contact address", () => {
    expect(links(privacyPolicy(CONTEXT))).toContain("mailto:privacy@example.com");
  });

  it("says whether ads are switched on", () => {
    expect(text).toContain("Ads are not switched on yet.");
    expect(texts(privacyPolicy({ ...CONTEXT, adsEnabled: true })).join("\n")).toContain("Ads are switched on.");
  });

  it("lists what the export holds and leaves out", () => {
    expect(text).toMatch(/profile, plan and credits, sign-in methods, signed-in browsers, credit history, ads watched, AI usage, bank, and resumes/);
    expect(text).toContain("It leaves out the PDFs");
  });
});

describe("termsOfService", () => {
  it("promises ad-earned credits only while ads are switched on", () => {
    const off = texts(termsOfService(CONTEXT)).join("\n");
    expect(off).toContain("Credits are earned by watching ads when ads are enabled, and may be granted by the operator.");
    expect(off).not.toContain("which you earn by watching ads");
    expect(texts(termsOfService({ ...CONTEXT, adsEnabled: true })).join("\n")).toContain("which you earn by watching ads");
  });

  it("points to where the current costs are shown", () => {
    expect(links(termsOfService(CONTEXT))).toEqual(expect.arrayContaining(["/", "/account"]));
  });
});

describe("cookiePolicy", () => {
  it("says no advertising cookies are set while ads are off", () => {
    expect(texts(cookiePolicy(CONTEXT)).join("\n")).toContain("no advertising cookies are set");
    expect(texts(cookiePolicy({ ...CONTEXT, adsEnabled: true })).join("\n")).toContain("Ads are switched on.");
  });
});
