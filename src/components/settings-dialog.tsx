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
  Globe,
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
  setNewUserDefault,
  publishSequence,
  withdrawSequence,
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

  // Which sequence the editor below is showing. Purely a view choice — what the
  // profile actually runs is its default, set with the star.
  const [sequenceId, setSequenceId] = useState<string | null>(settings.default_sequence_id);
  const [draft, setDraft] = useState<SequenceDraft | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Instructions sit above the tests but start collapsed: they are set once and
  // rarely revisited, while the tests are what people come here to edit.
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const [share, setShare] = useState<{ yaml: string; text: string; name: string } | null>(null);
  // Duplicating asks for a name: the copy cannot keep the original's, and a
  // general sequence's name is taken for everyone.
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [recipient, setRecipient] = useState(shareRecipient);

  const selected = useMemo(
    () => sequences.find((s) => s.id === sequenceId) ?? null,
    [sequences, sequenceId],
  );
  // You edit your own sequences, all of them, always. General ones are editable
  // by nobody — an admin changes one by re-publishing the personal sequence it
  // came from. Duplicate to get a version of your own.
  const editable = Boolean(selected?.owned);

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
  // workspace refetch — Make default, Duplicate, Publish — and
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
      settings.default_sequence_id ??
      sequences.find((s) => s.isDefault)?.id ??
      sequences[0]?.id ??
      null;
    setSequenceId(seeded);
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
    draftSettings.debug_mode !== settings.debug_mode;

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
    setDraft(draftFor(sequenceId));
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
      await saveSettings({ data: draftSettings });
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
    mutationFn: () => duplicateSequence({ data: { id: sequenceId!, name: duplicateName!.trim() } }),
    onSuccess: async (r: { id: string; name: string }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(r.id);
      setDuplicateName(null);
      toast.success(`Created “${r.name}”.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** The name offered for a copy: the original plus "private". */
  function proposeDuplicateName(base: string) {
    setDuplicateName(`${base} private`);
  }

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

  const newUserDefault = useMutation({
    mutationFn: () => setNewUserDefault({ data: { id: sequenceId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("New profiles will start with this sequence.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publish = useMutation({
    mutationFn: () => publishSequence({ data: { id: sequenceId! } }),
    onSuccess: async (r: { created: boolean }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(
        r.created
          ? "Published — everyone can use it now."
          : "The general version has been updated.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdraw = useMutation({
    mutationFn: () => withdrawSequence({ data: { id: sequenceId! } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setSequenceId(null);
      toast.success("Withdrawn from the general sequences.");
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
              {selected && !selected.owned && (
                <span className="flex items-center gap-1.5 text-right text-xs text-muted-foreground">
                  <Globe className="h-3 w-3 shrink-0" />A general sequence — shared with everyone
                  and not editable. Duplicate it to make a version of your own.
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
                          {s.isDefault ? " · your default" : ""}
                          {s.publishedAsGeneral ? " · published" : ""}
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
                          {s.isDefault ? " · your default" : ""}
                          {s.isNewUserDefault ? " · new profiles start here" : ""}
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
                title="Run this sequence by default"
              >
                <Star className={`mr-2 h-4 w-4 ${selected?.isDefault ? "fill-current" : ""}`} />
                {selected?.isDefault ? "Default" : "Make default"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!selected || duplicate.isPending}
                onClick={() => selected && proposeDuplicateName(selected.name)}
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
                        If it is your default, thinkAI falls back to the general sequence new
                        profiles start with.
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

                {selected.owned ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={publish.isPending || dirty}>
                            <UploadCloud className="mr-2 h-4 w-4" />
                            {publish.isPending
                              ? "Publishing…"
                              : selected.publishedAsGeneral
                                ? "Update the general version"
                                : "Publish as a general sequence"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {selected.publishedAsGeneral
                                ? `Update the general “${selected.name}”?`
                                : `Publish “${selected.name}” to everyone?`}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {selected.publishedAsGeneral
                                ? "The general version of this sequence is rewritten with what you have saved here. Everyone using it follows the update, including runs already under way. Your own copy stays yours to keep editing."
                                : "A general sequence is created from what you have saved here — instructions and tests together. Every profile can then use it, and nobody can edit it, you included. Your own copy stays yours to keep editing; publish again to update the general version."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => publish.mutate()}>
                              {selected.publishedAsGeneral ? "Update it" : "Publish"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Editing this sequence changes nothing for anyone else — only publishing does.
                      {dirty && " Save your changes first; publishing sends the saved version."}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        disabled={selected.isNewUserDefault || newUserDefault.isPending}
                        onClick={() => newUserDefault.mutate()}
                      >
                        <Star
                          className={`mr-2 h-4 w-4 ${selected.isNewUserDefault ? "fill-current" : ""}`}
                        />
                        {selected.isNewUserDefault
                          ? "New profiles start here"
                          : "Make it what new profiles start with"}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            disabled={selected.isNewUserDefault || withdraw.isPending}
                            title={
                              selected.isNewUserDefault
                                ? "Mark another general sequence for new profiles first"
                                : undefined
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Withdraw
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Withdraw &ldquo;{selected.name}&rdquo; from everyone?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              It stops being available to every profile, and anyone whose default it
                              was falls back to the sequence new profiles start with. Runs already
                              finished keep the tests they ran against. Nobody&rsquo;s own sequences
                              are touched, and the personal sequence it was published from is left
                              alone. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className={buttonVariants({ variant: "destructive" })}
                              onClick={() => withdraw.mutate()}
                            >
                              Withdraw
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      General sequences are not edited in place. To change this one, publish the
                      personal sequence it came from again.
                    </p>
                  </>
                )}
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

      <Dialog open={duplicateName != null} onOpenChange={(o) => !o && setDuplicateName(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Duplicate &ldquo;{selected?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              The copy is yours — instructions and tests together — and you can edit it freely. It
              needs a name of its own: one name, one sequence.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">Name for your copy</Label>
            <Input
              autoFocus
              value={duplicateName ?? ""}
              onChange={(e) => setDuplicateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && duplicateName?.trim() && !duplicate.isPending)
                  duplicate.mutate();
              }}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDuplicateName(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => duplicate.mutate()}
              disabled={!duplicateName?.trim() || duplicate.isPending}
            >
              {duplicate.isPending ? "Duplicating…" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
