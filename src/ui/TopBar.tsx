"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "./api";
import { Button } from "./Button";
import { useProfile } from "./ProfileProvider";

const LINKS = [
  { href: "/", label: "Dashboard", isActive: (p: string) => p === "/" },
  { href: "/bank/experience", label: "Bank", isActive: (p: string) => p.startsWith("/bank") },
  { href: "/tailor", label: "Tailor", isActive: (p: string) => p.startsWith("/tailor") },
];

export function TopBar() {
  const pathname = usePathname();
  const { profile, profiles, setProfile, createProfile } = useProfile();
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      await createProfile(slug.trim(), "");
      setCreating(false);
      setSlug("");
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </Link>
        <nav aria-label="Main navigation" className="flex gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                link.isActive(pathname) ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {creating ? (
            <>
              <input
                autoFocus
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="slug, e.g. edward"
                aria-label="New profile slug"
                className="w-44 rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
              />
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!slug.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <label htmlFor="profile-select" className="text-xs uppercase tracking-wide text-ink-faint">
                Profile
              </label>
              <select
                id="profile-select"
                value={profile ?? ""}
                onChange={(e) => setProfile(e.target.value)}
                className="rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
              >
                {profiles.length === 0 && <option value="">none</option>}
                {profiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
                + New
              </Button>
            </>
          )}
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
