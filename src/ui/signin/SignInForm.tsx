"use client";

import { type FormEvent, useState } from "react";
import { authClient } from "@/ui/auth-client";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";

const MESSAGES = new Map([
  ["SIGNUP_INVITE_ONLY", "Sign-ups are invite-only right now."],
  ["TOO_MANY_MAGIC_LINKS", "Too many sign-in links requested. Try again in an hour."],
  ["INVALID_TOKEN", "That link has expired or was already used. Request a new one."],
]);

function messageFor(code: string | undefined): string {
  return (code && MESSAGES.get(code)) || "Sign-in failed. Try again.";
}

type AuthCall = () => Promise<{ error: { code?: string } | null }>;

type Props = { googleEnabled: boolean; next: string; error?: string };

export function SignInForm({ googleEnabled, next, error: errorCode }: Props) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"link" | "google" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(errorCode ? messageFor(errorCode) : null);

  /** Runs an auth client call; true when it succeeded. HTTP errors come back as `error`, network failures throw. */
  async function attempt(kind: "link" | "google", call: AuthCall): Promise<boolean> {
    setPending(kind);
    setError(null);
    try {
      const { error } = await call();
      if (error) setError(messageFor(error.code));
      return !error;
    } catch {
      setError(messageFor(undefined));
      return false;
    } finally {
      setPending(null);
    }
  }

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address || pending) return;
    const sent = await attempt("link", () => authClient.signIn.magicLink({ email: address, callbackURL: next, errorCallbackURL: "/signin" }));
    if (sent) setSentTo(address);
  }

  function signInWithGoogle() {
    // On success the auth client navigates to Google, so only a failure needs handling here.
    void attempt("google", () => authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/signin" }));
  }

  if (sentTo) {
    return (
      <Banner tone="ok" title="Check your email for a sign-in link (valid for 5 minutes)">
        Sent to {sentTo}.
      </Banner>
    );
  }

  return (
    <div className="grid gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={(e) => void sendLink(e)} className="grid gap-3">
        <Field label="Email">
          <TextInput
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending !== null || !email.trim()}>
          {pending === "link" ? "Sending…" : "Email me a link"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-faint">
            <span aria-hidden="true" className="h-px flex-1 bg-rule" />
            or
            <span aria-hidden="true" className="h-px flex-1 bg-rule" />
          </div>
          <Button onClick={signInWithGoogle} disabled={pending !== null}>
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}
