import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/http";
import { AdminPage } from "@/ui/admin/AdminPage";

export const metadata: Metadata = { title: "Admin · Resume Tailor" };

export default async function Admin() {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  // A 404 rather than a 403, as the admin API answers: the page is not advertised to other accounts.
  if (!session || !isAdminEmail(session.user.email)) notFound();
  return <AdminPage />;
}
