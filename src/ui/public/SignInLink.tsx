"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass } from "@/ui/Button";

/** The public header's way in, left out on the sign-in page itself. */
export function SignInLink() {
  const pathname = usePathname();
  if (pathname.startsWith("/signin")) return null;
  return (
    <Link href="/signin" className={buttonClass({ variant: "secondary", size: "sm" })}>
      Sign in
    </Link>
  );
}
