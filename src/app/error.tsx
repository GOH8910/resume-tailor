"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/ui/Button";
import { StatusCard } from "@/ui/StatusCard";

// Shown in place of a page that failed to render. Replaces Next's default, whose inline styles the
// Content-Security-Policy blocks. retry() fetches and renders the page again (Next 16's successor to reset()).
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <StatusCard title="Something went wrong" message="This page could not be shown. Try again, or go back to your dashboard.">
      <Button variant="primary" onClick={() => retry()}>
        Try again
      </Button>
      <Link href="/" className={buttonClass({})}>
        Go to your dashboard
      </Link>
    </StatusCard>
  );
}
