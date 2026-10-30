import Link from "next/link";
import { FOCUS_RING } from "@/ui/Button";
import { SignInLink } from "./SignInLink";

export function PublicHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className={`rounded-sm font-serif text-xl tracking-tight ${FOCUS_RING}`}>
          Resume<span className="text-accent">Tailor</span>
        </Link>
        <SignInLink />
      </div>
    </header>
  );
}
