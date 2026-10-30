const STEPS = [
  { title: "Fill your bank", text: "Write down every role, project and bullet once. It only grows from there." },
  { title: "Paste a job description", text: "Claude picks the bullets that fit the job and lightly rewords them to match it." },
  { title: "Review and download", text: "Keep or undo each change, then download the one-page PDF." },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="border-y border-rule bg-paper-deep/60">
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <h2 id="how-heading" className="text-3xl tracking-tight">
          How it works
        </h2>
        <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t-2 border-ink pt-4">
              {/* The list already numbers the steps for screen readers. */}
              <p aria-hidden="true" className="font-serif text-5xl leading-none text-accent">
                {index + 1}
              </p>
              <h3 className="mt-4 text-xl tracking-tight">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
