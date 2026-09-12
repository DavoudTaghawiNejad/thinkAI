import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Asked once, of a profile whose name was guessed at signup rather than given.
 * The guess is the suggestion in the field, so the shortest way through is to
 * accept it — but it cannot be emptied, and there is no way to dismiss without
 * answering: a name is asked for exactly once, so asking has to land.
 */
export function NameDialog({
  open,
  suggestion,
  saving,
  onSave,
}: {
  open: boolean;
  suggestion: string | null;
  saving: boolean;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(suggestion ?? "");

  // The suggestion arrives with the workspace, which may load after the dialog
  // is first rendered.
  useEffect(() => {
    if (open) setName(suggestion ?? "");
  }, [open, suggestion]);

  const trimmed = name.trim();

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>What should we call you?</DialogTitle>
          <DialogDescription>
            Your name is shown in the corner of the workbench. Nobody else sees it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) onSave(trimmed);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Your name</Label>
            <Input
              id="displayName"
              value={name}
              autoFocus
              required
              maxLength={80}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={!trimmed || saving}>
            Continue
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
