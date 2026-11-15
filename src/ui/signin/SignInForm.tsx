"use client";

import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "@/ui/auth-client";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { forgetChats } from "@/ui/chat/chat-storage";
import { Field, TextInput } from "@/ui/Field";

const MESSAGES = new Map([
  ["WRONG_PASSWORD", "Wrong password."],
  ["SIGNUP_INVITE_ONLY", "Sign-ups are invite-only right now."],
  ["INVALID_TOKEN", "That link has expired or was already used. Sign in again."],
]);

function messageFor(code: string | undefined): string {
  return (code && MESSAGES.get(code)) || "Sign-in failed. Try again.";
}

type AuthCall = () => Promise<{ error: { code?: string } | null }>;

type Props = { googleEnabled: boolean; next: string; error?: string };

export function SignInForm({ googleEnabled, next, error: errorCode }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(errorCode ? messageFor(errorCode) : null);
  // A failed Google sign-in comes back to this page with ?error=, still headed for `next`.
  const errorCallbackURL = `/signin?next=${encodeURIComponent(next)}`;

  // A session can expire without a sign-out, which would leave the last account's chats in this tab for the next one.
  useEffect(() => {
    forgetChats();
  }, []);

  /** Runs an auth client call; true when it succeeded. HTTP errors come back as `error`, network failures throw. */
  async function attempt(kind: "password" | "google", call: AuthCall): Promise<boolean> {
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

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address || !password || pending) return;
    const signedIn = await attempt("password", () =>
      authClient.$fetch("/sign-in/site-password", { method: "POST", body: { email: address, password } }),
    );
    // A full load, so the server renders the next page with the new session cookie.
    if (signedIn) window.location.assign(next);
  }

  function signInWithGoogle() {
    // On success the auth client navigates to Google, so only a failure needs handling here.
    void attempt("google", () => authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL }));
  }

  return (
    <div className="grid gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={(e) => void signInWithPassword(e)} className="grid gap-3">
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
        <Field label="Password">
          <TextInput
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending !== null || !email.trim() || !password}>
          {pending === "password" ? "Signing in…" : "Sign in"}
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
