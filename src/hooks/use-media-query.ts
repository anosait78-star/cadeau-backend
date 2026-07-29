import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. SSR/JSDOM-safe: returns `false` when
 * `matchMedia` is unavailable. Updates when the match state changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The desktop breakpoint (≥ 1024px) that selects the Desktop shell. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
