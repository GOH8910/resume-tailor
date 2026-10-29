import type { Metadata } from "next";
import { cookiePolicy } from "@/legal/cookies";
import { legalContext } from "@/legal/context";
import { LegalPage } from "@/ui/legal/LegalPage";

export const metadata: Metadata = { title: "Cookies · Resume Tailor" };

export default function CookiesPage() {
  return <LegalPage document={cookiePolicy(legalContext())} />;
}
