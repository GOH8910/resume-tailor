import Anthropic from "@anthropic-ai/sdk";
import type { ModelUsage } from "@/billing/usage-types";
import { createStructured } from "@/lib/anthropic";
import type { TailorModel, TailorRequest } from "./model";
import { type TailorResult, TailorResultSchema } from "./schema";

export class AnthropicTailorModel implements TailorModel {
  private readonly client: Anthropic;

  constructor(
    readonly id: string,
    client?: Anthropic,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from the environment (Next.js loads .env.local).
    this.client = client ?? new Anthropic();
  }

  async tailor(request: TailorRequest): Promise<{ result: TailorResult; usage: ModelUsage }> {
    const { value, usage } = await createStructured(this.client, TailorResultSchema, {
      model: this.id,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      effort: "high",
    });
    return { result: value, usage };
  }
}
