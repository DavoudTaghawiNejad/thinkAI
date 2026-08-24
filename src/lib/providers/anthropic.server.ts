import {
  ProviderError,
  type ProviderCallOpts,
  type ProviderRequest,
  type ProviderResult,
} from "./types";
import { withTransientRetry } from "./retry";
import { pickMaxTokens } from "./max-tokens";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function getAnthropicApiKey() {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new ProviderError(500, "Missing ANTHROPIC_API_KEY");
  return key;
}

export async function streamAnthropic(
  req: ProviderRequest,
  opts?: ProviderCallOpts,
): Promise<ProviderResult> {
  return withTransientRetry(() => streamAnthropicOnce(req, opts));
}

async function streamAnthropicOnce(
  req: ProviderRequest,
  opts?: ProviderCallOpts,
): Promise<ProviderResult> {
  const started = Date.now();

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: pickMaxTokens(req),
    system: req.instructions,
    messages: [{ role: "user", content: req.input }],
    stream: true,
  };

  if (req.jsonSchema) {
    body["tools"] = [
      {
        name: req.jsonSchema.name,
        description: `Return the result as ${req.jsonSchema.name}.`,
        input_schema: req.jsonSchema.schema,
      },
    ];
    body["tool_choice"] = { type: "tool", name: req.jsonSchema.name };
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicApiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(res.status, anthropicErrorMessage(res.status, detail));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let toolInputJson = "";
  let reasoning = "";
  let runId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let evt: {
        type?: string;
        message?: { id?: string };
        delta?: { type?: string; text?: string; partial_json?: string; thinking?: string };
        error?: { message?: string };
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }

      if (evt.type === "message_start") {
        runId = evt.message?.id;
      } else if (evt.type === "content_block_delta") {
        const delta = evt.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
          opts?.onDelta?.(delta.text);
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          toolInputJson += delta.partial_json;
          opts?.onDelta?.(delta.partial_json);
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          reasoning += delta.thinking;
          opts?.onReasoning?.(delta.thinking);
        }
      } else if (evt.type === "error") {
        throw new ProviderError(
          529,
          evt.error?.message ?? "Anthropic returned a mid-stream error.",
        );
      }
    }
  }

  return {
    text: req.jsonSchema ? toolInputJson : text,
    reasoning,
    ...(runId ? { runId } : {}),
    latencyMs: Date.now() - started,
  };
}

function anthropicErrorMessage(status: number, detail: string): string {
  let parsed = "";
  try {
    const json = JSON.parse(detail) as { error?: { message?: string } };
    parsed = json.error?.message ?? "";
  } catch {
    parsed = detail.slice(0, 400);
  }
  if (status === 401) return parsed || "Invalid Anthropic API key.";
  if (status === 429) return parsed || "Rate limited by Anthropic. Try again shortly.";
  if (status === 529) return parsed || "Anthropic is temporarily overloaded. Try again shortly.";
  return parsed || `Anthropic request failed (${status}).`;
}
