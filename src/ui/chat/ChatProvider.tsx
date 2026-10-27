"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { ResumeState } from "@/applications/schema";
import type { Bank } from "@/bank/schema";
import type { ResumeChange } from "@/chat/schema";

/** What the page under the chat drawer can do for it. Functions should read refs so they never go stale. */
export type ChatPageHandlers = {
  label: string;
  applicationId?: string;
  getResume?: () => ResumeState | null;
  applyResumeChanges?: (changes: ResumeChange[], bank: Bank) => { applied: string[]; warnings: string[] };
  /** Save pending edits before Claude reads the data. */
  flush?: () => Promise<void>;
  /** Re-read the bank after Claude changed it. */
  reloadBank?: () => Promise<void>;
};

type ChatContextValue = {
  handlers: ChatPageHandlers | null;
  register: (handlers: ChatPageHandlers) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [handlers, setHandlers] = useState<ChatPageHandlers | null>(null);
  const register = useCallback((next: ChatPageHandlers) => {
    setHandlers(next);
    return () => setHandlers((current) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ handlers, register }), [handlers, register]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used inside ChatProvider");
  return ctx;
}
