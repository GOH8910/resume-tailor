import { newApplicationId } from "@/applications/ids";
import type { ApplicationRepository } from "@/applications/repository";
import { fromTailorResult, fullStateFromBank } from "@/applications/resume-state";
import type { Application } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import { attachUsage } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import { AppError } from "@/lib/errors";
import { DEFAULT_LIMITS, type TailorLimits } from "./limits";
import type { TailorModel } from "./model";
import { buildSystemPrompt, buildUserMessage } from "./prompt";
import { validateTailorResult } from "./validate";

export type TailorInput = {
  userId: string;
  jobDescription: string;
  company: string;
  roleTitle?: string;
};

export type TailorDeps = {
  banks: BankRepository;
  applications: ApplicationRepository;
  model: TailorModel;
  limits?: TailorLimits;
  now?: () => Date;
};

function cleanInput(input: TailorInput) {
  const jobDescription = input.jobDescription.trim();
  const company = input.company.trim();
  if (!jobDescription) throw new AppError("Job description is required", 400);
  if (!company) throw new AppError("Company is required", 400);
  return { jobDescription, company, roleTitle: input.roleTitle?.trim() ?? "" };
}

function newApplication(fields: Omit<Application, "id" | "createdAt">, now: Date): Application {
  return { id: newApplicationId(fields.company, now), createdAt: now.toISOString(), ...fields };
}

/** Ask Claude for a selection, validate it against the bank, and save the application. Also returns the tokens used. */
export async function runTailor(input: TailorInput, deps: TailorDeps): Promise<{ application: Application; usage: ModelUsage }> {
  const { jobDescription, company, roleTitle } = cleanInput(input);
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const bank = await deps.banks.read(input.userId);
  const { result: raw, usage } = await deps.model.tailor({
    system: buildSystemPrompt(limits),
    user: buildUserMessage(bank, jobDescription, company, roleTitle),
  });
  try {
    const { result, warnings } = validateTailorResult(bank, raw, limits);
    const now = (deps.now ?? (() => new Date()))();
    const application = newApplication(
      { company, roleTitle, jobDescription, model: deps.model.id, warnings, notes: result.notes, resume: fromTailorResult(bank, result) },
      now,
    );
    return { application: await deps.applications.save(input.userId, application), usage };
  } catch (err) {
    // The call was billed even though the tailor failed; the caller still books it.
    throw attachUsage(err, usage);
  }
}

/** No-AI path: start from the whole bank and let the user prune. */
export async function createManualApplication(
  input: TailorInput,
  deps: Pick<TailorDeps, "banks" | "applications" | "now">,
): Promise<Application> {
  const { jobDescription, company, roleTitle } = cleanInput(input);
  const bank = await deps.banks.read(input.userId);
  const now = (deps.now ?? (() => new Date()))();
  const application = newApplication(
    { company, roleTitle, jobDescription, model: "manual", warnings: [], notes: "", resume: fullStateFromBank(bank) },
    now,
  );
  return deps.applications.save(input.userId, application);
}
