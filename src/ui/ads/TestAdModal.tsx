"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createTestAdTimer, testAdSeconds } from "@/ads/provider";
import { Button } from "@/ui/Button";

type Props = {
  minWatchSeconds: number;
  /** The ad played to the end. */
  onFinished: () => void;
  /** Closed before the end: no reward. */
  onDismiss: () => void;
};

/**
 * Stands in for a rewarded video ad in development and e2e runs: a modal dialog that "plays" for a few seconds.
 * A modal <dialog> makes the page behind it inert; Tab is held on its one control, and focus returns to the opener.
 */
export function TestAdModal({ minWatchSeconds, onFinished, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [fraction, setFraction] = useState(0);
  const totalSeconds = testAdSeconds(minWatchSeconds);
  const secondsLeft = Math.ceil(totalSeconds * (1 - fraction));

  // A layout effect, so the cleanup runs while the dialog is still in the document and can hand focus back.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => createTestAdTimer(minWatchSeconds, onFinished, setFraction), [minWatchSeconds, onFinished]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // Escape: treat it like the Close button rather than letting the browser close the dialog under React.
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      // The browser would let Tab leave a modal dialog for its own toolbar; keep it on Close, the only control.
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        closeButton.current?.focus();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-rule bg-card p-0 text-ink shadow-card backdrop:bg-ink/50"
    >
      <div className="grid gap-5 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Sponsored · test provider</p>
          <h2 id={titleId} className="mt-1 font-serif text-2xl tracking-tight">
            Test ad
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            A stand-in for a rewarded video ad. Let it play to the end to earn 1 credit.
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Ad progress"
          aria-valuemin={0}
          aria-valuemax={totalSeconds}
          aria-valuenow={totalSeconds - secondsLeft}
          aria-valuetext={secondsLeft > 0 ? `${secondsLeft} seconds left` : "Finished"}
          className="h-1.5 overflow-hidden rounded-full bg-paper-deep"
        >
          <div
            className="h-full origin-left bg-accent transition-transform duration-100 ease-linear"
            style={{ transform: `scaleX(${fraction})` }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p aria-hidden="true" className="text-sm tabular-nums text-ink-soft">
            {secondsLeft > 0 ? `Reward in ${secondsLeft} s` : "Reward earned"}
          </p>
          <Button ref={closeButton} size="sm" variant="ghost" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
