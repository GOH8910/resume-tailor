import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import type { ModelId, TailorModel, TailorRequest } from "./model";
import { type TailorResult, TailorResultSchema } from "./schema";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class AnthropicTailorModel implements TailorModel {
  private readonly client: Anthropic;

  constructor(
    readonly id: ModelId,
    client?: Anthropic,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from the environment (Next.js loads .env.local).
    this.client = client ?? new Anthropic();
  }

  async tailor(request: TailorRequest): Promise<TailorResult> {
    const response = await this.client.messages
      .parse({
        model: this.id,
        max_tokens: 16000,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Thinking is always on for these models; effort controls depth.
        output_config: { effort: "high", format: zodOutputFormat(TailorResultSchema) },
      })
      .catch((err: unknown) => {
        throw toAppError(err);
      });
    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.explanation ?? "no explanation given";
      throw new AppError(`Claude declined this request: ${why}`, 502);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AppError("Claude ran out of output tokens before finishing. Try a shorter bank or JD.", 502);
    }
    if (!response.parsed_output) {
      throw new AppError("Claude returned output that did not match the expected schema.", 502);
    }
    return response.parsed_output;
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof Anthropic.AuthenticationError) return new AppError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", 401);
  if (err instanceof Anthropic.RateLimitError) return new AppError("Anthropic rate limit hit. Wait a moment and retry.", 429);
  if (err instanceof Anthropic.APIConnectionError) return new AppError("Could not reach the Anthropic API. Check your network.", 502);
  if (err instanceof Anthropic.APIError) return new AppError(`Anthropic API error: ${err.message}`, 502);
  return new AppError(err instanceof Error ? err.message : "Unknown error calling Claude", 500);
}
