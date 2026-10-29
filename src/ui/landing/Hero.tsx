import Link from "next/link";
import { buttonClass } from "@/ui/Button";
import { SampleResume } from "./SampleResume";

/** `funding` ends the paragraph: what pays for the AI on this server (src/ui/landing/copy.ts). */
export function Hero({ funding, sourceCodeUrl }: { funding: string; sourceCodeUrl: string }) {
  return (
    <section
      aria-labelledby="landing-heading"
      className="mx-auto grid w-full max-w-5xl gap-14 px-4 pb-16 pt-12 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:items-center lg:gap-20"
    >
      <div>
        <h1 id="landing-heading" className="text-4xl leading-[1.08] tracking-tight sm:text-6xl">
          Job hunting is hard. <span className="text-accent">Tailor your resume to every job in minutes.</span>
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-soft">
          I built this for myself while applying. You keep one bank of every bullet you’ve ever written; paste a job
          description and Claude picks the ones that fit and lightly rewords them; you review every change and download
          a one-page PDF. {funding}
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/signin" className={buttonClass({ variant: "primary" })}>
            Sign in to start
          </Link>
          <a href={sourceCodeUrl} className={buttonClass({ variant: "ghost" })}>
            Run it yourself
          </a>
        </div>
      </div>
      <SampleResume />
    </section>
  );
}
