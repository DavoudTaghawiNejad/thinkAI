import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadSettings, loadSteps } = await import("./forge.server");
    const [settings, steps] = await Promise.all([
      loadSettings(context.supabase as never, context.userId),
      loadSteps(context.supabase as never, context.userId),
    ]);
    return { settings, steps };
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("runs")
      .select("id, title, status, step_index, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { loadRun } = await import("./forge.server");
    return loadRun(context.supabase as never, context.userId, data.runId);
  });

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ prompt: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const title = data.prompt.trim().split("\n")[0]!.slice(0, 80) || "Untitled prompt";
    const { data: run, error } = await context.supabase
      .from("runs")
      .insert({
        user_id: context.userId,
        title,
        original_prompt: data.prompt,
        current_prompt: data.prompt,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return run;
  });

export const deleteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("runs")
      .delete()
      .eq("id", data.runId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reviewPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ runId: z.string().uuid(), prompt: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { runReview } = await import("./forge.server");
    return runReview(context.supabase as never, context.userId, data);
  });

export const skipCurrentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ runId: z.string().uuid(), prompt: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { skipStep } = await import("./forge.server");
    return skipStep(context.supabase as never, context.userId, data);
  });

export const generateFinalAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { runFinal } = await import("./forge.server");
    return runFinal(context.supabase as never, context.userId, data);
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        critic_instruction: z.string().min(1),
        critic_model: z.string().min(1),
        final_model: z.string().min(1),
        debug_mode: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        steps: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().min(1),
              description: z.string(),
              instruction: z.string().min(1),
              pass_threshold: z.number().int().min(0).max(100),
              max_iterations: z.number().int().min(1).max(20),
            }),
          )
          .min(1),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const rows = data.steps.map((step, index) => ({
      id: step.id && step.id.length === 36 ? step.id : undefined,
      user_id: context.userId,
      name: step.name,
      description: step.description,
      instruction: step.instruction,
      pass_threshold: step.pass_threshold,
      max_iterations: step.max_iterations,
      position: index,
    }));
    const keepIds = rows.map((r) => r.id).filter(Boolean) as string[];
    let del = context.supabase.from("test_steps").delete().eq("user_id", context.userId);
    if (keepIds.length) del = del.not("id", "in", `(${keepIds.join(",")})`);
    const { error: deleteError } = await del;
    if (deleteError) throw new Error(deleteError.message);

    const { error } = await context.supabase
      .from("test_steps")
      .upsert(rows.map((r) => (r.id ? r : { ...r, id: undefined })) as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const askClarification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        question: z.string().default(""),
        message: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { askClarify } = await import("./forge.server");
    return askClarify(context.supabase as never, context.userId, data);
  });
