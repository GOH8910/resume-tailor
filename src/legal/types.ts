/**
 * The legal pages' text as data, rendered by src/ui/legal/LegalPage.tsx. A block is a paragraph, or a bulleted list
 * when it is an array. Text may hold links written as [text](href), to a path on this site, https or mailto.
 */
export type LegalBlock = string | string[];

export type LegalSection = { heading: string; body: LegalBlock[] };

export type LegalDocument = {
  title: string;
  /** The day the text last changed (YYYY-MM-DD); shown as "last updated". */
  updated: string;
  intro: string;
  sections: LegalSection[];
};

/** What the texts say differently from one deployment to another. */
export type LegalContext = {
  contactEmail: string;
  /** Google rewarded ads are switched on (AD_PROVIDER=google in hosted mode). */
  adsEnabled: boolean;
};
