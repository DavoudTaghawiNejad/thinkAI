export type ProviderRequest = {
  /** Bare model id — the dispatcher has already stripped the "anthropic/"/"deepseek/" prefix. */
  model: string;
  instructions: string;
  input: string;
  reasoningEffort?: "low" | "medium" | "high";
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
