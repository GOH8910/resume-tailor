import type { LegalContext, LegalDocument } from "./types";

/** What a self-hosted server shows on each legal page: the hosted service's texts are not its operator's to give. */
export function selfHostedNotice(title: string, { sourceCodeUrl }: LegalContext): LegalDocument {
  return {
    title,
    updated: null,
    intro:
      "This is a self-hosted copy of Resume Tailor. Whoever runs this server is responsible for your data and sets " +
      "their own terms; the hosted service’s terms and privacy notice do not apply here. The software is open " +
      `source under AGPL-3.0-only: [source](${sourceCodeUrl}).`,
    sections: [],
  };
}
