import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { modelName } from "@/tailor/model";
import { Banner } from "@/ui/Banner";
import { heroFunding } from "@/ui/landing/copy";
import { CreditsExplainer, SelfHostedNote } from "@/ui/landing/Credits";
import { Hero } from "@/ui/landing/Hero";
import { HowItWorks } from "@/ui/landing/HowItWorks";
import { SignInCallout } from "@/ui/landing/SignInCallout";

export const metadata: Metadata = {
  // The brand first, not the layout's suffix.
  title: { absolute: "Resume Tailor · Tailor your resume to every job" },
  description: "Keep one bank of every bullet you have written; Claude picks the ones that fit each job. Free and open source.",
};

type Props = { searchParams: Promise<{ deleted?: string | string[] }> };

export default async function LandingPage({ searchParams }: Props) {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  // Same as the sign-in page: no refresh here, a server component cannot set the cookie.
  const session = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  if (session) redirect("/dashboard");
  // The account page comes here after deleting the account.
  const { deleted } = await searchParams;
  const selfHosted = env.appMode === "selfhost";
  const { adsAvailable } = env;
  return (
    <main className="flex-1">
      {deleted === "1" && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-6">
          <Banner tone="info">Your account has been deleted.</Banner>
        </div>
      )}
      <Hero funding={heroFunding({ selfHosted, adsAvailable })} sourceCodeUrl={env.SOURCE_CODE_URL} />
      <HowItWorks />
      {selfHosted ? (
        <SelfHostedNote />
      ) : (
        <CreditsExplainer
          creditsPerTailor={env.CREDITS_PER_TAILOR}
          creditsPerChatMessage={env.CREDITS_PER_CHAT_MESSAGE}
          model={modelName(env.FREE_MODEL)}
          adsAvailable={adsAvailable}
          signupGrantCredits={env.SIGNUP_GRANT_CREDITS}
        />
      )}
      <SignInCallout />
    </main>
  );
}
