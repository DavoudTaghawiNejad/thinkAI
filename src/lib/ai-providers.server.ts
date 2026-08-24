import { streamAnthropic } from "./providers/anthropic.server";
import { streamDeepseek } from "./providers/deepseek.server";
import {
  ProviderError,
  type ProviderCallOpts,
  type ProviderRequest,
  type ProviderResult,
} from "./providers/types";

export { ProviderError };
export type { ProviderRequest, ProviderResult, ProviderCallOpts };

const PROVIDERS: Record<
  string,
  (req: ProviderRequest, opts?: ProviderCallOpts) => Promise<ProviderResult>
> = {
  anthropic: streamAnthropic,
  deepseek: streamDeepseek,
};

/** model is expected as "<provider>/<bare-model-id>", e.g. "anthropic/claude-sonnet-5". */
export async function runModelRequest(
  req: ProviderRequest,
  opts?: ProviderCallOpts,
): Promise<ProviderResult> {
  const slash = req.model.indexOf("/");
  if (slash <= 0) {
    throw new ProviderError(
      500,
      `Model "${req.model}" must be prefixed with a provider, e.g. "anthropic/claude-sonnet-5" or "deepseek/deepseek-chat".`,
    );
  }
  const providerKey = req.model.slice(0, slash);
  const bareModel = req.model.slice(slash + 1);
  const call = PROVIDERS[providerKey];
  if (!call) {
    throw new ProviderError(
      500,
      `Unknown AI provider "${providerKey}". Supported: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return call({ ...req, model: bareModel }, opts);
}
