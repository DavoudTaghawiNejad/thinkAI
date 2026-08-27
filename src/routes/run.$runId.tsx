import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bug, Check, SkipForward, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { generateFinalAnswer, getRun, reviewPrompt, skipCurrentStep } from "@/lib/forge.functions";
import {
  BETWEEN_TESTS_GUIDANCE,
  buildCriticUserText,
  type AiCallRow,
  type IterationRow,
} from "@/lib/forge.shared";

export const Route = createFileRoute("/run/$runId")({
  head: () => ({
    meta: [
      { title: "Workbench — Prompt Forge" },
      {
        name: "description",
        content:
          "Refine your prompt test by test: submit for review, answer the AI's questions, and forge a prompt worth asking.",
      },
      { property: "og:title", content: "Workbench — Prompt Forge" },
      {
        property: "og:description",
        content: "Iterative prompt refinement with staged AI reviews and an auditable debug trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workbench,
});

function Workbench() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, loading } = useAuth();
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const autoReviewed = useRef(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const query = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun({ data: { runId } }),
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (query.data && !dirty) setDraft(query.data.run.current_prompt);
  }, [query.data, dirty]);

  const review = useMutation({
    mutationFn: (prompt: string) => reviewPrompt({ data: { runId, prompt } }),
    onSuccess: async (result) => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
      if (result.reason === "pass") toast.success("Test passed — moving to the next test.");
      else if (result.reason === "max_iterations")
        toast.message("Iteration limit reached — moving on.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // First test runs automatically on the text as entered.
  const reviewMutate = review.mutate;
  useEffect(() => {
    if (!query.data || autoReviewed.current) return;
    const data = query.data;
    const hasIterations = (data.iterations as IterationRow[]).length > 0;
    if (hasIterations || data.run.step_index !== 0) {
      autoReviewed.current = true;
      return;
    }
    autoReviewed.current = true;
    reviewMutate(data.run.current_prompt);
  }, [query.data, reviewMutate]);

  const skip = useMutation({
    mutationFn: () => skipCurrentStep({ data: { runId, prompt: draft } }),
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const finalize = useMutation({
    mutationFn: () => generateFinalAnswer({ data: { runId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (loading || !session || !query.data) return null;

  const { run, steps, settings, iterations, aiCalls } = query.data;
  const typedIterations = iterations as IterationRow[];
  const stepIndex: number = run.step_index;
  const step = steps[stepIndex];
  const stepIterations = typedIterations.filter((i) => i.step_index === stepIndex && !i.skipped);
  const latest = stepIterations[stepIterations.length - 1];
  const iterationCount = stepIterations.length;
  const sequenceDone = stepIndex >= steps.length;

  const nextRequestPreview =
    step &&
    buildCriticUserText({
      stepName: step.name,
      stepDescription: step.description,
      stepInstruction: step.instruction,
      stepIndex,
      stepCount: steps.length,
      iteration: iterationCount + 1,
      maxIterations: step.max_iterations,
      passThreshold: step.pass_threshold,
      prompt: draft,
    });

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All runs
        </Link>
        {settings.debug_mode && (
          <Button variant="outline" size="sm" onClick={() => setShowDebug((v) => !v)}>
            <Bug className="mr-2 h-4 w-4" /> {showDebug ? "Hide" : "Show"} audit trail
          </Button>
        )}
      </header>

      <h1 className="mt-4 truncate text-2xl font-semibold tracking-tight">{run.title}</h1>

      <ol className="mt-6 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              i === stepIndex && !sequenceDone
                ? "border-primary bg-primary/10 text-primary"
                : i < stepIndex
                  ? "border-border text-muted-foreground"
                  : "border-border/60 text-muted-foreground/60"
            }`}
          >
            <span className="font-mono">{String(i + 1).padStart(2, "0")}</span> {s.name}
            {i < stepIndex && <Check className="ml-1 inline h-3 w-3" />}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Your prompt</h2>
            {step && (
              <div className="flex items-center gap-1">
                {Array.from({ length: step.max_iterations }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-4 rounded-full ${
                      i < iterationCount ? "bg-primary" : "bg-border"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          {!sequenceDone && (
            <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {BETWEEN_TESTS_GUIDANCE}
            </p>
          )}
          <Textarea
            value={draft}
            rows={18}
            className="mt-3 font-mono text-sm"
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
          />

          {!sequenceDone ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => review.mutate(draft)}
                disabled={review.isPending || !draft.trim()}
              >
                {review.isPending ? "Reviewing…" : "Submit for review"}
              </Button>
              {iterationCount >= 2 && (
                <Button variant="outline" onClick={() => skip.mutate()} disabled={skip.isPending}>
                  <SkipForward className="mr-2 h-4 w-4" /> Skip to next test
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Iteration {Math.min(iterationCount + 1, step?.max_iterations ?? 4)} of{" "}
                {step?.max_iterations ?? 4}
              </span>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
                <Sparkles className="mr-2 h-4 w-4" />
                {finalize.isPending ? "Thinking…" : `Send to ${settings.final_model}`}
              </Button>
              <span className="text-xs text-muted-foreground">
                All tests complete. This can take a few minutes.
              </span>
            </div>
          )}
        </section>

        <section className="space-y-4">
          {step && (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
                Test {stepIndex + 1} / {steps.length}
              </p>
              <h2 className="mt-1 text-lg font-medium">{step.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
            </div>
          )}

          {latest && (
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Badge variant={latest.passed ? "default" : "secondary"}>
                  {latest.passed ? "Passed" : "Needs work"}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  score {latest.score ?? "—"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{latest.diagnosis}</p>
              {latest.questions.length > 0 && (
                <>
                  <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                    Questions to answer in your prompt
                  </p>
                  <ul className="mt-2 space-y-2">
                    {latest.questions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="font-mono text-primary">{i + 1}.</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {sequenceDone && !run.final_answer && !latest && (
            <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
              The sequence is complete. Send the prompt to the powerful model when ready.
            </div>
          )}

          {run.final_answer && (
            <div className="rounded-lg border border-primary/40 bg-card p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
                Final answer · {run.final_model}
              </p>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {run.final_answer}
              </div>
            </div>
          )}
        </section>
      </div>

      {settings.debug_mode && showDebug && (
        <section className="mt-10 rounded-lg border border-border bg-card p-5">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
            Debug — auditable AI traffic
          </h2>
          {nextRequestPreview && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                Next request preview · model {settings.critic_model} · history is never sent
              </p>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                {`— SYSTEM / INSTRUCTIONS —\n${settings.critic_instruction}\n\n— USER —\n${nextRequestPreview}`}
              </pre>
            </div>
          )}
          <Accordion type="single" collapsible className="mt-4">
            {(aiCalls as AiCallRow[]).map((call) => (
              <AccordionItem key={call.id} value={call.id}>
                <AccordionTrigger className="text-xs">
                  <span className="font-mono">
                    {call.kind} · {call.model} · {new Date(call.created_at).toLocaleString()}
                    {call.error_text ? " · ERROR" : ""}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <pre className="max-h-96 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                    {`— REQUEST PARAMS —\n${JSON.stringify(call.request_params, null, 2)}\n\n— SYSTEM / INSTRUCTIONS —\n${call.system_text}\n\n— USER —\n${call.user_text}\n\n— RESPONSE (${call.latency_ms ?? "?"} ms) —\n${call.error_text ?? call.raw_response ?? ""}`}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      {typedIterations.length > 0 && (
        <section className="mt-10">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            History
          </h2>
          <ul className="mt-3 space-y-2">
            {typedIterations.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs"
              >
                <span className="font-mono text-primary">
                  {String(it.step_index + 1).padStart(2, "0")}.{it.iteration_number}
                </span>
                <span className="flex-1 truncate">{it.step_name}</span>
                <span className="text-muted-foreground">
                  {it.skipped ? "skipped" : it.passed ? "passed" : `score ${it.score ?? "—"}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
