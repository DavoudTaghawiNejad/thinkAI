import { useCallback, useEffect, useState } from "react";

export type Theme = "day" | "night";

const STORAGE_KEY = "prompt-forge-theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "day";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "night" ? "night" : "day";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "night");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored());

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "day" ? "night" : "day"));
  }, []);

  return { theme, toggle };
}

/** Inline script to run before hydration so the right theme is applied with no flash. */
export const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'night') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
