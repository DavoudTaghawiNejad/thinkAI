import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The slides a brand-new profile is greeted with: why chatting is not thinking,
 * and what thinkAI does instead. Each line is its own paragraph so the argument
 * lands one beat at a time, all in the same voice.
 */
const SLIDES: { lines: string[] }[] = [
  {
    lines: [
      "LLM chat interfaces make solving problems easy.",
      "But you do not think deeply.",
      "This makes your brain rot!",
    ],
  },
  {
    lines: ["Without deep thought there is no success, no new ideas, no progress."],
  },
  {
    lines: ["Instead of chatting with the AI:", "refine your question, and refine your brain."],
  },
  {
    lines: [
      "Write your question.",
      "Get feedback.",
      "Refine your question.",
      "Until you have the best possible question…",
      "… to get the perfect answer.",
    ],
  },
  {
    lines: ["The process is tedious, but your brain does not rot."],
  },
];

export function IntroOverlay({
  open,
  onClose,
  onRetire,
}: {
  open: boolean;
  /** Put it away for this visit. It greets them again next time. */
  onClose: () => void;
  /** Put it away for good — the only thing that stops it coming back. */
  onRetire: () => void;
}) {
  const [index, setIndex] = useState(0);
  const advance = useRef<HTMLButtonElement>(null);
  const last = index === SLIDES.length - 1;

  // A reopened overlay starts at the beginning rather than wherever it was left.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Keep the focus ring on Next (and on Start refining, on the last slide) as
  // the slides go by, so the way forward is what Enter and a visible ring land
  // on — never "Do not show again".
  useEffect(() => {
    if (open) advance.current?.focus();
  }, [open, index]);

  // Arrow keys page through it; Enter advances, and finishes on the last slide.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (last) onClose();
        else setIndex((i) => i + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last, onClose]);

  const slide = SLIDES[index]!;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing is only for this visit, however it was closed. Retiring the
        // introduction is a deliberate act, and has its own button.
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl gap-0 p-0 [&>button]:hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          advance.current?.focus();
        }}
      >
        <div className="flex min-h-[22rem] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
            <span className="font-mono text-xs uppercase tracking-[0.35em] text-primary">
              thinkAI
            </span>
            <button
              type="button"
              onClick={onRetire}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Do not show again
            </button>
          </div>

          <DialogTitle className="sr-only">What thinkAI is for</DialogTitle>

          <div className="flex flex-1 flex-col justify-center gap-3 px-8 py-10">
            {slide.lines.map((line) => (
              <p
                key={line}
                className="text-balance text-2xl font-semibold leading-snug tracking-tight text-foreground"
              >
                {line}
              </p>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIndex((i) => i - 1)}
              disabled={index === 0}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>

            <div className="flex items-center gap-1.5" aria-hidden>
              {SLIDES.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
                    i === index ? "bg-primary" : "bg-border",
                  )}
                />
              ))}
            </div>

            {last ? (
              <Button ref={advance} size="sm" onClick={onClose}>
                Start refining <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button ref={advance} size="sm" onClick={() => setIndex((i) => i + 1)}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
