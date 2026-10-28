import type { Application, ResumeState } from "@/applications/schema";
import { api } from "@/ui/api";

// Saves run one at a time, in order, and loads wait for them, so a remounted review screen
// (leaving for the dashboard and coming back) never reads a resume older than its last edit.
let queue: Promise<unknown> = Promise.resolve();

type ApplicationResponse = { application: Application };

function url(id: string): string {
  return `/api/applications/${id}`;
}

export function saveApplication(id: string, resume: ResumeState): Promise<Application> {
  const run = queue.then(() => api.send<ApplicationResponse>(url(id), "PUT", { resume })).then((res) => res.application);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadApplication(id: string): Promise<Application> {
  await queue;
  return (await api.get<ApplicationResponse>(url(id))).application;
}

/** The page is going away; keepalive lets the request outlive it (64 KB body limit, a resume is a few KB). */
export function saveApplicationOnExit(id: string, resume: ResumeState): void {
  void fetch(url(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume }),
    keepalive: true,
  }).catch(() => undefined);
}
