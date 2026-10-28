"use client";

import { notFound, useParams } from "next/navigation";
import { BANK_SECTIONS, BankEditor, type BankSection } from "@/ui/bank/BankEditor";

export default function BankSectionPage() {
  const { section } = useParams<{ section: string }>();
  if (!BANK_SECTIONS.includes(section as BankSection)) notFound();
  return <BankEditor section={section as BankSection} />;
}
