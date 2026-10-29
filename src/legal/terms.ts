import { selfHostedNotice } from "./self-hosted";
import type { LegalContext, LegalDocument } from "./types";

export function termsOfService(context: LegalContext): LegalDocument {
  if (context.selfHosted) return selfHostedNotice("Terms", context);
  const { contactEmail, adsAvailable, sourceCodeUrl } = context;
  const contact = `[${contactEmail}](mailto:${contactEmail})`;
  // No promise of ad-earned credits while there are no ads to watch.
  const earning = adsAvailable
    ? "It is free: the AI features cost credits, which you earn by watching ads."
    : "It is free: the AI features cost credits. Credits are earned by watching ads when ads are enabled, and may be " +
      "granted by the operator.";
  return {
    title: "Terms",
    updated: "2026-10-29",
    intro:
      "The agreement between you and me, the operator of Resume Tailor, when you use this site. By creating an " +
      "account you accept these terms.",
    sections: [
      {
        heading: "The service",
        body: [
          "Resume Tailor keeps a bank of your resume content and tailors it to job descriptions with Claude, an AI " +
            `model made by Anthropic. ${earning}`,
          "It is provided as it is, with no promise that it is always available, free of errors or fit for any " +
            "particular purpose. Check every resume before you send it: the AI can make mistakes, and you are " +
            "responsible for what you send to employers.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You sign in with your email address or Google. Keep your email secure: anyone who can read it can sign " +
            "in as you. You can delete your account at any time on the [Account page](/account).",
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          [
            "Upload only your own resume data, or data you have the right to use.",
            "Do not try to get credits without genuinely watching ads, for example with scripts, several accounts " +
              "or tools that fake ad views.",
            "Do not attack, overload or probe the service, or work around its limits.",
            "Do not use it for anything unlawful, or anything that breaks " +
              "[Anthropic’s usage policy](https://www.anthropic.com/legal/aup).",
          ],
        ],
      },
      {
        heading: "Credits",
        body: [
          "Credits have no cash value. They cannot be bought, sold or transferred, and they end with your account. " +
            "I may change what things cost in credits, and the daily limits, at any time; the current costs are on " +
            "the [home page](/) or your [Account page](/account).",
        ],
      },
      {
        heading: "Suspension",
        body: [
          "I may suspend or delete an account that abuses the service or breaks these terms, and remove credits " +
            "obtained by abuse.",
        ],
      },
      {
        heading: "Changes to the service",
        body: [
          "The service may change, pause or stop at any time, for example if it becomes too expensive to run. If " +
            "it is going to close, I will try to give notice so you can download your data. If these terms change " +
            "in a way that matters, the date at the top changes; using the site afterwards means you accept them.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "Nothing in these terms limits liability that the law does not allow to be limited, such as for death or " +
            "personal injury caused by negligence, or for fraud.",
          "Otherwise, because the service is free, I am not liable for indirect or consequential loss (such as a " +
            "missed job opportunity) or for lost data, so keep your own copy with “Download my data”. My " +
            "total liability to you is limited to £50.",
        ],
      },
      {
        heading: "Open source",
        body: [
          "The code is open source under the GNU Affero General Public License v3.0 (AGPL-3.0), and " +
            `[its source code](${sourceCodeUrl}) is public. You can run your own copy under that licence; these ` +
            "terms cover only this site.",
        ],
      },
      {
        heading: "Law and contact",
        body: [
          "These terms are governed by the law of England and Wales, and its courts have jurisdiction. If you live " +
            "in Scotland or Northern Ireland, you can also bring a claim in your local courts.",
          `Questions about these terms: ${contact}.`,
        ],
      },
    ],
  };
}
