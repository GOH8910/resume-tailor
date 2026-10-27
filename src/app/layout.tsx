import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProfileProvider } from "@/ui/ProfileProvider";
import { TopBar } from "@/ui/TopBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "Pick the right bullets for every job description.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ProfileProvider>
          <TopBar />
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        </ProfileProvider>
      </body>
    </html>
  );
}
