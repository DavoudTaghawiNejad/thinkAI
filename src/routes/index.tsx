import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2, LogOut, ArrowRight, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsDialog } from "@/components/settings-dialog";
import { createRun, deleteRun, getWorkspace, listRuns } from "@/lib/forge.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prompt Forge — refine a problem before you ask" },
      {
        name: "description",
        content:
          "Prompt Forge puts your problem statement through a configurable sequence of AI review tests, then sends the survivor to a powerful model.",
      },
      { property: "og:title", content: "Prompt Forge — refine a problem before you ask" },
      {
        property: "og:description",
        content:
          "A prompt workbench: staged AI tests, refinement questions instead of suggestions, then one powerful answer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, loading } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => getWorkspace(),
    enabled: Boolean(session),
  });

  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => listRuns(),
    enabled: Boolean(session),
  });

  const start = useMutation({
    mutationFn: () => createRun({ data: { prompt } }),
    onSuccess: (run) => navigate({ to: "/run/$runId", params: { runId: run.id } }),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (runId: string) => deleteRun({ data: { runId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });

  if (loading || !session) return null;

  const steps = workspace.data?.steps ?? [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <span className="font-mono text-xs uppercase tracking-[0.35em] text-primary">
            Prompt Forge
          </span>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Refine the question before you ask it.
          </h1>
        </div>
        <div className="flex gap-2">
          {workspace.data && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Settings
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="mt-10 rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-medium">Your problem statement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Write it roughly. The forge will interrogate it, one test at a time.
        </p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          placeholder="Describe the problem or knowledge question you want answered…"
          className="mt-4 font-mono text-sm"
        />
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {steps.length > 0
              ? `${steps.length} tests queued: ${steps.map((s) => s.name).join(" → ")}`
              : "Loading your test sequence…"}
          </p>
          <Button onClick={() => start.mutate()} disabled={!prompt.trim() || start.isPending}>
            Start forging <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Previous runs
        </h2>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {(runs.data ?? []).map((run) => (
            <li key={run.id} className="flex items-center gap-3 px-4 py-3">
              <Link
                to="/run/$runId"
                params={{ runId: run.id }}
                className="min-w-0 flex-1 truncate text-sm hover:text-primary"
              >
                {run.title}
              </Link>
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {run.status}
              </span>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(run.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {runs.data && runs.data.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted-foreground">No runs yet.</li>
          )}
        </ul>
      </section>

      {workspace.data && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={workspace.data.settings}
          steps={workspace.data.steps}
        />
      )}
    </main>
  );
}
