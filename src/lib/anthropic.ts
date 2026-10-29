import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ModelUsage } from "@/billing/usage-types";
import { AppError } from "@/lib/errors";

const REQUEST_OPTIONS = { timeout: 5 * 60_000, maxRetries: 1 };

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type StructuredRequest = {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

export type Structured<T> = { value: T; usage: ModelUsage };

/**
 * One Messages call whose reply must be JSON matching `schema`, with the tokens it used.
 * Uses create() + manual parse: parse() would throw on truncated or refused output
 * before stop_reason could be checked, hiding the real cause.
 */
export async function createStructured<S extends z.ZodType>(
  client: Anthropic,
  schema: S,
  request: StructuredRequest,
): Promise<Structured<z.infer<S>>> {
  const format = zodOutputFormat(schema);
  const response = await client.messages
    .create(
      {
        model: request.model,
        max_tokens: request.maxTokens ?? 16000,
        system: request.system,
        messages: request.messages,
        // Thinking is always on for these models; effort controls depth.
        output_config: { effort: request.effort ?? "high", format },
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
    throw new AppError("Claude ran out of output tokens before finishing. Try a shorter request.", 502);
  }
  const text = response.content.find((block) => block.type === "text");
  try {
    if (!text) throw new Error("Claude returned no text block");
    return { value: format.parse(text.text), usage: usageOf(request.model, response.usage) };
  } catch (err) {
    console.error("Claude structured output failed to parse", err);
    throw new AppError("Claude returned output that did not match the expected schema. Try again.", 502);
  }
}

// Booked under the requested id, not response.model: the API may answer with a dated snapshot id that the
// price table does not list.
function usageOf(model: string, usage: Anthropic.Usage): ModelUsage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(usage.cache_read_input_tokens != null && { cacheReadTokens: usage.cache_read_input_tokens }),
    ...(usage.cache_creation_input_tokens != null && { cacheWriteTokens: usage.cache_creation_input_tokens }),
  };
}

export function toAppError(err: unknown): AppError {
  // Not a 401: the browser reads that as its own session expiring and sends the user to sign in.
  if (err instanceof Anthropic.AuthenticationError) return new AppError("The AI service rejected the request; check the server's API key", 502);
  if (err instanceof Anthropic.RateLimitError) return new AppError("Anthropic rate limit hit. Wait a moment and retry.", 429);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AppError("The Anthropic API did not answer in time. Try again.", 504);
  if (err instanceof Anthropic.APIConnectionError) return new AppError("Could not reach the Anthropic API. Check your network.", 502);
  if (err instanceof Anthropic.APIError) {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
    return new AppError(`Anthropic API error: ${detail}`, 502);
  }
  return new AppError(err instanceof Error ? err.message : "Unknown error calling Claude", 500);
}
