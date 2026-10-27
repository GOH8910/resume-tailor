import type { Bank } from "@/bank/schema";
import { api, withProfile } from "@/ui/api";

// Saves run one at a time, in order, and loads wait for them, so a remounted editor
// (section tab, profile switch, leaving /bank and coming back) never reads a bank older than its last edit.
let queue: Promise<unknown> = Promise.resolve();

export function saveBank(profile: string, bank: Bank): Promise<void> {
  const run = queue.then(() => api.send<Bank>(withProfile("/api/bank", profile), "PUT", bank)).then(() => undefined);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadBank(profile: string): Promise<Bank> {
  await queue;
  return api.get<Bank>(withProfile("/api/bank", profile));
}

/** The page is going away; keepalive lets the request outlive it (64 KB body limit, a bank is a few KB). */
export function saveBankOnExit(profile: string, bank: Bank): void {
  void fetch(withProfile("/api/bank", profile), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bank),
    keepalive: true,
  }).catch(() => undefined);
}
