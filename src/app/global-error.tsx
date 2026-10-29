"use client";

import "./globals.css";
import { buttonClass } from "@/ui/Button";
import { StatusCard } from "@/ui/StatusCard";

// Replaces the root layout when that fails. Next prerenders this page at build time, so its scripts carry no CSP nonce
// and never run: it has to work as plain HTML, with a link rather than a retry button, and classes rather than styles.
export default function GlobalError() {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <title>Something went wrong · Resume Tailor</title>
        <StatusCard title="Something went wrong" message="The site could not load this page. Go back to your dashboard.">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- no script runs here, so a plain link it is */}
          <a href="/" className={buttonClass({ variant: "primary" })}>
            Go to your dashboard
          </a>
        </StatusCard>
      </body>
    </html>
  );
}
