import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import { ChatDrawer } from "@/ui/chat/ChatDrawer";
import { ChatProvider } from "@/ui/chat/ChatProvider";
import { TopBar } from "@/ui/TopBar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/signin");
  return (
    <ChatProvider>
      <TopBar user={{ email: session.user.email }} />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
      <ChatDrawer />
    </ChatProvider>
  );
}
