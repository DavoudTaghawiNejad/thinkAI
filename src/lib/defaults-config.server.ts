import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

const DefaultTestStepSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  instruction: z.string().min(1),
  pass_threshold: z.number().int().min(0).max(100),
  max_iterations: z.number().int().min(1).max(20),
});

const DefaultsConfigFileSchema = z.object({
  critic_model: z.string().min(1),
  final_model: z.string().min(1),
  debug_mode: z.boolean(),
  searchable_facts_rule: z.string().min(1),
  critic_instruction: z.string().min(1),
  clarify_instruction: z.string().min(1),
  final_instructions: z.string().min(1),
  test_steps: z.array(DefaultTestStepSchema).min(1),
});

export type DefaultsConfig = z.infer<typeof DefaultsConfigFileSchema>;

const CONFIG_PATH = resolve(process.cwd(), "config/defaults.yaml");
const PLACEHOLDER = "{{searchable_facts_rule}}";

/**
 * Reads and validates config/defaults.yaml fresh on every call — no caching, so
 * an edit to the file (bind-mounted read-only in Docker) takes effect on the very
 * next signup or AI call, with no rebuild or restart needed.
 */
export async function loadDefaultsConfig(): Promise<DefaultsConfig> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read default-settings config at ${CONFIG_PATH}. This file is required ` +
        `for signup provisioning and every AI call's default instructions. ` +
        `(${(error as Error).message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(`${CONFIG_PATH} is not valid YAML: ${(error as Error).message}`);
  }

  const result = DefaultsConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${CONFIG_PATH} failed validation: ${details}`);
  }

  const cfg = result.data;
  return {
    ...cfg,
    critic_instruction: cfg.critic_instruction.replaceAll(PLACEHOLDER, cfg.searchable_facts_rule),
    clarify_instruction: cfg.clarify_instruction.replaceAll(PLACEHOLDER, cfg.searchable_facts_rule),
  };
}
