import { describe, expect, it } from "vitest";
import { chatStorageKey, clearChatHistory } from "./chat-storage";

/** A minimal in-memory Storage. */
function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("chat storage", () => {
  it("keys a conversation by application, or the bank", () => {
    expect(chatStorageKey("app-1")).toBe("resume-tailor:chat:app-1");
    expect(chatStorageKey(undefined)).toBe("resume-tailor:chat:bank");
  });

  it("clears every chat conversation and nothing else", () => {
    const storage = fakeStorage({
      [chatStorageKey("a")]: "[]",
      [chatStorageKey("b")]: "[]",
      [chatStorageKey(undefined)]: "[]",
      "other:key": "keep",
    });
    clearChatHistory(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem("other:key")).toBe("keep");
  });
});
