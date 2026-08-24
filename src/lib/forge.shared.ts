// Central defaults file: everything a new user gets out of the box (which models,
// which system prompts, which starting test sequence) is defined below and nowhere
// else. Edit here to change default setup — nothing downstream (the invite-signup
// provisioning in invite.server.ts, forge.server.ts's AI calls, or the Settings
// dialog's model dropdowns) hardcodes its own copy.

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

export const DEFAULT_CRITIC_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_FINAL_MODEL = "anthropic/claude-opus-5";

export const CRITIC_MODELS = [
  DEFAULT_CRITIC_MODEL,
  "anthropic/claude-haiku-4-5-20251001",
  "anthropic/claude-sonnet-5",
] as const;

export const FINAL_MODELS = [
  DEFAULT_FINAL_MODEL,
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

export const SEARCHABLE_FACTS_RULE = `SEARCHABLE FACTS: Never ask for facts that are publicly searchable or inferable from something the author already named. If an event, work, product, person, place, company or law is identified, the answering model can look up its date, location, author or other public attributes — do not require the author to supply them. Ask only for information that lives with the author: intent, constraints, audience, context, preferences, scope, success criteria.`;

export const DEFAULT_CRITIC_INSTRUCTION = `You are a rigorous prompt reviewer. You evaluate a single draft prompt against one named test.

CRITICAL OUTPUT RULE: every refinement you return MUST be phrased as an open question that the author has to answer. Never propose replacement wording, never rewrite the prompt, never give imperative advice. Ask, do not suggest. Each item must end with a question mark.

${SEARCHABLE_FACTS_RULE}

Be concise and concrete. Judge only the named test, nothing else.`;

export const BETWEEN_TESTS_GUIDANCE =
  "Before the next test, rework your text: answer the open questions, restructure it, and tighten the paragraphs — shorter, without losing meaning.";

export const CLARIFY_INSTRUCTION = `You are a helper standing next to an author who is refining a prompt. The author asks you about one of the refinement questions a reviewer raised. Explain what the question is getting at, why it matters, and what kinds of answers would satisfy it. Be brief and concrete: a few sentences, plain text, no headings. You are NOT scoring anything and NOT rewriting the author's prompt. ${SEARCHABLE_FACTS_RULE}`;

/** System prompt for the one-shot final-answer call, once every test step has passed. Not user-editable. */
export const FINAL_INSTRUCTIONS =
  "You are answering a prompt that has been deliberately refined through a sequence of quality tests. Answer it directly, thoroughly and honestly. Where the prompt states success criteria, meet them explicitly.";

export const DEFAULT_DEBUG_MODE = false;

/** The test sequence every new user starts with (positions assigned by array order). */
export const DEFAULT_TEST_STEPS: Array<
  Pick<TestStep, "name" | "description" | "instruction" | "pass_threshold" | "max_iterations">
> = [
  {
    name: "Clarity",
    description: "Is the problem stated plainly and unambiguously?",
    instruction:
      "Test the draft prompt for CLARITY. Can a competent stranger understand exactly what is being asked, in one reading, without guessing? Identify every place where meaning is fuzzy, over-compressed, or hidden behind jargon.",
    pass_threshold: 80,
    max_iterations: 4,
  },
  {
    name: "Scope & Boundaries",
    description: "Is it clear what is in scope and what is not?",
    instruction:
      "Test the draft prompt for SCOPE AND BOUNDARIES. Is it clear what the answer should cover and, just as importantly, what it should leave out? Identify missing limits of time, domain, depth, audience, or format.",
    pass_threshold: 80,
    max_iterations: 4,
  },
  {
    name: "Ambiguity & Assumptions",
    description: "Which unstated assumptions are being smuggled in?",
    instruction:
      "Test the draft prompt for AMBIGUITY AND HIDDEN ASSUMPTIONS. Which terms could be read in more than one way? Which premises are asserted without being examined? Surface each one.",
    pass_threshold: 80,
    max_iterations: 4,
  },
  {
    name: "Context Sufficiency",
    description: "Does the AI have enough background to answer well?",
    instruction:
      "Test the draft prompt for CONTEXT SUFFICIENCY. Does it supply the background, constraints, data, and prior attempts a strong answer would need? Identify each missing piece of context.",
    pass_threshold: 80,
    max_iterations: 4,
  },
  {
    name: "Evaluability",
    description: "How will a good answer be recognised?",
    instruction:
      "Test the draft prompt for EVALUABILITY. Does it state how the author will judge whether the answer is good? Identify missing success criteria, required form of evidence, or acceptance conditions.",
    pass_threshold: 80,
    max_iterations: 4,
  },
];

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
