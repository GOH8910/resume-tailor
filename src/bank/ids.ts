/** Short random id, e.g. "b_3fa91c20". Uses Web Crypto so it works in the browser and Node. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
