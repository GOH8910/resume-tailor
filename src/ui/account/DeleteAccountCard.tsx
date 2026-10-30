"use client";

import { type FormEvent, useId, useState } from "react";
import { api, errorMessage, setSigningOut } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { forgetChats } from "@/ui/chat/chat-storage";
import { Field, TextInput } from "@/ui/Field";

/** "Delete my account", confirmed by typing the account's email. */
export function DeleteAccountCard({ email }: { email: string }) {
  const headingId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase();

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    // Requests still in flight come back 401 once the account is gone; the page leaves on its own below.
    setSigningOut(true);
    try {
      await api.send("/api/account/delete", "POST", { email: typed });
      forgetChats();
      // A full load drops the router cache and every in-memory copy of this account's data. The landing page says
      // the account is gone.
      window.location.replace("/?deleted=1");
    } catch (err) {
      setSigningOut(false);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby={headingId}
      onSubmit={(event) => void deleteAccount(event)}
      className="rounded-lg border border-accent/30 bg-card p-5 shadow-card"
    >
      <h2 id={headingId} className="text-2xl tracking-tight text-accent-deep">
        Delete my account
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Deletes your sign-in, your bank, every tailored resume and its PDF, and any credits left, and signs you out
        everywhere. It cannot be undone, so download your data first if you want a copy. Credit and AI usage records are kept without your account, for the
        daily limits and the bills.
      </p>
      <div className="mt-4">
        <Field label="Type your email to confirm" hint={email}>
          <TextInput
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <div className="mt-3">
          <Banner tone="error" title="Could not delete your account">
            {error}
          </Banner>
        </div>
      )}
      <div className="mt-4">
        <Button type="submit" variant="danger" disabled={!confirmed || busy} className="border border-danger/40">
          {busy ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </form>
  );
}
