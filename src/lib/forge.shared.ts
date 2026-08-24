// Default setup (critic/final/clarify instructions, default models, the starting
// test-step sequence) lives in config/defaults.yaml, loaded via
// src/lib/defaults-config.server.ts — that's the file to edit to change defaults.
// This file keeps only what's shared between client and server: types, the
// verdict JSON schema, prompt-builder functions, and the model *picklists* shown
// in the Settings dropdowns (kept here, not in the YAML, since this file is
// imported directly by the client-side Settings dialog).

export type TestStep = {
  id: string;
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
  position: number;
};

export type Settings = {
  critic_instruction: string;
  critic_model: string;
  final_model: string;
  debug_mode: boolean;
};

export type Verdict = {
  pass: boolean;
  score: number;
  diagnosis: string;
  questions: string[];
};

export type IterationRow = {
  id: string;
  step_index: number;
  step_name: string;
  iteration_number: number;
  prompt_snapshot: string;
  passed: boolean;
  score: number | null;
  diagnosis: string | null;
  questions: string[];
  skipped: boolean;
  created_at: string;
};

export type RunRow = {
  id: string;
  title: string;
  original_prompt: string;
  current_prompt: string;
  step_index: number;
  status: string;
  final_answer: string | null;
  final_model: string | null;
  final_prompt: string | null;
  created_at: string;
  updated_at: string;
};

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AiCallRow = {
  id: string;
  kind: string;
  model: string;
  system_text: string;
  user_text: string;
  request_params: JsonValue;
  raw_response: string | null;
  error_text: string | null;
  latency_ms: number | null;
  run_ref: string | null;
  created_at: string;
};

// Keep the first entry of each in sync with config/defaults.yaml's
// critic_model/final_model — see the note at the top of that file.
export const CRITIC_MODELS = [
  "deepseek/deepseek-v4-flash",
  "anthropic/claude-haiku-4-5-20251001",
  "anthropic/claude-sonnet-5",
] as const;

export const FINAL_MODELS = [
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "deepseek/deepseek-reasoner",
] as const;

/** The exact user-message text sent to the critic. History is never included. */
export function buildCriticUserText(args: {
  stepName: string;
  stepDescription: string;
  stepInstruction: string;
  stepIndex: number;
  stepCount: number;
  iteration: number;
  maxIterations: number;
  passThreshold: number;
  prompt: string;
}) {
  return [
    `TEST ${args.stepIndex + 1} OF ${args.stepCount}: ${args.stepName}`,
    args.stepDescription ? `Test focus: ${args.stepDescription}` : "",
    `Iteration ${args.iteration} of ${args.maxIterations}.`,
    `Pass threshold: score >= ${args.passThreshold}.`,
    "",
    "TEST INSTRUCTION:",
    args.stepInstruction,
    "",
    "DRAFT PROMPT UNDER REVIEW:",
    "<<<PROMPT",
    args.prompt,
    "PROMPT",
    "",
    "Return a score 0-100, a one-paragraph diagnosis, and the refinement items.",
    "Every refinement item must be an open question ending with a question mark.",
    "If the draft already passes this test, set pass to true and return an empty question list.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    score: { type: "integer" },
    diagnosis: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["pass", "score", "diagnosis", "questions"],
} as const;

export const BETWEEN_TESTS_GUIDANCE =
  "Before the next test, rework your text: answer the open questions, restructure it, and tighten the paragraphs — shorter, without losing meaning.";

/** The exact user-message text sent for an auxiliary clarification. History is never included. */
export function buildClarifyUserText(args: {
  stepName: string;
  stepInstruction: string;
  question: string;
  message: string;
  prompt: string;
}) {
  return [
    `CURRENT TEST: ${args.stepName}`,
    `TEST INSTRUCTION: ${args.stepInstruction}`,
    "",
    "CURRENT DRAFT PROMPT:",
    "<<<PROMPT",
    args.prompt,
    "PROMPT",
    "",
    args.question ? `REFINEMENT QUESTION IN FOCUS:\n${args.question}` : "",
    "",
    "AUTHOR ASKS:",
    args.message,
  ]
    .filter(Boolean)
    .join("\n");
}
