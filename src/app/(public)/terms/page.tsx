import type { Metadata } from "next";
import { legalContext } from "@/legal/context";
import { termsOfService } from "@/legal/terms";
import { LegalPage } from "@/ui/legal/LegalPage";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return <LegalPage document={termsOfService(legalContext())} />;
}
