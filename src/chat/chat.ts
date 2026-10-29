import type { Application, ResumeState } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import type { Bank } from "@/bank/schema";
import { attachUsage } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import { AppError } from "@/lib/errors";
import { jsonBytes, MAX_BANK_JSON_BYTES, MAX_CHARS, MAX_CHAT_MESSAGES, truncateText } from "@/lib/input-caps";
import { type ApplyBankResult, applyBankChanges } from "./apply-bank";
import type { ChatModel } from "./model";
import { buildChatSystemPrompt } from "./prompt";
import type { ChatMessage, ChatResult, ResumeChange } from "./schema";

export type ChatInput = {
  userId: string;
  /** The open resume's application, already read from the account (the route does it before charging). */
  application?: Application;
  resume?: ResumeState;
  messages: ChatMessage[];
};

export type ChatDeps = { banks: BankRepository; model: ChatModel };

export type ChatOutcome = {
  reply: string;
  applied: string[];
  warnings: string[];
  bank: Bank;
  bankChanged: boolean;
  resumeChanges: ResumeChange[];
};

/** Refuses (400) a conversation that does not end with a user message. Routes call it before charging. */
export function checkChatMessages(messages: ChatMessage[]): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) throw new AppError("The last message must be from the user", 400);
}

/** One chat turn: what the client sees, and the tokens it used. */
export async function runChat(input: ChatInput, deps: ChatDeps): Promise<{ outcome: ChatOutcome; usage: ModelUsage }> {
  // The route already caps the request; a caller that skips the route (tests, scripts) is held to the same bound.
  const messages = input.messages.slice(-MAX_CHAT_MESSAGES);
  checkChatMessages(messages);

  const bank = await deps.banks.read(input.userId);
  const { application } = input;

  const system = buildChatSystemPrompt({ bank, application, resume: application ? input.resume : undefined });
  const { result, usage } = await deps.model.chat(system, messages);

  try {
    const { bank: savedBank, applied, warnings } = await saveBankChanges(input.userId, bank, result.bankChanges, deps.banks);
    const bankChanged = applied.length > 0;

    const resumeChanges = application ? result.resumeChanges : [];
    if (!application && result.resumeChanges.length > 0) warnings.push("Resume changes were ignored because no resume is open");

    // Replies come back in later requests' history, which is capped: a longer one would block the conversation.
    const reply = truncateText(result.reply.trim(), MAX_CHARS.chatReply);
    if (reply.length < result.reply.trim().length) warnings.push(`Claude's reply was cut to ${MAX_CHARS.chatReply.toLocaleString("en")} characters`);

    return { outcome: { reply, applied, warnings, bank: savedBank, bankChanged, resumeChanges }, usage };
  } catch (err) {
    // The call was billed even though the turn failed; the caller still books it.
    throw attachUsage(err, usage);
  }
}

/**
 * Applies Claude's bank changes and saves the result, unless it would be larger than the bank editor may save
 * (MAX_BANK_JSON_BYTES): then nothing is saved, and a warning says so.
 */
async function saveBankChanges(
  userId: string,
  bank: Bank,
  changes: ChatResult["bankChanges"],
  banks: Pick<BankRepository, "write">,
): Promise<ApplyBankResult> {
  const result = applyBankChanges(bank, changes);
  if (result.applied.length === 0) return result;
  if (jsonBytes(result.bank) > MAX_BANK_JSON_BYTES) {
    const warning = `Claude's changes would make your bank larger than ${MAX_BANK_JSON_BYTES / 1000} KB, so none were saved`;
    return { bank, applied: [], warnings: [...result.warnings, warning] };
  }
  await banks.write(userId, result.bank);
  return result;
}
