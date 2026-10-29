import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { FOCUS_RING } from "@/ui/Button";
import { safeNextPath } from "@/ui/signin/next-path";
import { SignInForm } from "@/ui/signin/SignInForm";

export const metadata: Metadata = { title: "Sign in · Resume Tailor" };

const LINK_CLASS = `rounded-sm underline underline-offset-2 hover:text-ink ${FOCUS_RING}`;

type Props = { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> };

export default async function SignInPage({ searchParams }: Props) {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  const { next, error } = await searchParams;
  const target = safeNextPath(next);
  // Same as the (app) layout: no refresh here, a server component cannot set the cookie.
  const session = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  if (session) redirect(target);
  return (
    // The public layout's header carries the wordmark and its footer the legal links.
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-card p-8 shadow-card">
        <h1 className="text-3xl tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-soft">New here? Signing in creates your account.</p>
        <div className="mt-6">
          <SignInForm googleEnabled={Boolean(env.GOOGLE_CLIENT_ID)} next={target} error={typeof error === "string" ? error : undefined} />
        </div>
        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          By signing in you accept the{" "}
          <Link href="/terms" className={LINK_CLASS}>
            terms
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className={LINK_CLASS}>
            privacy notice
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
