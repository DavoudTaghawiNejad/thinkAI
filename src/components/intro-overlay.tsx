import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The seven slides a brand-new profile is greeted with: why chatting is not
 * thinking, and what thinkAI does instead. Each line is its own paragraph so
 * the argument lands one beat at a time.
 */
const SLIDES: { lines: string[]; emphasis?: number }[] = [
  {
    lines: [
      "LLM chat interfaces make solving problems easy.",
      "But you do not think deeply.",
      "This makes your brain rot!",
    ],
    emphasis: 2,
  },
  {
    lines: ["Without deep thought there is no success, no new ideas, no progress."],
    emphasis: 0,
  },
  {
    lines: [
      "Instead of chatting with the AI:",
      "refine your question, and refine your brain, with thinkAI.",
    ],
    emphasis: 1,
  },
  {
    lines: [
      "Write your question.",
      "Get feedback to refine the question.",
      "Refine your question.",
      "Until you have the best possible question…",
      "… and get the perfect answer.",
    ],
  },
  {
    lines: ["In addition to the answer, you will have clarity."],
    emphasis: 0,
  },
  {
    lines: ["The process is tedious,", "but your brain does not rot."],
    emphasis: 1,
  },
  {
    lines: ["Write your question roughly.", "thinkAI will interrogate it, one test at a time."],
    emphasis: 0,
  },
];

export function IntroOverlay({
  open,
  onDone,
}: {
  open: boolean;
  /** Called once, whichever way the introduction ends — finished or skipped. */
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  // A reopened overlay starts at the beginning rather than wherever it was left.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Arrow keys page through it; Enter advances, and finishes on the last slide.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (last) onDone();
        else setIndex((i) => i + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last, onDone]);

  const slide = SLIDES[index]!;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing counts as seen, however it was closed — the introduction is
        // shown once, and a dismissal should not be met with it again.
        if (!next) onDone();
      }}
    >
      <DialogContent className="max-w-xl gap-0 p-0 [&>button]:hidden">
        <div className="flex min-h-[22rem] flex-col">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <span className="font-mono text-xs uppercase tracking-[0.35em] text-primary">
              thinkAI
            </span>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Skip
            </Button>
          </div>

          <DialogTitle className="sr-only">What thinkAI is for</DialogTitle>

          <div className="flex flex-1 flex-col justify-center gap-3 px-8 py-10">
            {slide.lines.map((line, i) => (
              <p
                key={line}
                className={cn(
                  "text-balance text-lg leading-snug",
                  i === slide.emphasis
                    ? "text-2xl font-semibold tracking-tight text-foreground"
                    : "text-muted-foreground",
                )}
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
              <Button size="sm" onClick={onDone}>
                Start refining <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
