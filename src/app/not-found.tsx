import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/ui/Button";
import { StatusCard } from "@/ui/StatusCard";

export const metadata: Metadata = { title: "Not found · Resume Tailor" };

// Replaces Next's default page, whose inline style="" attributes and <style> element the Content-Security-Policy blocks.
export default function NotFound() {
  return (
    <StatusCard title="Page not found" message="There is nothing at this address.">
      <Link href="/dashboard" className={buttonClass({ variant: "primary" })}>
        Go to your dashboard
      </Link>
    </StatusCard>
  );
}
