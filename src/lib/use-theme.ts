import { useCallback, useEffect, useState } from "react";

export type Theme = "day" | "night";

const STORAGE_KEY = "thinkai-theme";
// Pre-rename key, read once by the hook so an existing choice survives the
// rename. Deliberately not referenced by themeInitScript below: that script is
// inlined into every page's <head>, and the old product name must not appear in
// what the browser is served. The cost is one brief flash of the light theme on
// the first load after the rename, for anyone who had chosen night; the hook
// then migrates them and no later load flashes.
const LEGACY_STORAGE_KEY = "prompt-forge-theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "day";
  const v =
    window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
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
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
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
