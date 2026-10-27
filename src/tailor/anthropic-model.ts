import Anthropic from "@anthropic-ai/sdk";
import { createStructured, hasApiKey } from "@/lib/anthropic";
import type { ModelId, TailorModel, TailorRequest } from "./model";
import { type TailorResult, TailorResultSchema } from "./schema";

export { hasApiKey };

export class AnthropicTailorModel implements TailorModel {
  private readonly client: Anthropic;

  constructor(
    readonly id: ModelId,
    client?: Anthropic,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from the environment (Next.js loads .env.local).
    this.client = client ?? new Anthropic();
  }

  tailor(request: TailorRequest): Promise<TailorResult> {
    return createStructured(this.client, TailorResultSchema, {
      model: this.id,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      effort: "high",
    });
  }
}
