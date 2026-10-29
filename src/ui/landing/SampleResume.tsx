// A static import: Next serves it from /_next/static/media under a content hash, cached as immutable, and knows its size.
import sample from "./sample-resume.png";

/** The sample resume on a card, over a second sheet for depth. */
export function SampleResume() {
  return (
    <figure className="mx-auto w-full max-w-sm lg:max-w-none">
      <div className="relative">
        {/* Offset less than the page's 16 px gutter, and unrotated on phones, so it never widens the page. */}
        <div aria-hidden="true" className="absolute inset-0 translate-x-2 translate-y-2 rounded-lg border border-rule bg-paper-deep sm:rotate-2" />
        <div className="relative rounded-lg border border-rule bg-card p-3 shadow-card">
          {/* A plain <img>: next/image adds a style="" attribute, which the Content-Security-Policy blocks. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sample.src}
            width={sample.width}
            height={sample.height}
            alt="A one-page tailored resume produced by Resume Tailor"
            fetchPriority="high"
            decoding="async"
            className="h-auto w-full rounded-sm"
          />
        </div>
      </div>
      <figcaption className="mt-5 text-sm text-ink-faint">A sample, made from the example bank in the repository.</figcaption>
    </figure>
  );
}
