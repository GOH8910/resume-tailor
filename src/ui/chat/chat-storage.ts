const PREFIX = "resume-tailor:chat:";

/** The sessionStorage key for one conversation: per application, or the bank's. */
export function chatStorageKey(applicationId: string | undefined): string {
  return `${PREFIX}${applicationId ?? "bank"}`;
}

/** Forgets every chat conversation in `storage` (on sign-out, so the next user of this tab cannot read them). */
export function clearChatHistory(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (key?.startsWith(PREFIX)) storage.removeItem(key);
  }
}
