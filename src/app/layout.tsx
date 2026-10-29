import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "Pick the right bullets for every job description.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Renders every page per request. Next puts the proxy's per-request CSP nonce on its scripts only while rendering,
  // so a page prerendered at build time would carry none and the browser would refuse to run it.
  await connection();
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
