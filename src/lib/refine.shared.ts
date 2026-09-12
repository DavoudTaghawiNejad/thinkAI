// Default setup (critic/final instructions, default models, the starting
// test-step sequence) lives in config/defaults.yaml, loaded via
// src/lib/defaults-config.server.ts — that's the file to edit to change defaults.
// This file keeps only what's shared between client and server: types, the
// verdict JSON schema, prompt-builder functions, and the model *picklists* shown
// in the Settings dropdowns (kept here, not in the YAML, since this file is
// imported directly by the client-side Settings dialog).

import { dump as dumpYaml } from "js-yaml";

export type TestStep = {
  id: string;
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
  position: number;
};

/**
 * One package: the instructions the reviewing and answering models are given,
 * plus the ordered tests they are used for. Instructions and tests are written
 * for each other, so they are named, picked, saved, shared and published as a
 * single thing.
 *
 * A sequence is one of two kinds, and `owned` says which:
 *  - personal (`owned`)  — private to its owner and always freely editable;
 *  - general (`!owned`)  — visible to every profile and editable by nobody.
 *    An admin changes one by re-publishing the personal sequence it came from.
 */
export type TestSequence = {
  id: string;
  name: string;
  critic_instruction: string;
  final_instruction: string;
  owned: boolean;
  /**
   * This profile's default — what the home-page picker and a new run start
   * from. Any sequence the profile can see may be chosen, general ones
   * included, because the choice lives on the profile rather than on the
   * sequence.
   */
  isDefault: boolean;
  /** General only: what a brand-new profile's default is set to. */
  isNewUserDefault: boolean;
  /**
   * Own sequences only: a general version of this one exists, published from
   * it. Publishing again updates that version rather than adding another.
   */
  publishedAsGeneral: boolean;
  steps: TestStep[];
};

export type Settings = {
  critic_model: string;
  final_model: string;
  debug_mode: boolean;
  /** The profile's default sequence — may be one of the shared general ones. */
  default_sequence_id: string | null;
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
  /**
   * Questions the author has deliberately left open, keyed by their exact text
   * — the critic's questions are plain strings with no id of their own. Set for
   * the whole run: once marked, a question is carried into every later
   * submission, in this test and all the ones after it.
   */
  open_questions: string[];
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

/**
 * The critic instruction as actually sent: the sequence's own wording, plus the
 * questions the author has marked intentionally open in this run.
 *
 * The list goes here rather than into the user message because the rule that
 * governs it — "when questions are intentionally left open, ignore them for the
 * test scoring and do not ask questions about them" — is part of the critic
 * instruction, written there by an admin. Keeping the rule and the questions it
 * refers to in one message saves the model an indirection, and "ignore these for
 * scoring" is a standing constraint, which is what the instruction is for.
 */
export function composeCriticInstruction(args: {
  criticInstruction: string;
  openQuestions: string[];
}): string {
  if (args.openQuestions.length === 0) return args.criticInstruction;
  return [
    args.criticInstruction,
    "",
    "INTENTIONALLY LEFT OPEN — the author has deliberately left these questions open:",
    ...args.openQuestions.map((q) => `- ${q}`),
  ].join("\n");
}

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

// ---------------------------------------------------------------------------
// Sharing: turn a sequence — instructions and tests, the whole package — into a
// portable YAML document plus a readable plain-text rendering, and build the
// mailto: link. All client-safe.
// ---------------------------------------------------------------------------

const YAML_OPTS = { lineWidth: 100, noRefs: true } as const;

/** The whole package as one portable document — instructions and tests together. */
export function sequenceToYaml(seq: {
  name: string;
  critic_instruction: string;
  final_instruction: string;
  steps: Omit<TestStep, "id" | "position">[];
}): string {
  return dumpYaml(
    {
      kind: "test_sequence",
      name: seq.name,
      critic_instruction: seq.critic_instruction,
      final_instruction: seq.final_instruction,
      steps: seq.steps.map((s) => ({
        name: s.name,
        description: s.description,
        instruction: s.instruction,
        pass_threshold: s.pass_threshold,
        max_iterations: s.max_iterations,
      })),
    },
    YAML_OPTS,
  );
}

export function buildShareText(seq: {
  name: string;
  critic_instruction: string;
  final_instruction: string;
  steps: Omit<TestStep, "id" | "position">[];
}): string {
  const lines = [
    `Test sequence: ${seq.name}`,
    "",
    "── Critic instruction ──",
    seq.critic_instruction,
    "",
    "── Final-answer instruction ──",
    seq.final_instruction,
    "",
    "── Tests ──",
    "",
  ];
  seq.steps.forEach((s, i) => {
    lines.push(
      `${String(i + 1).padStart(2, "0")}. ${s.name}` +
        `  (pass ≥ ${s.pass_threshold}, max ${s.max_iterations} iterations)`,
      s.description ? `    ${s.description}` : "",
      `    ${s.instruction}`,
      "",
    );
  });
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export function buildMailto(args: { to: string; subject: string; body: string }): string {
  const params = new URLSearchParams({ subject: args.subject, body: args.body });
  return `mailto:${encodeURIComponent(args.to)}?${params.toString()}`;
}
