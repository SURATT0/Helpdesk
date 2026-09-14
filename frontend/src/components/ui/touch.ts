/**
 * Grows an icon button to a 44px square where the pointer is coarse.
 *
 * The design draws these controls at 28–34px, which is right for a cursor and
 * too small for a fingertip — 44px is the floor Apple's HIG sets and roughly the
 * width of an adult index finger. Rather than expanding the hit area with a
 * pseudo-element, this grows the control itself, because several of them sit
 * next to other controls (the language toggle beside the bell, confirm beside
 * cancel) where an invisible overhang would steal taps from its neighbour.
 *
 * Keyed on the pointer, not a width breakpoint: the target size depends on what
 * is doing the pointing, not on how wide the screen is, and a phone in landscape
 * is wider than `sm`. Desktop renders byte-identically — the media query simply
 * does not match.
 *
 * The buttons that use this all centre their icon with `grid place-items-center`,
 * so the glyph stays put and only the box around it changes.
 */
export const TOUCH_TARGET =
  "[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

/**
 * Gives a LABELLED control a 44px floor on height, and leaves its width alone.
 *
 * `TOUCH_TARGET` above forces a square, which is what an icon button wants and
 * what a button with words in it must not have: a full-width "Add customer"
 * pinned to 44px wide would be narrower than its own label. The floor a finger
 * needs is on the height either way.
 *
 * `min-h` rather than `h`, so a button whose content is already taller than 44px
 * — two lines of wrapped label on a narrow screen — is not clipped to fit.
 *
 * Keyed on the pointer for the same reason as its sibling: the target size
 * depends on what is doing the pointing, not on how wide the screen is.
 */
export const TOUCH_HEIGHT = "[@media(pointer:coarse)]:min-h-11";
