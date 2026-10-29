import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { PublicFooter } from "@/ui/public/PublicFooter";
import { PublicHeader } from "@/ui/public/PublicHeader";

/** The pages anyone can see: landing, sign-in and the legal pages. Each page brings its own <main>. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      {children}
      <PublicFooter sourceCodeUrl={env.SOURCE_CODE_URL} />
    </div>
  );
}
