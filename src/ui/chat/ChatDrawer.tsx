"use client";

import { useEffect, useRef, useState } from "react";
import type { Bank } from "@/bank/schema";
import type { ChatMessage, ResumeChange } from "@/chat/schema";
import { MAX_CHARS } from "@/lib/input-caps";
import { creditProblem, creditsLabel } from "@/ui/ads/messages";
import { RewardedAdButton } from "@/ui/ads/RewardedAdButton";
import { api, errorMessage, retryAfterOf } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { FOCUS_RING } from "@/ui/Button";
import { useCountdown } from "@/ui/countdown";
import { useMe } from "@/ui/useMe";
import { chatStorageKey } from "./chat-storage";
import { useChatContext } from "./ChatProvider";
import { recentMessages } from "./recent-messages";

type Turn = ChatMessage & { applied?: string[]; warnings?: string[] };

type ChatResponse = {
  reply: string;
  applied: string[];
  warnings: string[];
  bank: Bank;
  bankChanged: boolean;
  resumeChanges: ResumeChange[];
  /** The balance after the charge, for accounts that pay in credits. */
  credits?: number;
};

export function ChatDrawer() {
  const { handlers } = useChatContext();
  const [open, setOpen] = useState(false);
  const storageKey = chatStorageKey(handlers?.applicationId);
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper shadow-card transition-colors hover:bg-accent ${FOCUS_RING}`}
        >
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent" />
          Chat with Claude
        </button>
      )}
      {open && <ChatPanel key={storageKey} storageKey={storageKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function readTurns(key: string): Turn[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function ChatPanel({ storageKey, onClose }: { storageKey: string; onClose: () => void }) {
  const { handlers } = useChatContext();
  const { me, refresh, setCredits } = useMe();
  const [turns, setTurns] = useState<Turn[]>(() => readTurns(storageKey));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState<string | null>(null);
  // The server's numbers from a 402, shown until the balance covers the cost again.
  const [shortBy, setShortBy] = useState<{ credits: number; needed: number } | null>(null);
  // The wait a 429 asked for, kept for the screen-reader text while the countdown runs.
  const [limitedFor, setLimitedFor] = useState<number | null>(null);
  const countdown = useCountdown();
  const limited = countdown.secondsLeft > 0;
  const chargesCredits = me?.policy.chargesCredits ?? false;
  const cost = me?.creditsPerChatMessage ?? 0;
  const credits = me?.credits ?? 0;
  const refusedShort = shortBy !== null && !(me && me.credits >= shortBy.needed);
  const short = (chargesCredits && credits < cost) || refusedShort;
  const list = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const wasShort = useRef(short);

  // Earning the missing credit removes the ad prompt, and the focused ad button with it: carry on in the message box.
  useEffect(() => {
    if (wasShort.current && !short) textarea.current?.focus();
    wasShort.current = short;
  }, [short]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(turns));
    } catch {
      // Storage is a convenience; the conversation still works without it.
    }
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, storageKey, busy]);

  async function send() {
    const content = input.trim();
    if (!content || busy || short || limited) return;
    const history: Turn[] = [...turns, { role: "user", content }];
    setTurns(history);
    setInput("");
    setBusy(true);
    setError(null);
    setPaused(null);
    setShortBy(null);
    try {
      await handlers?.flush?.();
      const res = await api.send<ChatResponse>("/api/chat", "POST", {
        applicationId: handlers?.applicationId,
        resume: handlers?.getResume?.() ?? undefined,
        messages: recentMessages(history),
      });
      let applied = res.applied;
      let warnings = res.warnings;
      if (handlers?.applyResumeChanges) {
        const local = handlers.applyResumeChanges(res.resumeChanges, res.bank);
        applied = [...applied, ...local.applied];
        warnings = [...warnings, ...local.warnings];
      }
      if (res.bankChanged) await handlers?.reloadBank?.();
      setTurns((t) => [...t, { role: "assistant", content: res.reply, applied, warnings }]);
      if (res.credits !== undefined) setCredits(res.credits);
    } catch (err) {
      const wait = retryAfterOf(err);
      const problem = creditProblem(err);
      if (wait !== null || problem) {
        // Claude never saw the message: take it back out of the conversation so it can be sent again later.
        setTurns(turns);
        setInput(content);
      }
      if (wait !== null) {
        setLimitedFor(wait);
        countdown.start(wait);
      } else if (problem) {
        if (problem.kind === "short") {
          setCredits(problem.credits);
          setShortBy({ credits: problem.credits, needed: problem.needed });
        } else {
          setPaused(problem.message);
        }
        // Without the account there is no balance to correct: load it.
        if (me === null) refresh();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
      textarea.current?.focus();
    }
  }

  return (
    <section
      aria-label="Chat with Claude"
      className="fixed bottom-4 right-4 z-20 flex h-[min(620px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-rule bg-card shadow-card"
    >
      <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base leading-tight">Chat with Claude</p>
          <p className="truncate text-xs text-ink-faint">{handlers?.label ?? "Bank only (open a resume to edit it here)"}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setTurns([])} disabled={busy || turns.length === 0}>
          Clear
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close chat">
          ✕
        </Button>
      </header>

      <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <p className="text-sm text-ink-soft">
            Paste an experience to add it to your bank, or ask for changes: “add my Kafka work to this resume”, “shorten the summary”, “I also interned at …”.
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed ${turn.role === "user" ? "bg-ink text-paper" : "bg-paper-deep text-ink"}`}>
              <p className="whitespace-pre-wrap">{turn.content}</p>
              {turn.applied && turn.applied.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ok">
                  {turn.applied.map((a, j) => (
                    <li key={j}>✓ {a}</li>
                  ))}
                </ul>
              )}
              {turn.warnings && turn.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-warn">
                  {turn.warnings.map((w, j) => (
                    <li key={j}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <p role="status" className="text-xs text-ink-faint">
            <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse" />
            Claude is working…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent-deep">
            {error}
          </p>
        )}
        {paused && <Banner tone="warn">{paused}</Banner>}
        {limited && (
          <Banner tone="warn">
            <span className="sr-only">Too many requests, try again in {limitedFor} seconds.</span>
            <span aria-hidden="true">
              Too many requests, try again in <span className="tabular-nums">{countdown.secondsLeft}</span> s
            </span>
          </Banner>
        )}
      </div>

      {short && (
        <div className="grid gap-2 border-t border-rule bg-warn-soft/60 px-3 py-2.5">
          <p className="text-xs text-warn">
            {refusedShort &&
              `A message costs ${creditsLabel(shortBy.needed)} and you have ${shortBy.credits}. `}
            {me?.adsAvailable ? "Watch an ad to keep chatting." : "You need more credits to keep chatting."}
          </p>
          <RewardedAdButton size="sm" />
        </div>
      )}

      <form
        className="border-t border-rule p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          maxLength={MAX_CHARS.chatMessage}
          placeholder="Type or paste here. Enter to send, Shift+Enter for a new line."
          aria-label="Message"
          className="w-full resize-none rounded-md border border-rule bg-paper px-3 py-2 text-sm placeholder:text-ink-faint focus:border-ink focus:outline-none"
          disabled={busy}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {chargesCredits && cost > 0 && (
            <p className="mr-auto text-xs text-ink-faint">
              {creditsLabel(cost)} per message · you have {credits}
            </p>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={busy || short || limited || !input.trim()}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
