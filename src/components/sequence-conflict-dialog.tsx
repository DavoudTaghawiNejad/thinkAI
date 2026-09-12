import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { resolveSequenceConflict } from "@/lib/refine.functions";
import type { SequenceConflict } from "@/lib/refine.shared";

/**
 * Shown when an admin published a new version of a test sequence the user had
 * already edited. Their version was never touched — it just can't keep the name
 * while the new one also wants it, so they pick: rename theirs, or drop it.
 *
 * Conflicts are handled one at a time. Closing the dialog is allowed; it comes
 * back on the next visit until every one is settled.
 */
export function SequenceConflictDialog({ conflicts }: { conflicts: SequenceConflict[] }) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");

  const conflict = conflicts[0] ?? null;
  const conflictId = conflict?.id ?? null;

  useEffect(() => {
    if (conflict) setName(`${conflict.name} (mine)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictId]);

  const resolve = useMutation({
    mutationFn: (action: "rename" | "discard") =>
      resolveSequenceConflict({
        data: {
          conflictId: conflict!.id,
          action,
          ...(action === "rename" ? { newName: name } : {}),
        },
      }),
    onSuccess: async (_result, action) => {
      await queryClient.invalidateQueries();
      toast.success(
        action === "rename"
          ? `Kept your version as "${name.trim()}".`
          : "Replaced with the updated version.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!conflict) return null;

  return (
    <Dialog open={!dismissed} onOpenChange={(open) => setDismissed(!open)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>&ldquo;{conflict.name}&rdquo; has been updated</DialogTitle>
          <DialogDescription>
            An admin published a new version of this test sequence. You had changed your copy, so
            nothing of yours was overwritten — but both versions want the same name. Give yours a
            new one to keep it, or drop it and take the update.
            {conflicts.length > 1 && ` (1 of ${conflicts.length} to settle.)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs">A new name for your version</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${conflict.name} (mine)`}
          />
          <p className="text-xs text-muted-foreground">
            The updated version will then be called &ldquo;{conflict.name}&rdquo;.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={resolve.isPending}>
                Discard mine
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard your version?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your edited &ldquo;{conflict.mineName}&rdquo; and all its tests are deleted, and
                  the updated version takes its place. Runs already finished keep the tests they ran
                  against. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={() => resolve.mutate("discard")}
                >
                  Discard mine
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            onClick={() => resolve.mutate("rename")}
            disabled={!name.trim() || resolve.isPending}
          >
            {resolve.isPending ? "Saving…" : "Keep & rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
