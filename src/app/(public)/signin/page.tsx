import type { Metadata } from "next";
import { env } from "@/lib/env";
import { safeNextPath } from "@/ui/signin/next-path";
import { SignInForm } from "@/ui/signin/SignInForm";

export const metadata: Metadata = { title: "Sign in · Resume Tailor" };

type Props = { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> };

export default async function SignInPage({ searchParams }: Props) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-card p-8 shadow-card">
        <p className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </p>
        <h1 className="mt-6 text-3xl tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-soft">New here? Signing in creates your account.</p>
        <div className="mt-6">
          <SignInForm
            googleEnabled={Boolean(env.GOOGLE_CLIENT_ID)}
            next={safeNextPath(next)}
            error={typeof error === "string" ? error : undefined}
          />
        </div>
      </div>
    </main>
  );
}
