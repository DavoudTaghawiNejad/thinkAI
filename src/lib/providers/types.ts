export type ProviderRequest = {
  /** Bare model id — the dispatcher has already stripped the "anthropic/"/"deepseek/" prefix. */
  model: string;
  instructions: string;
  input: string;
  /** Maps straight to DeepSeek's `reasoning_effort`. "none" disables chain-of-thought entirely. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

export type ProviderResult = {
  text: string;
  reasoning: string;
  runId?: string;
  latencyMs: number;
};

export type ProviderCallOpts = {
  onDelta?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  signal?: AbortSignal;
  incomingRunId?: string;
};

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ProviderError";
  }
}
