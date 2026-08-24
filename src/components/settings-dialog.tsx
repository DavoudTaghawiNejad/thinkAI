import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resetToDefaults, saveSettings, saveSteps } from "@/lib/forge.functions";
import { CRITIC_MODELS, FINAL_MODELS, type Settings, type TestStep } from "@/lib/forge.shared";

type DraftStep = {
  id?: string;
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
};

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  steps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  steps: TestStep[];
}) {
  const queryClient = useQueryClient();
  const [draftSettings, setDraftSettings] = useState<Settings>(settings);
  const [draftSteps, setDraftSteps] = useState<DraftStep[]>(steps);

  useEffect(() => {
    if (open) {
      setDraftSettings(settings);
      setDraftSteps(steps.map((s) => ({ ...s })));
    }
  }, [open, settings, steps]);

  const save = useMutation({
    mutationFn: async () => {
      await saveSettings({ data: draftSettings });
      await saveSteps({
        data: {
          steps: draftSteps.map((s) => ({
            ...(s.id ? { id: s.id } : {}),
            name: s.name,
            description: s.description,
            instruction: s.instruction,
            pass_threshold: s.pass_threshold,
            max_iterations: s.max_iterations,
          })),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Settings saved.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: () => resetToDefaults(),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Settings reset to defaults.");
      // Dialog stays open: fresh settings/steps flow back through props, and the
      // effect above re-syncs draftSettings/draftSteps from them while open.
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraftSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function move(index: number, delta: number) {
    setDraftSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forge settings</DialogTitle>
          <DialogDescription>
            Define the sequence of tests every prompt must survive, and the models behind them.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="sequence">
          <TabsList>
            <TabsTrigger value="sequence">Test sequence</TabsTrigger>
            <TabsTrigger value="models">Models &amp; instruction</TabsTrigger>
          </TabsList>

          <TabsContent value="sequence" className="space-y-4 pt-4">
            {draftSteps.map((step, index) => (
              <div key={step.id ?? `new-${index}`} className="rounded-md border border-border p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Input
                    value={step.name}
                    onChange={(e) => updateStep(index, { name: e.target.value })}
                    placeholder="Test name"
                    className="font-medium"
                  />
                  <Button variant="ghost" size="icon" onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDraftSteps((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  <Input
                    value={step.description}
                    onChange={(e) => updateStep(index, { description: e.target.value })}
                    placeholder="Short description shown to the author"
                  />
                  <Textarea
                    value={step.instruction}
                    onChange={(e) => updateStep(index, { instruction: e.target.value })}
                    placeholder="Instruction sent to the reviewing AI for this test"
                    rows={4}
                    className="font-mono text-xs"
                  />
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Max iterations</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={step.max_iterations}
                        onChange={(e) =>
                          updateStep(index, { max_iterations: Number(e.target.value) || 1 })
                        }
                        className="w-28"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Pass threshold</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={step.pass_threshold}
                        onChange={(e) =>
                          updateStep(index, { pass_threshold: Number(e.target.value) || 0 })
                        }
                        className="w-28"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setDraftSteps((prev) => [
                  ...prev,
                  {
                    name: "New test",
                    description: "",
                    instruction: "Test the draft prompt for ...",
                    pass_threshold: 80,
                    max_iterations: 4,
                  },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add test
            </Button>
          </TabsContent>

          <TabsContent value="models" className="space-y-5 pt-4">
            <div className="space-y-1.5">
              <Label>Global critic instruction</Label>
              <p className="text-xs text-muted-foreground">
                Sent as the system text on every review call. This is where the
                questions-not-suggestions rule lives.
              </p>
              <Textarea
                rows={9}
                className="font-mono text-xs"
                value={draftSettings.critic_instruction}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, critic_instruction: e.target.value })
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Reviewing model (fast)</Label>
                <Select
                  value={draftSettings.critic_model}
                  onValueChange={(v) => setDraftSettings({ ...draftSettings, critic_model: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRITIC_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Final answer model</Label>
                <Select
                  value={draftSettings.final_model}
                  onValueChange={(v) => setDraftSettings({ ...draftSettings, final_model: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINAL_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-4">
              <div>
                <Label>Debug mode</Label>
                <p className="text-xs text-muted-foreground">
                  Show the complete, auditable text of every request sent to the AI.
                </p>
              </div>
              <Switch
                checked={draftSettings.debug_mode}
                onCheckedChange={(v) => setDraftSettings({ ...draftSettings, debug_mode: v })}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between gap-2 pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={save.isPending || reset.isPending}>
                Reset to defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset settings to defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  This overwrites your critic instruction, models, debug mode, and entire test
                  sequence with the server's current default configuration. Your existing settings
                  and test steps are permanently replaced. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={() => reset.mutate()}
                >
                  Reset to defaults
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
