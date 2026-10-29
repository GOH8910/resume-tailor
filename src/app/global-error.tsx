"use client";

import "./globals.css";
import { buttonClass } from "@/ui/Button";
import { StatusCard } from "@/ui/StatusCard";

// Replaces the root layout when that fails. It renders per request in the failed layout's place, so its scripts carry
// the request's CSP nonce like any page's. It still keeps to plain HTML, a link and classes (no style="", which the
// policy blocks): a page whose root layout just failed should not depend on anything else working.
export default function GlobalError() {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <title>Something went wrong · Resume Tailor</title>
        <StatusCard title="Something went wrong" message="The site could not load this page. Go back to your dashboard.">
          {/* A plain <a>: a full page load, which does not rely on the client router. */}
          <a href="/dashboard" className={buttonClass({ variant: "primary" })}>
            Go to your dashboard
          </a>
        </StatusCard>
      </body>
    </html>
  );
}
