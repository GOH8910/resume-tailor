"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";
import { Button, FOCUS_RING } from "./Button";
import { useProfile } from "./ProfileProvider";

const LINKS = [
  { href: "/", label: "Dashboard", isActive: (p: string) => p === "/" },
  { href: "/bank/experience", label: "Bank", isActive: (p: string) => p.startsWith("/bank") },
  { href: "/tailor", label: "Tailor", isActive: (p: string) => p.startsWith("/tailor") },
];

export function TopBar() {
  const pathname = usePathname();
  const { profile, profiles, loading, error: profilesError, setProfile, createProfile } = useProfile();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  // The "New profile" button only exists once the form has closed, so focus moves after that render.
  useEffect(() => {
    if (creating || !restoreFocus.current) return;
    restoreFocus.current = false;
    newButtonRef.current?.focus();
  }, [creating]);

  function closeForm() {
    setCreating(false);
    setSlug("");
    setError(null);
    restoreFocus.current = true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slug.trim() || pending) return;
    setPending(true);
    try {
      await createProfile(slug.trim(), "");
      closeForm();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
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
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {creating ? (
            <form onSubmit={(e) => void submit(e)} className="flex items-center gap-2">
              <input
                autoFocus
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeForm();
                }}
                placeholder="slug, e.g. edward"
                aria-label="New profile slug"
                autoCapitalize="off"
                spellCheck={false}
                pattern="[a-z0-9][a-z0-9\-]*"
                title="lowercase letters, digits and dashes"
                className="w-44 rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!slug.trim() || pending}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              {profilesError ? (
                <span role="alert" className="text-xs text-danger">
                  Profiles failed to load: {profilesError}
                </span>
              ) : (
                <>
                  <label htmlFor="profile-select" className="text-xs uppercase tracking-wide text-ink-faint">
                    Profile
                  </label>
                  <select
                    id="profile-select"
                    value={profile ?? ""}
                    disabled={loading}
                    onChange={(e) => setProfile(e.target.value)}
                    className="rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
                  >
                    {!loading && profiles.length === 0 && <option value="">none</option>}
                    {profiles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Button ref={newButtonRef} size="sm" variant="ghost" onClick={() => setCreating(true)}>
                New profile
              </Button>
            </>
          )}
          {error && (
            <span role="alert" className="basis-full text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
