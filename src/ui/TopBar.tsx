"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "./api";
import { authClient } from "./auth-client";
import { Button, FOCUS_RING } from "./Button";
import { forgetChats } from "./chat/chat-storage";
import { useChatContext } from "./chat/ChatProvider";

const LINKS = [
  { href: "/", label: "Dashboard", isActive: (p: string) => p === "/" },
  { href: "/bank/experience", label: "Bank", isActive: (p: string) => p.startsWith("/bank") },
  { href: "/tailor", label: "Tailor", isActive: (p: string) => p.startsWith("/tailor") },
];

export function TopBar({ user }: { user: { email: string } }) {
  const pathname = usePathname();
  const { handlers } = useChatContext();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // The value is unused. The (app) layout reads the session without refreshing it (a server component cannot set
  // cookies), so this client call to the get-session route is what renews the session and its cookie.
  authClient.useSession();

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await handlers?.flush?.(); // an autosave still waiting on its timer
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "the server refused");
      forgetChats();
      // A full load drops the router cache and every in-memory copy of this user's data.
      window.location.replace("/signin");
    } catch (err) {
      setSignOutError(`Could not sign out: ${errorMessage(err)}`);
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </Link>
        <nav aria-label="Main navigation" className="flex gap-1">
          {LINKS.map((link) => {
            const active = link.isActive(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${FOCUS_RING} ${
                  active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <span title={user.email} className="max-w-[14rem] truncate text-sm text-ink-soft">
            {user.email}
          </span>
          <Button size="sm" variant="ghost" disabled={signingOut} onClick={() => void signOut()}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
          {signOutError && (
            <span role="alert" className="basis-full text-right text-xs text-danger">
              {signOutError}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
