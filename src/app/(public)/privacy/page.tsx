import type { Metadata } from "next";
import { legalContext } from "@/legal/context";
import { privacyPolicy } from "@/legal/privacy";
import { LegalPage } from "@/ui/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy · Resume Tailor" };

export default function PrivacyPage() {
  return <LegalPage document={privacyPolicy(legalContext())} />;
}
