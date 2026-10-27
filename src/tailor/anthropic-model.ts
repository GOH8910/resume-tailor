import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import type { ModelId, TailorModel, TailorRequest } from "./model";
import { type TailorResult, TailorResultSchema } from "./schema";

const OUTPUT_FORMAT = zodOutputFormat(TailorResultSchema);
const REQUEST_OPTIONS = { timeout: 5 * 60_000, maxRetries: 1 };

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
    // create() + manual parse, because parse() throws on truncated or refused output
    // before stop_reason can be checked, which would hide the real cause.
    const response = await this.client.messages
      .create(
        {
          model: this.id,
          max_tokens: 16000,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          // Thinking is always on for these models; effort controls depth.
          output_config: { effort: "high", format: OUTPUT_FORMAT },
        },
        REQUEST_OPTIONS,
      )
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
    const text = response.content.find((block) => block.type === "text");
    try {
      if (!text) throw new Error("Claude returned no text block");
      return OUTPUT_FORMAT.parse(text.text);
    } catch (err) {
      console.error("Claude structured output failed to parse", err);
      throw new AppError("Claude returned output that did not match the expected schema. Try again.", 502);
    }
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof Anthropic.AuthenticationError) return new AppError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", 401);
  if (err instanceof Anthropic.RateLimitError) return new AppError("Anthropic rate limit hit. Wait a moment and retry.", 429);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AppError("The Anthropic API did not answer in time. Try again.", 504);
  if (err instanceof Anthropic.APIConnectionError) return new AppError("Could not reach the Anthropic API. Check your network.", 502);
  if (err instanceof Anthropic.APIError) {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
    return new AppError(`Anthropic API error: ${detail}`, 502);
  }
  return new AppError(err instanceof Error ? err.message : "Unknown error calling Claude", 500);
}
