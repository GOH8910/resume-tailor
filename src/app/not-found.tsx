import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/ui/Button";

export const metadata: Metadata = { title: "Not found · Resume Tailor" };

// Replaces Next's default page, whose inline style="" attributes and <style> element the Content-Security-Policy blocks.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-card p-8 shadow-card">
        <p className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </p>
        <h1 className="mt-6 text-3xl tracking-tight">Page not found</h1>
        <p className="mt-1 text-sm text-ink-soft">There is nothing at this address.</p>
        <Link href="/" className={buttonClass({ variant: "primary", className: "mt-6" })}>
          Go to your dashboard
        </Link>
      </div>
    </main>
  );
}
