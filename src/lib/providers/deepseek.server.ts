import {
  ProviderError,
  type ProviderCallOpts,
  type ProviderRequest,
  type ProviderResult,
} from "./types";
import { withTransientRetry } from "./retry";
import { pickMaxTokens } from "./max-tokens";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function getDeepseekApiKey() {
  const key = process.env["DEEPSEEK_API_KEY"];
  if (!key) throw new ProviderError(500, "Missing DEEPSEEK_API_KEY");
  return key;
}

export async function streamDeepseek(
  req: ProviderRequest,
  opts?: ProviderCallOpts,
): Promise<ProviderResult> {
  return withTransientRetry(() => streamDeepseekOnce(req, opts));
}

async function streamDeepseekOnce(
  req: ProviderRequest,
  opts?: ProviderCallOpts,
): Promise<ProviderResult> {
  const started = Date.now();

  // DeepSeek's json_object mode only guarantees valid JSON syntax, not the schema shape,
  // and requires the word "json" to appear somewhere in the prompt. Describe the schema
  // in-band rather than relying on settings.critic_instruction to mention it.
  const schemaNote = req.jsonSchema
    ? `\n\nRespond with a single JSON object only (no markdown fences, no commentary) matching this JSON Schema exactly: ${JSON.stringify(req.jsonSchema.schema)}`
    : "";
  const systemText = req.instructions + schemaNote;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: req.input },
    ],
    stream: true,
    max_tokens: pickMaxTokens(req),
  };
  if (req.jsonSchema) {
    body["response_format"] = { type: "json_object" };
  }

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getDeepseekApiKey()}`,
    },
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(res.status, deepseekErrorMessage(res.status, detail));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let runId: string | undefined;
  let sawDone = false;
  let finishReason: string | null = null;

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
      if (payload === "[DONE]") {
        sawDone = true;
        continue;
      }
      let evt: {
        id?: string;
        choices?: [
          {
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
          },
        ];
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = evt.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.content === "string") {
        text += delta.content;
        opts?.onDelta?.(delta.content);
      }
      if (typeof delta?.reasoning_content === "string") {
        reasoning += delta.reasoning_content;
        opts?.onReasoning?.(delta.reasoning_content);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      runId ??= evt.id;
    }
  }

  // DeepSeek closes the SSE stream cleanly (done=true) even when the connection
  // dropped mid-response — no error is thrown, we just have a partial body. The
  // end-of-stream markers ([DONE] or a finish_reason) are the only signal that
  // the model actually finished. Missing both means truncation: throw a
  // "terminated" error so withTransientRetry re-runs it instead of returning
  // half a JSON object.
  if (!sawDone && !finishReason) {
    throw new Error("DeepSeek stream terminated before the response finished.");
  }
  if (finishReason === "length") {
    throw new ProviderError(500, "DeepSeek hit its output-token limit before finishing the reply.");
  }

  return { text, reasoning, ...(runId ? { runId } : {}), latencyMs: Date.now() - started };
}

function deepseekErrorMessage(status: number, detail: string): string {
  let parsed = "";
  try {
    const json = JSON.parse(detail) as { error?: { message?: string }; message?: string };
    parsed = json.error?.message ?? json.message ?? "";
  } catch {
    parsed = detail.slice(0, 400);
  }
  if (status === 401) return parsed || "Invalid DeepSeek API key.";
  if (status === 402) return parsed || "DeepSeek account balance is insufficient.";
  if (status === 429) return parsed || "Rate limited by DeepSeek. Try again shortly.";
  return parsed || `DeepSeek request failed (${status}).`;
}
