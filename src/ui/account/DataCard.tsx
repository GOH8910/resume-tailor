"use client";

import { useState } from "react";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";

const EXPORT_FILENAME = "resume-tailor-export.json";

/** Saves a downloaded file under `filename`, the way a link with a download attribute would. */
function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The click only starts the download; give the browser a moment to take the file before letting go of it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** "Download my data": fetched rather than linked, so a refusal (a rate limit, say) shows here instead of saving as a file. */
export function DataCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      saveFile(await api.blob("/api/account/export"), EXPORT_FILENAME);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="data-heading" className="rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id="data-heading" className="text-2xl tracking-tight">
        Your data
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        One JSON file with your bank, every tailored resume and its job description, and your credit history. PDFs are
        left out: they compile again from the file&apos;s contents.
      </p>
      {error && (
        <div className="mt-3">
          <Banner tone="error" title="Could not download your data">
            {error}
          </Banner>
        </div>
      )}
      <div className="mt-4">
        <Button variant="secondary" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing…" : "Download my data"}
        </Button>
      </div>
    </section>
  );
}
