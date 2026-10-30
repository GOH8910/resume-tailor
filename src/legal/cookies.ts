import { selfHostedNotice } from "./self-hosted";
import type { LegalContext, LegalDocument } from "./types";

/** Whether this server's ads set cookies: only Google's do. */
function adCookiesNow({ adsAvailable, googleAds }: LegalContext): string {
  if (googleAds) return "Ads are switched on.";
  if (adsAvailable) return "The ads on this server come from a test provider, which sets no cookies.";
  return "Ads are not switched on yet, so no advertising cookies are set.";
}

export function cookiePolicy(context: LegalContext): LegalDocument {
  if (context.selfHosted) return selfHostedNotice("Cookies", context);
  const { contactEmail } = context;
  return {
    title: "Cookies",
    updated: "2026-10-29",
    intro: "Cookies are small files a website keeps in your browser. These are the ones Resume Tailor uses.",
    sections: [
      {
        heading: "Strictly necessary",
        body: [
          "These keep you signed in. The site cannot work without them, so they do not need your consent:",
          [
            "the session cookie (better-auth.session_token, with a __Secure- prefix over https), set when you sign " +
              "in and removed when you sign out; it stops working after 7 days without use;",
            "short-lived cookies during a Google sign-in, which check that Google’s answer belongs to your sign-in.",
          ],
          "Your chats with Claude are kept in your browser’s session storage (not a cookie), for the current tab " +
            "only. They are cleared when you sign out or close the tab.",
        ],
      },
      {
        heading: "No analytics",
        body: ["There are no analytics or tracking cookies, and no third-party scripts while ads are switched off."],
      },
      {
        heading: "Advertising",
        body: [
          "When ads are switched on, Google Ad Manager shows the rewarded ads and may set cookies, or use similar " +
            "technology, to measure and personalise them. Before it does, visitors in the UK and EEA are asked for " +
            "consent through Google’s consent tool. Without consent, Google shows only non-personalised ads.",
          adCookiesNow(context),
          "Google explains its use of data in " +
            "[how Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites).",
        ],
      },
      {
        heading: "Changing your mind",
        body: [
          "You can change or withdraw your consent at any time through the privacy and cookie settings link that " +
            "Google’s consent tool shows while ads are on. You can also delete cookies in your browser’s " +
            "settings; deleting the session cookie signs you out.",
          `Questions: [${contactEmail}](mailto:${contactEmail}). More about your data on the [Privacy](/privacy) page.`,
        ],
      },
    ],
  };
}
