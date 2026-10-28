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

    it("clears this tab's chats from sessionStorage", () => {
      const session = fakeStorage({ [chatStorageKey("a")]: "[]", [chatStorageKey(undefined)]: "[]", "other:key": "keep" });
      vi.stubGlobal("window", { sessionStorage: session });
      forgetChats();
      expect(session.length).toBe(1);
      expect(session.getItem("other:key")).toBe("keep");
    });

    it("does nothing when the browser blocks storage", () => {
      vi.stubGlobal("window", {
        get sessionStorage(): Storage {
          throw new DOMException("blocked", "SecurityError");
        },
      });
      expect(() => forgetChats()).not.toThrow();
    });
  });
});
