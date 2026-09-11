import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, Share2, Download, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  resetToDefaults,
  saveSettings,
  savePreset,
  deletePreset,
  duplicatePreset,
  saveSequence,
  deleteSequence,
  duplicateSequence,
} from "@/lib/forge.functions";
import {
  CRITIC_MODELS,
  FINAL_MODELS,
  buildMailto,
  buildShareText,
  presetToYaml,
  sequenceToYaml,
  type InstructionPreset,
  type Settings,
  type TestSequence,
  type TestStep,
} from "@/lib/forge.shared";

type DraftStep = {
  id?: string;
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
};

type PresetDraft = { name: string; critic_instruction: string; final_instruction: string };
type SequenceDraft = { name: string; steps: DraftStep[] };

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shared";
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  presets,
  sequences,
  shareRecipient,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  presets: InstructionPreset[];
  sequences: TestSequence[];
  shareRecipient: string;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [draftSettings, setDraftSettings] = useState({
    critic_model: settings.critic_model,
    final_model: settings.final_model,
    debug_mode: settings.debug_mode,
  });

  const [presetId, setPresetId] = useState<string | null>(settings.active_preset_id);
  const [sequenceId, setSequenceId] = useState<string | null>(settings.active_sequence_id);
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null);
  const [sequenceDraft, setSequenceDraft] = useState<SequenceDraft | null>(null);

  const [share, setShare] = useState<
    | { kind: "preset"; yaml: string; text: string; name: string }
    | { kind: "sequence"; yaml: string; text: string; name: string }
    | null
  >(null);
  const [recipient, setRecipient] = useState(shareRecipient);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === presetId) ?? null,
    [presets, presetId],
  );
  const selectedSequence = useMemo(
    () => sequences.find((s) => s.id === sequenceId) ?? null,
    [sequences, sequenceId],
  );
  const presetEditable = Boolean(selectedPreset && (selectedPreset.owned || isAdmin));
  const sequenceEditable = Boolean(selectedSequence && (selectedSequence.owned || isAdmin));

  // Re-seed selection + model settings whenever the dialog opens (or fresh data
  // flows back after "Reset to defaults", which keeps the dialog open).
  useEffect(() => {
    if (!open) return;
    setDraftSettings({
      critic_model: settings.critic_model,
      final_model: settings.final_model,
      debug_mode: settings.debug_mode,
    });
    setPresetId(settings.active_preset_id ?? presets[0]?.id ?? null);
    setSequenceId(settings.active_sequence_id ?? sequences[0]?.id ?? null);
    setRecipient(shareRecipient);
  }, [open, settings, presets, sequences, shareRecipient]);

  // Load the editable draft for the selected preset. Keyed on the id (not the
  // array) so an unrelated refetch doesn't wipe in-progress edits.
  useEffect(() => {
    const p = presets.find((x) => x.id === presetId);
    setPresetDraft(
      p
        ? {
            name: p.name,
            critic_instruction: p.critic_instruction,
            final_instruction: p.final_instruction,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  useEffect(() => {
    const s = sequences.find((x) => x.id === sequenceId);
    setSequenceDraft(s ? { name: s.name, steps: s.steps.map((st) => ({ ...st })) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId]);

  const presetDirty =
    selectedPreset != null &&
    presetDraft != null &&
    (presetDraft.name !== selectedPreset.name ||
      presetDraft.critic_instruction !== selectedPreset.critic_instruction ||
      presetDraft.final_instruction !== selectedPreset.final_instruction);

  const sequenceDirty =
    selectedSequence != null &&
    sequenceDraft != null &&
    JSON.stringify(sequenceDraft) !==
      JSON.stringify({ name: selectedSequence.name, steps: selectedSequence.steps });

  const save = useMutation({
    mutationFn: async () => {
      if (presetEditable && presetDirty && presetDraft) {
        await savePreset({ data: { id: presetId ?? undefined, ...presetDraft } });
      }
      if (sequenceEditable && sequenceDirty && sequenceDraft) {
        await saveSequence({
          data: {
            id: sequenceId ?? undefined,
            name: sequenceDraft.name,
            steps: sequenceDraft.steps.map((s) => ({
              name: s.name,
              description: s.description,
              instruction: s.instruction,
              pass_threshold: s.pass_threshold,
              max_iterations: s.max_iterations,
            })),
          },
        });
      }
      await saveSettings({
        data: {
          ...draftSettings,
          active_preset_id: presetId,
          active_sequence_id: sequenceId,
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
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const dupPreset = useMutation({
    mutationFn: () => duplicatePreset({ data: { id: presetId! } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setPresetId(r.id);
      toast.success("Preset duplicated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const delPreset = useMutation({
    mutationFn: () => deletePreset({ data: { id: presetId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setPresetId(null);
      toast.success("Preset deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const dupSequence = useMutation({
    mutationFn: () => duplicateSequence({ data: { id: sequenceId! } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(r.id);
      toast.success("Sequence duplicated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const delSequence = useMutation({
    mutationFn: () => deleteSequence({ data: { id: sequenceId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(null);
      toast.success("Sequence deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSequenceDraft((prev) =>
      prev
        ? { ...prev, steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
        : prev,
    );
  }
  function moveStep(index: number, delta: number) {
    setSequenceDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...prev, steps: next };
    });
  }

  function openSharePreset() {
    if (!presetDraft) return;
    setShare({
      kind: "preset",
      name: presetDraft.name,
      yaml: presetToYaml(presetDraft),
      text: buildShareText("preset", presetDraft),
    });
  }
  function openShareSequence() {
    if (!sequenceDraft) return;
    setShare({
      kind: "sequence",
      name: sequenceDraft.name,
      yaml: sequenceToYaml(sequenceDraft),
      text: buildShareText("sequence", {
        name: sequenceDraft.name,
        steps: sequenceDraft.steps as TestStep[],
      }),
    });
  }

  const ownPresets = presets.filter((p) => p.owned);
  const generalPresets = presets.filter((p) => !p.owned);
  const ownSequences = sequences.filter((s) => s.owned);
  const generalSequences = sequences.filter((s) => !s.owned);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forge settings</DialogTitle>
          <DialogDescription>
            Keep a library of model instructions and test sequences. Pick one of each as active.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="instructions">
          <TabsList>
            <TabsTrigger value="instructions">Instructions &amp; sequence</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>

          <TabsContent value="instructions" className="space-y-8 pt-4">
            {/* ---- Model instructions ---- */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Model instructions</h3>
                {selectedPreset && !selectedPreset.owned && !isAdmin && (
                  <span className="text-xs text-muted-foreground">
                    Read-only — duplicate to edit
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  {...(presetId ? { value: presetId } : {})}
                  onValueChange={setPresetId}
                >
                  <SelectTrigger className="min-w-[16rem] flex-1">
                    <SelectValue placeholder="Choose a preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {ownPresets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Your presets</SelectLabel>
                        {ownPresets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {generalPresets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>General</SelectLabel>
                        {generalPresets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!presetId || dupPreset.isPending}
                  onClick={() => dupPreset.mutate()}
                >
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!presetDraft}
                  onClick={openSharePreset}
                >
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </Button>
                {selectedPreset?.owned && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={delPreset.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{selectedPreset.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes this model-instruction preset. If it is your
                          active preset, the forge falls back to the General default.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className={buttonVariants({ variant: "destructive" })}
                          onClick={() => delPreset.mutate()}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>

              {presetDraft && (
                <div className="space-y-3 rounded-md border border-border p-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Preset name</Label>
                    <Input
                      value={presetDraft.name}
                      disabled={!presetEditable}
                      onChange={(e) =>
                        setPresetDraft({ ...presetDraft, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Critic instruction</Label>
                    <p className="text-xs text-muted-foreground">
                      Sent as the system text on every review call — the
                      questions-not-suggestions rule lives here.
                    </p>
                    <Textarea
                      rows={8}
                      className="font-mono text-xs"
                      disabled={!presetEditable}
                      value={presetDraft.critic_instruction}
                      onChange={(e) =>
                        setPresetDraft({ ...presetDraft, critic_instruction: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Final-answer instruction</Label>
                    <p className="text-xs text-muted-foreground">
                      System text for the single powerful answer once every test passes.
                    </p>
                    <Textarea
                      rows={5}
                      className="font-mono text-xs"
                      disabled={!presetEditable}
                      value={presetDraft.final_instruction}
                      onChange={(e) =>
                        setPresetDraft({ ...presetDraft, final_instruction: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ---- Test sequence ---- */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Test sequence</h3>
                {selectedSequence && !selectedSequence.owned && !isAdmin && (
                  <span className="text-xs text-muted-foreground">
                    Read-only — duplicate to edit
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  {...(sequenceId ? { value: sequenceId } : {})}
                  onValueChange={setSequenceId}
                >
                  <SelectTrigger className="min-w-[16rem] flex-1">
                    <SelectValue placeholder="Choose a sequence" />
                  </SelectTrigger>
                  <SelectContent>
                    {ownSequences.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Your sequences</SelectLabel>
                        {ownSequences.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {generalSequences.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>General</SelectLabel>
                        {generalSequences.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sequenceId || dupSequence.isPending}
                  onClick={() => dupSequence.mutate()}
                >
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sequenceDraft}
                  onClick={openShareSequence}
                >
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </Button>
                {selectedSequence?.owned && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={delSequence.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete &ldquo;{selectedSequence.name}&rdquo;?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes this test sequence and all its steps. If it is
                          your active sequence, the forge falls back to the General default.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className={buttonVariants({ variant: "destructive" })}
                          onClick={() => delSequence.mutate()}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>

              {sequenceDraft && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Sequence name</Label>
                    <Input
                      value={sequenceDraft.name}
                      disabled={!sequenceEditable}
                      onChange={(e) =>
                        setSequenceDraft({ ...sequenceDraft, name: e.target.value })
                      }
                    />
                  </div>

                  {sequenceDraft.steps.map((step, index) => (
                    <div
                      key={step.id ?? `new-${index}`}
                      className="rounded-md border border-border p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Input
                          value={step.name}
                          disabled={!sequenceEditable}
                          onChange={(e) => updateStep(index, { name: e.target.value })}
                          placeholder="Test name"
                          className="font-medium"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!sequenceEditable}
                          onClick={() => moveStep(index, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!sequenceEditable}
                          onClick={() => moveStep(index, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!sequenceEditable}
                          onClick={() =>
                            setSequenceDraft({
                              ...sequenceDraft,
                              steps: sequenceDraft.steps.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 space-y-3">
                        <Input
                          value={step.description}
                          disabled={!sequenceEditable}
                          onChange={(e) => updateStep(index, { description: e.target.value })}
                          placeholder="Short description shown to the author"
                        />
                        <Textarea
                          value={step.instruction}
                          disabled={!sequenceEditable}
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
                              disabled={!sequenceEditable}
                              value={step.max_iterations}
                              onChange={(e) =>
                                updateStep(index, {
                                  max_iterations: Number(e.target.value) || 1,
                                })
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
                              disabled={!sequenceEditable}
                              value={step.pass_threshold}
                              onChange={(e) =>
                                updateStep(index, {
                                  pass_threshold: Number(e.target.value) || 0,
                                })
                              }
                              className="w-28"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {sequenceEditable && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSequenceDraft({
                          ...sequenceDraft,
                          steps: [
                            ...sequenceDraft.steps,
                            {
                              name: "New test",
                              description: "",
                              instruction: "Test the draft prompt for ...",
                              pass_threshold: 80,
                              max_iterations: 4,
                            },
                          ],
                        })
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add test
                    </Button>
                  )}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="models" className="space-y-5 pt-4">
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
                <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  This rebuilds your personal &ldquo;My instructions&rdquo; preset and &ldquo;My
                  sequence&rdquo; from the server defaults and makes them active. Other presets and
                  sequences you created are left alone. This cannot be undone.
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

      <Dialog open={share != null} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share &ldquo;{share?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Download the YAML to attach it, then open a pre-filled email. The message body
              already contains a readable copy.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">Recipient</Label>
            <div className="flex gap-2">
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                onClick={() => setRecipient(shareRecipient)}
                disabled={recipient === shareRecipient}
              >
                {shareRecipient}
              </Button>
            </div>
          </div>

          <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
            {share?.yaml}
          </pre>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                share &&
                download(
                  `${slug(share.name)}.${share.kind === "preset" ? "preset" : "sequence"}.yaml`,
                  share.yaml,
                )
              }
            >
              <Download className="mr-2 h-4 w-4" /> Download .yaml
            </Button>
            <Button
              onClick={() => {
                if (!share) return;
                window.location.href = buildMailto({
                  to: recipient,
                  subject: `Prompt Forge ${share.kind}: ${share.name}`,
                  body: `${share.text}\n\n---\nYAML (attach the downloaded file, or copy this):\n\n${share.yaml}`,
                });
              }}
              disabled={!recipient.trim()}
            >
              <Mail className="mr-2 h-4 w-4" /> Open email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
