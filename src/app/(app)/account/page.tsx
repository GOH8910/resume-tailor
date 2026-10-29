import type { Metadata } from "next";
import { AccountPage } from "@/ui/account/AccountPage";

export const metadata: Metadata = { title: "Account · Resume Tailor" };

export default function Account() {
  return <AccountPage />;
}
