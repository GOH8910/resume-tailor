import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStorageKey, clearChatHistory, forgetChats } from "./chat-storage";

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

  describe("forgetChats", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("clears chats from both session and local storage", () => {
      const session = fakeStorage({ [chatStorageKey("a")]: "[]", "other:key": "keep" });
      const local = fakeStorage({ [chatStorageKey(undefined)]: "[]" });
      vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
      forgetChats();
      expect(session.length).toBe(1);
      expect(local.length).toBe(0);
    });

    it("still clears one storage when the browser blocks the other", () => {
      const local = fakeStorage({ [chatStorageKey("a")]: "[]" });
      vi.stubGlobal("window", {
        get sessionStorage(): Storage {
          throw new DOMException("blocked", "SecurityError");
        },
        localStorage: local,
      });
      expect(() => forgetChats()).not.toThrow();
      expect(local.length).toBe(0);
    });
  });
});
