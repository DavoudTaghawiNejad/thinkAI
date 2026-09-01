import type { ProviderRequest } from "./types";

/**
 * Anthropic requires max_tokens on every request; DeepSeek accepts it as an
 * optional cap. Shared sizing heuristic for both.
 *
 * Reasoning models (DeepSeek v4, Anthropic extended thinking) count their
 * chain-of-thought against max_tokens, so the budget has to cover thinking +
 * answer. Sizes below assume the caller's reasoningEffort is honest about how
 * much thinking to expect.
 */
export function pickMaxTokens(req: ProviderRequest): number {
  const effort = req.reasoningEffort ?? "none";

  if (req.jsonSchema) {
    // Critic verdict: a few hundred tokens of strict JSON. With no CoT that fits
    // easily; if a caller turns reasoning on, leave room for it to think first.
    return effort === "none" || effort === "minimal" ? 2048 : 12288;
  }

  // Free-form answer (final-answer role).
  if (effort === "high") return 32768;
  if (effort === "medium") return 16384;
  if (effort === "low" || effort === "minimal") return 8192;
  return 4096;
}
