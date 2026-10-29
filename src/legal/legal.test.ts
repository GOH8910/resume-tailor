import { describe, expect, it } from "vitest";
import { plainText } from "@/ui/legal/inline-links";
import { cookiePolicy } from "./cookies";
import { privacyPolicy } from "./privacy";
import { termsOfService } from "./terms";
import type { LegalContext, LegalDocument } from "./types";

const SOURCE = "https://git.example.com/resume-tailor";
const CONTEXT: LegalContext = {
  contactEmail: "privacy@example.com",
  adsAvailable: false,
  googleAds: false,
  selfHosted: false,
  sourceCodeUrl: SOURCE,
};
const GOOGLE_ADS: LegalContext = { ...CONTEXT, adsAvailable: true, googleAds: true };
const DOCUMENTS = { Privacy: privacyPolicy, Terms: termsOfService, Cookies: cookiePolicy };
// The pages these texts may link to.
const PAGES = ["/", "/account", "/cookies", "/privacy", "/terms"];

/** Every text in the document, links reduced to their labels; plainText also throws on a link it would refuse. */
function texts(doc: LegalDocument): string[] {
  const blocks = doc.sections.flatMap((section) => [section.heading, ...section.body.flat()]);
  return [doc.title, doc.intro, ...blocks].map(plainText);
}

const textOf = (doc: LegalDocument) => texts(doc).join("\n");

function links(doc: LegalDocument): string[] {
  const raw = [doc.intro, ...doc.sections.flatMap((section) => section.body.flat())].join("\n");
  return [...raw.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

describe.each(Object.entries(DOCUMENTS))("the %s page", (title, build) => {
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

  it("is replaced by the self-hosted notice on a self-hosted server", () => {
    const notice = build({ ...CONTEXT, selfHosted: true });
    expect(notice.title).toBe(title);
    // Undated: the "not legal advice; last updated" line belongs to the hosted texts.
    expect(notice.updated).toBeNull();
    expect(notice.sections).toEqual([]);
    expect(plainText(notice.intro)).toBe(
      "This is a self-hosted copy of Resume Tailor. Whoever runs this server is responsible for your data and sets " +
        "their own terms; the hosted service’s terms and privacy notice do not apply here. The software is open " +
        "source under AGPL-3.0: source.",
    );
    expect(links(notice)).toEqual([SOURCE]);
  });
});

describe("privacyPolicy", () => {
  const text = textOf(privacyPolicy(CONTEXT));

  it.each(["Anthropic", "Neon", "Fly.io", "Resend", "Google Ad Manager"])("names %s", (name) => {
    expect(text).toContain(name);
  });

  it("introduces them as handling data for the site, and Google as its own controller", () => {
    expect(text).toContain("These companies handle data for the site:");
    expect(text).toMatch(/For sign-in and ads, Google is a controller in its own right/);
  });

  it("gives the configured contact address", () => {
    expect(links(privacyPolicy(CONTEXT))).toContain("mailto:privacy@example.com");
  });

  it("says whether ads are switched on", () => {
    expect(text).toContain("Ads are not switched on yet.");
    expect(textOf(privacyPolicy(GOOGLE_ADS))).toContain("Ads are switched on.");
  });

  it("lists what the export holds and leaves out", () => {
    expect(text).toMatch(/profile, plan and credits, sign-in methods, signed-in browsers, credit history, ads watched, AI usage, bank, and resumes/);
    expect(text).toContain("It leaves out the PDFs");
  });
});

describe("termsOfService", () => {
  it("promises ad-earned credits only while ads are switched on", () => {
    const off = textOf(termsOfService(CONTEXT));
    expect(off).toContain("Credits are earned by watching ads when ads are enabled, and may be granted by the operator.");
    expect(off).not.toContain("which you earn by watching ads");
    expect(textOf(termsOfService(GOOGLE_ADS))).toContain("which you earn by watching ads");
  });

  it("points to where the current costs are shown, and to the configured source code", () => {
    expect(links(termsOfService(CONTEXT))).toEqual(expect.arrayContaining(["/", "/account", SOURCE]));
  });
});

describe("cookiePolicy", () => {
  it("says no advertising cookies are set while ads are off", () => {
    expect(textOf(cookiePolicy(CONTEXT))).toContain("Ads are not switched on yet, so no advertising cookies are set.");
  });

  it("describes Google's cookies only when the ads come from Google", () => {
    expect(textOf(cookiePolicy(GOOGLE_ADS))).toContain("Ads are switched on.");
    // The test provider (development and the e2e tests) plays a fake ad in the page.
    const testAds = textOf(cookiePolicy({ ...CONTEXT, adsAvailable: true }));
    expect(testAds).toContain("The ads on this server come from a test provider, which sets no cookies.");
    expect(testAds).not.toContain("Ads are switched on.");
  });
});
