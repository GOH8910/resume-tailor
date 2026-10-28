import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeState } from "@/applications/schema";
import { ApiError, compilePdf, errorMessage } from "@/ui/api";
import { createLatestRunner } from "./latest-runner";

export type Preview = { url: string; pages: number };
export type Problem = { message: string; log?: string };

type Compile = (state: ResumeState) => void;

/**
 * Owns the PDF preview for one application. `compile` can be called as often as edits land: compiles
 * run one at a time and a burst collapses into the latest state. The previous preview stays on screen
 * until the new one is ready, and a failed compile keeps it while showing the LaTeX error.
 */
export function usePdfCompiler(profile: string, applicationId: string) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Created per mount so a result arriving after unmount (or Strict Mode's simulated remount) is dropped.
  const runner = useRef<Compile | null>(null);

  useEffect(() => {
    let active = true;
    let previewUrl: string | null = null;
    runner.current = createLatestRunner<ResumeState>(async (state) => {
      setCompiling(true);
      try {
        const { blob, pages } = await compilePdf(profile, state, applicationId);
        if (!active) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        setPreview({ url: previewUrl, pages });
        setProblem(null);
      } catch (err) {
        if (!active) return;
        const log = err instanceof ApiError && typeof err.details === "string" ? err.details : undefined;
        setProblem({ message: errorMessage(err), log });
      } finally {
        if (active) setCompiling(false);
      }
    });
    return () => {
      active = false;
      runner.current = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [profile, applicationId]);

  const compile = useCallback<Compile>((state) => runner.current?.(state), []);

  return { preview, compiling, problem, compile };
}
