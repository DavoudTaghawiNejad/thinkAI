import type { ProviderRequest } from "./types";

/** Anthropic requires max_tokens on every request; DeepSeek accepts it as an optional cap. Shared sizing heuristic for both. */
export function pickMaxTokens(req: ProviderRequest): number {
  if (req.jsonSchema) return 2048; // critic verdict — small, bounded JSON
  if (req.reasoningEffort === "medium") return 8192; // final-answer role
  return 2048; // clarify / low-effort role
}
