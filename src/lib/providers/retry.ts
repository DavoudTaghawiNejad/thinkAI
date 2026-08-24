import { ProviderError } from "./types";

export function isTransientNetworkError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  const cause = String((error as { cause?: unknown })?.cause ?? "").toLowerCase();
  return ["terminated", "fetch failed", "econnreset", "socket", "network", "closed"].some(
    (needle) => message.includes(needle) || cause.includes(needle),
  );
}

/**
 * Long reasoning calls can have the upstream connection dropped mid-stream. Retry
 * transient drops up to 3x with 1s/2s/3s backoff; anything else (including a clean
 * ProviderError from the upstream API) is rethrown immediately.
 */
export async function withTransientRetry<T extends { text: string; reasoning: string }>(
  attempt: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await attempt();
      if (result.text.trim() || result.reasoning.trim()) return result;
      lastError = new Error("The AI provider returned an empty response.");
    } catch (error) {
      if (error instanceof ProviderError || !isTransientNetworkError(error)) throw error;
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(
    `The AI request was interrupted before finishing (${(lastError as Error)?.message ?? "unknown"}). Try again.`,
  );
}
