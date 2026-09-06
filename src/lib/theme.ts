import { ref } from "vue";

/**
 * Light / dark / system, persisted.
 *
 * Three states rather than two, and the third is not a rounding error: "system"
 * is the only setting that follows a school laptop switching to night mode on
 * its own. A two-way toggle would silently pin whichever value happened to be
 * showing the first time someone touched it.
 *
 * The choice is written to the root element as `data-theme`, which index.css
 * reads. `system` writes NO attribute, so `prefers-color-scheme` decides — that
 * is why the dark tokens are declared twice there, once per selector.
 */
export type Theme = "light" | "dark" | "system";

const KEY = "ec_theme";

function read(): Theme {
  const raw = localStorage.getItem(KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export const theme = ref<Theme>(read());

export function applyTheme(next: Theme): void {
  theme.value = next;
  const root = document.documentElement;
  if (next === "system") {
    root.removeAttribute("data-theme");
    localStorage.removeItem(KEY);
  } else {
    root.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
  }
}

/** Call once at boot, before the first paint, so there is no flash. */
export function initTheme(): void {
  applyTheme(read());
}

/** What the MACHINE says, ignoring the setting. */
export function systemTheme(): "light" | "dark" {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** What the page is actually showing right now — the setting resolved. */
export function resolvedTheme(): "light" | "dark" {
  return theme.value === "system" ? systemTheme() : theme.value;
}

/**
 * One press, one visible change.
 *
 * THE BUG THIS FIXES. The cycle was a fixed light → dark → system, so from the
 * default ("system") on a laptop already in light mode the first press moved to
 * "light" — the same picture. The button looked dead and you had to press it
 * twice for anything to happen, every time, on a machine whose OS theme matched
 * the start of the cycle.
 *
 * The order is now decided by what is ON THE SCREEN rather than by which name
 * the setting carries: away from the machine's theme first, then to it, then
 * back to following it. Three stops as before, and "system" is still reachable
 * without a menu — but the first press always does something visible.
 */
export function cycleTheme(): void {
  const os = systemTheme();
  if (theme.value === "system") applyTheme(os === "dark" ? "light" : "dark");
  else if (theme.value !== os) applyTheme(os);
  else applyTheme("system");
}
