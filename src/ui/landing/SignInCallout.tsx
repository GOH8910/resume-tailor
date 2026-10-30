import Link from "next/link";
import { buttonClass } from "@/ui/Button";

export function SignInCallout() {
  return (
    <section aria-labelledby="start-heading" className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-4 py-16 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="start-heading" className="text-3xl tracking-tight">
            Start with your bank
          </h2>
          <p className="mt-2 text-ink-soft">Signing in with your email creates your account. There is nothing to install.</p>
        </div>
        <Link href="/signin" className={buttonClass({ variant: "primary" })}>
          Sign in or create an account
        </Link>
      </div>
    </section>
  );
}
