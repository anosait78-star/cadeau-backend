import { useEffect } from "react";

/**
 * Publishes the height of the on-screen keyboard as `--keyboard-inset` on the
 * document root, so any surface can lift its own footer clear of it.
 *
 * A phone keyboard does not resize the layout viewport — it covers it. Without
 * this, a form's submit button sits *behind* the keyboard the moment a field is
 * focused, which is the single most common way a web form betrays itself on a
 * phone. `visualViewport` is the only API that reports the covered height; where
 * it is missing the variable stays `0px` and layouts fall back to their normal
 * padding.
 *
 * Mounted once by the app; the variable is global because the surfaces that need
 * it (modals, sheets) are portaled outside the React tree that owns the form.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === undefined || viewport === null) return;

    const root = document.documentElement;
    const update = (): void => {
      // What the keyboard covers: the gap between the layout viewport and the
      // visible one, minus however far the visual viewport has been scrolled.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // Small values are keyboard-less noise (browser chrome settling).
      root.style.setProperty("--keyboard-inset", covered > 80 ? `${Math.round(covered)}px` : "0px");
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
