import type { Bank } from "@/bank/schema";
import { api } from "@/ui/api";

// Saves run one at a time, in order, and loads wait for them, so a remounted editor
// (section tab, leaving /bank and coming back) never reads a bank older than its last edit.
let queue: Promise<unknown> = Promise.resolve();

export function saveBank(bank: Bank): Promise<void> {
  const run = queue.then(() => api.send<Bank>("/api/bank", "PUT", bank)).then(() => undefined);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadBank(): Promise<Bank> {
  await queue;
  return api.get<Bank>("/api/bank");
}

/** The page is going away; keepalive lets the request outlive it (64 KB body limit, a bank is a few KB). */
export function saveBankOnExit(bank: Bank): void {
  void fetch("/api/bank", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bank),
    keepalive: true,
  }).catch(() => undefined);
}
