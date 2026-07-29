import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/** Default (mobile) matchMedia stub — jsdom has none. Tests that need the Desktop
 *  shell call `setViewport(true)` before rendering. */
function mediaStub(matches: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/** Force the viewport for shell tests: `true` = desktop (≥1024px), `false` = mobile. */
export function setViewport(isDesktop: boolean): void {
  window.matchMedia = mediaStub(isDesktop);
}

window.matchMedia = mediaStub(false);

// Radix primitives rely on APIs jsdom does not implement.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (typeof Element.prototype.hasPointerCapture === "undefined") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = mediaStub(false);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});
