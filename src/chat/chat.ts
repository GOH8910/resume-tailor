import type { ApplicationRepository } from "@/applications/repository";
import type { Application, ResumeState } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import type { Bank } from "@/bank/schema";
import { attachUsage } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import { AppError } from "@/lib/errors";
import { applyBankChanges } from "./apply-bank";
import type { ChatModel } from "./model";
import { buildChatSystemPrompt } from "./prompt";
import type { ChatMessage, ResumeChange } from "./schema";

export type ChatInput = {
  userId: string;
  applicationId?: string;
  resume?: ResumeState;
  messages: ChatMessage[];
};

export type ChatDeps = { banks: BankRepository; applications: ApplicationRepository; model: ChatModel };

export type ChatOutcome = {
  reply: string;
  applied: string[];
  warnings: string[];
  bank: Bank;
  bankChanged: boolean;
  resumeChanges: ResumeChange[];
};

/** Keep the request bounded: Claude sees the bank every time, so old turns matter less. */
const MAX_TURNS = 20;

/** One chat turn: what the client sees, and the tokens it used. */
export async function runChat(input: ChatInput, deps: ChatDeps): Promise<{ outcome: ChatOutcome; usage: ModelUsage }> {
  const messages = input.messages.slice(-MAX_TURNS);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) throw new AppError("The last message must be from the user", 400);

  const bank = await deps.banks.read(input.userId);
  let application: Application | undefined;
  if (input.applicationId) application = await deps.applications.get(input.userId, input.applicationId);

  const system = buildChatSystemPrompt({ bank, application, resume: application ? input.resume : undefined });
  const { result, usage } = await deps.model.chat(system, messages);

  try {
    const { bank: nextBank, applied, warnings } = applyBankChanges(bank, result.bankChanges);
    const bankChanged = applied.length > 0;
    if (bankChanged) await deps.banks.write(input.userId, nextBank);

    const resumeChanges = application ? result.resumeChanges : [];
    if (!application && result.resumeChanges.length > 0) warnings.push("Resume changes were ignored because no resume is open");

    return { outcome: { reply: result.reply.trim(), applied, warnings, bank: nextBank, bankChanged, resumeChanges }, usage };
  } catch (err) {
    // The call was billed even though the turn failed; the caller still books it.
    throw attachUsage(err, usage);
  }
}
