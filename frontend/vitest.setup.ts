import "@testing-library/jest-dom/vitest";

/**
 * jsdom ships no `matchMedia`, and a component that asks it a question throws
 * rather than degrading — which surfaces as a component test failing on a line
 * that has nothing to do with what the test is checking.
 *
 * Stubbed here rather than guarded at each call site: the alternative is every
 * component that reads a media query carrying a `typeof window.matchMedia ===
 * "function"` check written for the test environment rather than for any
 * browser.
 *
 * Reports NO match, which is the honest answer for a 1024x768 jsdom window with
 * no layout engine behind it: a component asking "am I on a wide screen?" gets
 * "not as far as I can tell", and any test that needs a specific answer
 * overrides this with its own stub.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
