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

/** Cycles light → dark → system, which is the order people expect from a
 *  single button and keeps "system" reachable without a menu. */
export function cycleTheme(): void {
  applyTheme(theme.value === "light" ? "dark" : theme.value === "dark" ? "system" : "light");
}
