import type { LegalContext, LegalDocument } from "./types";

// Keep this in step with the code: the export's fields (src/account/export.ts), what deletion removes and keeps
// (src/account/delete.ts), the ad IP retention (AD_IP_RETENTION_MS in src/credits/service.ts) and the processors.
export function privacyPolicy({ contactEmail, adsEnabled }: LegalContext): LegalDocument {
  const contact = `[${contactEmail}](mailto:${contactEmail})`;
  return {
    title: "Privacy",
    updated: "2026-10-29",
    intro:
      "What Resume Tailor stores about you, who else handles it, how long it is kept and what you can do about it. " +
      "I have tried to describe exactly what the code does.",
    sections: [
      {
        heading: "Who runs this site",
        body: [
          "Resume Tailor is run by one person, its operator (“I” on these pages), who decides how your data is " +
            "used: the controller under UK data protection law (the UK GDPR and the Data Protection Act 2018).",
          `Write to ${contact} about anything on this page.`,
        ],
      },
      {
        heading: "What I store",
        body: [
          "When you use the site, it stores:",
          [
            "your email address and, if you sign in with Google, the name and picture Google shares and the tokens " +
              "Google issues for the sign-in (never your Google password);",
            "your bank: the entries and bullet points you write;",
            "your tailored resumes, each with the job description you pasted, your edits and its PDF;",
            "your plan, your credit balance and a ledger of every credit earned or spent;",
            "the ads you watch: when each started, whether it earned a credit, and your IP address (for IPv6, only " +
              "its first half), which is erased after about two days;",
            "AI usage records: for each request to Claude, the model, the number of tokens and what it cost;",
            "sessions: for each browser you sign in on, its IP address and browser name, until that browser signs " +
              "out or you delete your account (a session stops working after 7 days without use).",
          ],
          "Chats with Claude are not stored on the server. They live only in your browser tab and are cleared when " +
            "you sign out, delete your account or close the tab.",
          "To limit abuse, the server also keeps short-lived counters per account, email address and IP address in " +
            "memory; a restart clears them. Its error logs can include an account id or an IP address, and " +
            "occasionally part of a request that failed. I do not log your bank, resumes or job descriptions on purpose.",
        ],
      },
      {
        heading: "Why, and on what basis",
        body: [
          [
            "To provide the service you signed up for (contract): your account, bank, resumes and credits, and the " +
              "AI requests you make.",
            "To prevent abuse and keep costs bounded (legitimate interests): the ad and IP limits, the usage " +
              "records and the logs.",
            "To set advertising cookies and personalise ads (consent), only when ads are switched on and you agree. " +
              "See [Cookies](/cookies).",
          ],
          "I do not sell your data, and I do not use it to train AI models.",
        ],
      },
      {
        heading: "Who else handles it",
        body: [
          "These companies process data on my behalf:",
          [
            "[Anthropic](https://www.anthropic.com) runs Claude. It receives your bank, job descriptions and chat " +
              "messages when you tailor or chat. Anthropic does not train its models on this data, and " +
              "[deletes API inputs and outputs within 30 days](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) " +
              "unless a request is flagged under its usage policy.",
            "[Neon](https://neon.com) hosts the database, in London.",
            "[Fly.io](https://fly.io) hosts the app, in London, and keeps its logs.",
            "[Resend](https://resend.com) sends the sign-in emails, so it sees your email address.",
            "Google, if you sign in with Google. When ads are switched on, Google Ad Manager also serves the ads, " +
              "after asking for your consent through Google’s consent tool. " +
              (adsEnabled ? "Ads are switched on." : "Ads are not switched on yet."),
          ],
          "Anthropic, Resend and Google may process data in the United States. Those transfers rely on the " +
            "safeguards UK law provides, such as the UK–US data bridge or the UK addendum to the standard " +
            "contractual clauses.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You can download and delete your data yourself on the [Account page](/account).",
          "“Download my data” gives you a JSON file with your profile, plan and credits, sign-in methods, " +
            "signed-in browsers, credit history, ads watched, AI usage, bank, and resumes with their job " +
            "descriptions. It leaves out the PDFs (they compile again from the file) and every sign-in token.",
          "“Delete my account” is immediate and permanent for your sign-in methods, sessions, bank, resumes " +
            "and PDFs, plan and credits. These records are kept without any link to your account, for the abuse " +
            "limits and cost accounting:",
          [
            "the credit ledger, without the references to your resumes;",
            "the ads you watched, for the daily per-IP limit (their IP addresses are erased at once, except today’s " +
              "rewarded views, which go within about two days);",
            "the AI usage records.",
          ],
          "Deleted data can remain in the database’s restore history for up to 7 days, and in Fly.io’s logs " +
            "for their retention period, before it rolls over. Signing up again with the same email creates a new, " +
            "empty account. If you signed in with Google, you can also remove Resume Tailor from your Google " +
            "account’s [third-party connections](https://myaccount.google.com/connections).",
          `You also have the right to access, correct or restrict your data and to object to how it is used. Email ` +
            `${contact} and I will answer within one month.`,
          "If you are unhappy with how I handle your data, you can complain to the " +
            "[Information Commissioner’s Office](https://ico.org.uk/make-a-complaint/).",
        ],
      },
      {
        heading: "Changes",
        body: ["When this page changes, the date at the top changes too."],
      },
    ],
  };
}
