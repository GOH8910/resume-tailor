"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "./auth-client";
import { Button, FOCUS_RING } from "./Button";

const LINKS = [
  { href: "/", label: "Dashboard", isActive: (p: string) => p === "/" },
  { href: "/bank/experience", label: "Bank", isActive: (p: string) => p.startsWith("/bank") },
  { href: "/tailor", label: "Tailor", isActive: (p: string) => p.startsWith("/tailor") },
];

export function TopBar({ user }: { user: { email: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  // The value is unused: subscribing keeps the session cookie refreshed while the user is active, which the
  // server-side getSession cannot do (it extends the database row but cannot rewrite the cookie).
  authClient.useSession();

  async function signOut() {
    await authClient.signOut();
    router.push("/signin");
    router.refresh();
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
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span title={user.email} className="max-w-[14rem] truncate text-sm text-ink-soft">
            {user.email}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
