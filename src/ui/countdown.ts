"use client";

import { useCallback, useEffect, useState } from "react";

/** Whole seconds left until `deadline` (ms since the epoch), rounded up and never below 0. */
export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * A countdown in whole seconds, for "try again in N s". It measures against a deadline rather than counting ticks,
 * because background tabs throttle timers.
 */
export function useCountdown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => {
      const left = secondsUntil(deadline, Date.now());
      setSecondsLeft(left);
      if (left === 0) setDeadline(null);
    }, 250);
    return () => clearInterval(id);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    setDeadline(Date.now() + seconds * 1000);
    setSecondsLeft(seconds);
  }, []);

  return { secondsLeft, start };
}
