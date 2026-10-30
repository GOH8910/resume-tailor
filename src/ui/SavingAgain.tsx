/** "Saving again in N s" after a rate-limited autosave, announced once to screen readers rather than on every tick. */
export function SavingAgain({ secondsLeft }: { secondsLeft: number }) {
  return (
    <>
      <span className="sr-only">Too many saves; saving again in a few seconds.</span>
      <span aria-hidden="true">
        Saving again in <span className="tabular-nums">{secondsLeft}</span> s
      </span>
    </>
  );
}
