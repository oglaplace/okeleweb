/**
 * The keyboard the operator actually has.
 *
 * ⌘ on a Mac, Ctrl everywhere else — and the console is used on both: the
 * office runs Windows, the director's laptop is a MacBook. Two things have to
 * follow from that and they are easy to get half right: the modifier the code
 * READS, and the glyph the UI SHOWS. A hint that says "⌘ pour sélectionner"
 * on a Windows machine documents a key that keyboard does not have.
 *
 * Reading `metaKey || ctrlKey` and being done with it is not the same thing:
 * on a Mac, Ctrl-click IS the right-click gesture, so accepting it would fire
 * a shortcut every time somebody opened a context menu.
 */
const nav = typeof navigator === "undefined" ? null : navigator;

/**
 * `userAgentData.platform` is the supported reading; `platform` is deprecated
 * but still the only one Safari and Firefox answer. iPadOS reports "MacIntel",
 * which is right for our purpose — it carries a Mac's modifier conventions.
 */
export const isApple =
  !!nav &&
  /Mac|iP(hone|ad|od)/i.test(
    (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      nav.platform ??
      nav.userAgent,
  );

/** The modifier this platform means by "the command key". */
export const withModifier = (e: MouseEvent | KeyboardEvent) => (isApple ? e.metaKey : e.ctrlKey);

/** What to print in a hint or a tooltip. Never hard-code the glyph. */
export const MODIFIER_LABEL = isApple ? "⌘" : "Ctrl";
