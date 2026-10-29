import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import { ChatDrawer } from "@/ui/chat/ChatDrawer";
import { ChatProvider } from "@/ui/chat/ChatProvider";
import { MeProvider } from "@/ui/MeProvider";
import { TopBar } from "@/ui/TopBar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  // disableRefresh: a server component cannot set the renewed cookie, so the TopBar's useSession() refreshes instead.
  const session = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  // Next does not expose the request path to a layout, so a stale session lands on /signin without ?next=.
  if (!session) redirect("/signin");
  return (
    <MeProvider>
      <ChatProvider>
        <TopBar user={{ email: session.user.email }} />
        <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        <ChatDrawer />
      </ChatProvider>
    </MeProvider>
  );
}
