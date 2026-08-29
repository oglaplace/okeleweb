/**
 * The icon names, as a type.
 *
 * Declared beside the component rather than inside it: `<script setup>` cannot
 * export types, and the action registry needs to name an icon at compile time
 * so a typo is an error rather than an empty square.
 */
export const ICON_NAMES = [
  "home", "tree", "folder", "school", "userPlus", "users", "upload", "calendar",
  "book", "clipboard", "fileText", "check", "lock", "wallet", "receipt", "coins",
  "layers", "plus", "search", "chevronRight", "chevronDown", "settings", "clock",
  "bulb",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
