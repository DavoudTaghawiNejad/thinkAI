import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === "day" ? "Switch to night mode" : "Switch to day mode"}
      title={theme === "day" ? "Night mode" : "Day mode"}
      className="fixed bottom-5 right-5 z-50 h-10 w-10 rounded-full border border-border bg-card shadow-md hover:bg-accent"
    >
      {theme === "day" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}
