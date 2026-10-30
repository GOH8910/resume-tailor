// Plain types only: the schema imports these, and must not pull in the services.

/** Why a ledger row moved credits: earned (`ad`, `signup`, `admin`), spent (`tailor`, `chat`) or given back (`refund`). */
export const CREDIT_KINDS = ["ad", "signup", "tailor", "chat", "admin", "refund"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

/** Credits one completed rewarded ad grants; the landing page quotes it. */
export const CREDITS_PER_AD = 1;

export const AD_SESSION_STATUSES = ["started", "granted", "rejected"] as const;
export type AdSessionStatus = (typeof AD_SESSION_STATUSES)[number];
