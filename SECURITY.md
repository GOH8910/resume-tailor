# Security policy

## Reporting a problem

Please report security problems privately, by either of these:

- a private security advisory on this repository: the "Security" tab, then "Report a vulnerability";
- an email to the hosted service's contact address, which is on its privacy page (`/privacy`).

Please don't open a public issue or pull request for a security problem until it is fixed. Include what you found,
how to reproduce it, and what an attacker could do with it.

## What to expect

- An acknowledgement within 7 days.
- A fix, or a plan with a date, within 30 days of the acknowledgement for anything that puts accounts or their data
  at risk.
- Credit in the fix's notes if you want it.

There is no bug bounty.

## In scope

- This repository's code and its Docker image.
- The hosted service run from it: sign-in and sessions, access to other accounts' data, the credits and ads ledger
  (earning or spending credits without watching ads or paying), the account export and deletion, the admin page, the
  LaTeX compile sandbox (reading files or environment from a compile), and the content security policy.

## Out of scope

- Self-hosted copies run by other people: report to whoever runs them.
- Denial of service by sheer volume, spam sign-ups and rate limits that are merely generous.
- Findings in third-party services the hosted service uses (Anthropic, Neon, Fly.io, Resend, Google), unless this
  code uses them unsafely.
- Missing best-practice headers or settings with no demonstrated impact.

Please test only against your own account and don't access other people's data. Act in good faith and we will too.
