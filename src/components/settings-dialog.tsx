import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Share2,
  Download,
  Mail,
  Star,
  UploadCloud,
  ChevronRight,
  FileUp,
  Lock,
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  saveSequence,
  deleteSequence,
  duplicateSequence,
  setDefaultSequence,
  setSequenceNewUserRole,
  pushSequenceToAll,
  importSequenceYaml,
} from "@/lib/refine.functions";
import {
  CRITIC_MODELS,
  FINAL_MODELS,
  buildMailto,
  buildShareText,
  sequenceToYaml,
  type Settings,
  type TestSequence,
} from "@/lib/refine.shared";

type DraftStep = {
  id?: string;
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
};

/**
 * A sequence is one package: the instructions the models are given and the tests
 * they are used for. They are drafted, saved and shared together — never apart.
 */
type SequenceDraft = {
  name: string;
  critic_instruction: string;
  final_instruction: string;
  steps: DraftStep[];
};

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "shared"
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  sequences,
  shareRecipient,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
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

  const [sequenceId, setSequenceId] = useState<string | null>(settings.active_sequence_id);
  const [draft, setDraft] = useState<SequenceDraft | null>(null);
  // What the selection was when the dialog opened. Comparing against this rather
  // than settings.active_sequence_id avoids a phantom "unsaved change" when a
  // profile with nothing active gets a fallback selection on open.
  const [openedWithSequenceId, setOpenedWithSequenceId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Instructions sit above the tests but start collapsed: they are set once and
  // rarely revisited, while the tests are what people come here to edit.
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const [share, setShare] = useState<{ yaml: string; text: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [recipient, setRecipient] = useState(shareRecipient);

  const selected = useMemo(
    () => sequences.find((s) => s.id === sequenceId) ?? null,
    [sequences, sequenceId],
  );
  // A sequence an admin delivered — pushed out, or seeded at signup — stays
  // exactly as delivered. Duplicate it to get a version you can change. An admin
  // editing a General sequence is a different thing, and still allowed.
  const editable = Boolean(
    selected && ((selected.owned && !selected.fromAdmin) || (!selected.owned && isAdmin)),
  );

  const draftFor = (id: string | null): SequenceDraft | null => {
    const s = sequences.find((x) => x.id === id);
    return s
      ? {
          name: s.name,
          critic_instruction: s.critic_instruction,
          final_instruction: s.final_instruction,
          steps: s.steps.map((st) => ({ ...st })),
        }
      : null;
  };

  // Seed selection + model settings when the dialog opens, and again after
  // "Reset to defaults" (which keeps it open and replaces the data underneath).
  //
  // Deliberately NOT keyed on `sequences`/`settings`: those change on every
  // workspace refetch — Make default, Duplicate, Push, a role change — and
  // re-seeding then would snap the selection back and reload the draft under
  // someone mid-edit, throwing their work away without asking.
  const [reseedToken, setReseedToken] = useState(0);
  useEffect(() => {
    if (!open) return;
    setDraftSettings({
      critic_model: settings.critic_model,
      final_model: settings.final_model,
      debug_mode: settings.debug_mode,
    });
    const seeded =
      settings.active_sequence_id ??
      sequences.find((s) => s.isDefault)?.id ??
      sequences[0]?.id ??
      null;
    setSequenceId(seeded);
    setOpenedWithSequenceId(seeded);
    setDraft(draftFor(seeded));
    setRecipient(shareRecipient);
    setInstructionsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reseedToken]);

  // Load the editable draft for the selection. Keyed on the id (not the array)
  // so an unrelated refetch doesn't wipe in-progress edits.
  useEffect(() => {
    setDraft(draftFor(sequenceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId]);

  const dirty =
    selected != null &&
    draft != null &&
    JSON.stringify(draft) !==
      JSON.stringify({
        name: selected.name,
        critic_instruction: selected.critic_instruction,
        final_instruction: selected.final_instruction,
        steps: selected.steps,
      });

  const settingsChanged =
    draftSettings.critic_model !== settings.critic_model ||
    draftSettings.final_model !== settings.final_model ||
    draftSettings.debug_mode !== settings.debug_mode ||
    sequenceId !== openedWithSequenceId;

  /** Anything the Save button would actually write. */
  const unsaved = (editable && dirty) || settingsChanged;

  /**
   * Closing with unsaved work asks first, rather than silently dropping it.
   * Everything that can dismiss the dialog — Cancel, the X, Escape, a click
   * outside — comes through here.
   */
  function requestClose(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (unsaved && !save.isPending) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  }

  /** Throw the edits away and close, leaving the dialog clean for next time. */
  function discardAndClose() {
    setDraftSettings({
      critic_model: settings.critic_model,
      final_model: settings.final_model,
      debug_mode: settings.debug_mode,
    });
    setSequenceId(openedWithSequenceId);
    setDraft(draftFor(openedWithSequenceId));
    setConfirmClose(false);
    onOpenChange(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editable && dirty && draft) {
        await saveSequence({
          data: {
            id: sequenceId ?? undefined,
            name: draft.name,
            critic_instruction: draft.critic_instruction,
            final_instruction: draft.final_instruction,
            steps: draft.steps.map((s) => ({
              name: s.name,
              description: s.description,
              instruction: s.instruction,
              pass_threshold: s.pass_threshold,
              max_iterations: s.max_iterations,
            })),
          },
        });
      }
      await saveSettings({ data: { ...draftSettings, active_sequence_id: sequenceId } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Settings saved.");
      setConfirmClose(false);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: () => resetToDefaults(),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      // The rebuilt sequence replaces what the dialog was showing, so re-seed
      // from the fresh data rather than leaving a draft of a deleted row.
      setReseedToken((n) => n + 1);
      toast.success("Settings reset to defaults.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = useMutation({
    mutationFn: () => duplicateSequence({ data: { id: sequenceId! } }),
    onSuccess: async (r: { id: string }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(r.id);
      toast.success("Sequence duplicated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteSequence({ data: { id: sequenceId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(null);
      toast.success("Sequence deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importYaml = useMutation({
    mutationFn: () => importSequenceYaml({ data: { yaml: importText } }),
    onSuccess: async (r: { id: string; name: string }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(r.id);
      setImportOpen(false);
      setImportText("");
      toast.success(`Imported “${r.name}”.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const makeDefault = useMutation({
    mutationFn: () => setDefaultSequence({ data: { id: sequenceId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Default sequence set.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const newUserRole = useMutation({
    mutationFn: (role: "default" | "alternative" | null) =>
      setSequenceNewUserRole({ data: { id: sequenceId!, role } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("New-account role updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pushAll = useMutation({
    mutationFn: () => pushSequenceToAll({ data: { id: sequenceId! } }),
    onSuccess: async (r: { added: number; replaced: number; conflicted: number }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      const parts = [
        r.added > 0 ? `${r.added} added` : "",
        r.replaced > 0 ? `${r.replaced} updated` : "",
        r.conflicted > 0 ? `${r.conflicted} asked to rename theirs` : "",
      ].filter(Boolean);
      toast.success(
        parts.length > 0 ? `Pushed: ${parts.join(", ")}.` : "Every profile was already up to date.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((prev) =>
      prev
        ? { ...prev, steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
        : prev,
    );
  }
  function moveStep(index: number, delta: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...prev, steps: next };
    });
  }

  function openShare() {
    if (!draft) return;
    setShare({ name: draft.name, yaml: sequenceToYaml(draft), text: buildShareText(draft) });
  }

  const ownSequences = sequences.filter((s) => s.owned);
  const generalSequences = sequences.filter((s) => !s.owned);

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>thinkAI settings</DialogTitle>
          <DialogDescription>
            A test sequence is one package: the instructions your models are given and the tests
            they are used for. Keep a library of them and pick one as your default.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="sequence">
          <TabsList>
            <TabsTrigger value="sequence">Test sequence</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>

          <TabsContent value="sequence" className="space-y-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Test sequence</h3>
              {selected && !selected.owned && !isAdmin && (
                <span className="text-xs text-muted-foreground">Read-only — duplicate to edit</span>
              )}
              {selected?.fromAdmin && (
                <span className="flex items-center gap-1.5 text-right text-xs text-muted-foreground">
                  <Lock className="h-3 w-3 shrink-0" />
                  Provided by an admin, so it stays as delivered. Duplicate it to make a version you
                  can change.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select {...(sequenceId ? { value: sequenceId } : {})} onValueChange={setSequenceId}>
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
                          {s.isDefault ? " · default" : ""}
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
                          {s.isDefault ? " · default" : ""}
                          {s.newUserRole === "default" ? " · new-account default" : ""}
                          {s.newUserRole === "alternative" ? " · new-account alternative" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                disabled={!selected || selected.isDefault || makeDefault.isPending}
                onClick={() => makeDefault.mutate()}
                title="Pre-select this sequence on the home page"
              >
                <Star className={`mr-2 h-4 w-4 ${selected?.isDefault ? "fill-current" : ""}`} />
                {selected?.isDefault ? "Default" : "Make default"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!sequenceId || duplicate.isPending}
                onClick={() => duplicate.mutate()}
              >
                <Copy className="mr-2 h-4 w-4" /> Duplicate
              </Button>
              <Button variant="outline" size="sm" disabled={!draft} onClick={openShare}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp className="mr-2 h-4 w-4" /> Import YAML
              </Button>
              {selected?.owned && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={remove.isPending}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &ldquo;{selected.name}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes this sequence — its instructions and all its tests.
                        If it is your active sequence, thinkAI falls back to the General default.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className={buttonVariants({ variant: "destructive" })}
                        onClick={() => remove.mutate()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {isAdmin && selected && (
              <div className="space-y-3 rounded-md border border-dashed border-border p-4">
                <h4 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Admin
                </h4>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[14rem] flex-1 space-y-1.5">
                    <Label className="text-xs">What new accounts start with</Label>
                    <Select
                      value={selected.newUserRole ?? "none"}
                      onValueChange={(v) =>
                        newUserRole.mutate(v === "none" ? null : (v as "default" | "alternative"))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not used for new accounts</SelectItem>
                        <SelectItem value="default">New-account default</SelectItem>
                        <SelectItem value="alternative">New-account alternative</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={pushAll.isPending || dirty}>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {pushAll.isPending ? "Pushing…" : "Push to all profiles"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Push &ldquo;{selected.name}&rdquo; to every profile?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Every other profile gets a copy of this sequence — instructions and tests
                          together. Anyone whose existing copy is still as you gave it has it
                          overwritten, and the version it held is dropped. Anyone who has made a
                          sequence of their own under this name keeps it exactly as it is, and is
                          asked to rename it on their next visit instead. A run already under way
                          follows the new wording.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => pushAll.mutate()}>
                          Push to all profiles
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <p className="text-xs text-muted-foreground">
                  The new-account default becomes a new profile&rsquo;s active sequence; the
                  alternative is copied in alongside it. Either may be one of your own sequences —
                  new accounts receive a copy, not your original.
                  {dirty && " Save your changes before pushing — the push sends the saved version."}
                </p>
              </div>
            )}

            {draft && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sequence name</Label>
                  <Input
                    value={draft.name}
                    disabled={!editable}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>

                {/* Instructions: part of the package, above the tests, collapsed by default. */}
                <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md border border-border px-4 py-3 text-left hover:bg-muted/50"
                    >
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition-transform ${instructionsOpen ? "rotate-90" : ""}`}
                      />
                      <span className="text-sm font-medium">Model instructions</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {instructionsOpen
                          ? "Hide"
                          : "How the reviewer and the answerer are briefed"}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 rounded-b-md border border-t-0 border-border p-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Critic instruction</Label>
                      <p className="text-xs text-muted-foreground">
                        Sent as the system text on every review call — the questions-not-suggestions
                        rule lives here.
                      </p>
                      <Textarea
                        rows={8}
                        className="font-mono text-xs"
                        disabled={!editable}
                        value={draft.critic_instruction}
                        onChange={(e) => setDraft({ ...draft, critic_instruction: e.target.value })}
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
                        disabled={!editable}
                        value={draft.final_instruction}
                        onChange={(e) => setDraft({ ...draft, final_instruction: e.target.value })}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {draft.steps.map((step, index) => (
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
                        disabled={!editable}
                        onChange={(e) => updateStep(index, { name: e.target.value })}
                        placeholder="Test name"
                        className="font-medium"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!editable}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!editable}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!editable}
                        onClick={() =>
                          setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-3 space-y-3">
                      <Input
                        value={step.description}
                        disabled={!editable}
                        onChange={(e) => updateStep(index, { description: e.target.value })}
                        placeholder="Short description shown to the author"
                      />
                      <Textarea
                        value={step.instruction}
                        disabled={!editable}
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
                            disabled={!editable}
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
                            disabled={!editable}
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

                {editable && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [
                          ...draft.steps,
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
                  This rebuilds your personal &ldquo;My sequence&rdquo; — instructions and tests —
                  from the server defaults and makes it your default. Other sequences you created
                  are left alone. This cannot be undone.
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
            <Button variant="ghost" onClick={() => requestClose(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </DialogContent>

      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) setImportText("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a test sequence</DialogTitle>
            <DialogDescription>
              Paste a YAML document, or pick a .yaml file — the same format Share produces, with the
              instructions and the tests together. It arrives as a new sequence of your own, which
              you can edit freely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">YAML file</Label>
            <Input
              type="file"
              accept=".yaml,.yml,text/yaml,application/x-yaml,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setImportText(await file.text());
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">…or paste it here</Label>
            <Textarea
              rows={12}
              className="font-mono text-[11px]"
              placeholder={
                "name: My sequence\ncritic_instruction: …\nfinal_instruction: …\nsteps:\n  - name: Clarity\n    instruction: …"
              }
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importYaml.mutate()}
              disabled={!importText.trim() || importYaml.isPending}
            >
              {importYaml.isPending ? "Importing…" : "Create sequence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to{" "}
              {editable && dirty && settingsChanged
                ? `“${draft?.name ?? "this sequence"}” and your settings`
                : editable && dirty
                  ? `“${draft?.name ?? "this sequence"}”`
                  : "your settings"}
              . Closing without saving discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-between">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <div className="flex gap-2">
              <Button variant="outline" onClick={discardAndClose} disabled={save.isPending}>
                Discard
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={share != null} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share &ldquo;{share?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              The whole package — instructions and tests — goes as one document. Download the YAML
              to attach it, then open a pre-filled email; the body already contains a readable copy.
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
                title={shareRecipient}
              >
                Admin
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Goes to the admin ({shareRecipient}) unless you type a different address.
            </p>
          </div>

          <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
            {share?.yaml}
          </pre>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => share && download(`${slug(share.name)}.sequence.yaml`, share.yaml)}
            >
              <Download className="mr-2 h-4 w-4" /> Download .yaml
            </Button>
            <Button
              onClick={() => {
                if (!share) return;
                window.location.href = buildMailto({
                  to: recipient,
                  subject: `thinkAI test sequence: ${share.name}`,
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
