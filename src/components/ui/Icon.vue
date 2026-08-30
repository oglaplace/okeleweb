<script setup lang="ts">
import { computed } from "vue";
import type { IconName } from "./icons";

/**
 * The icon set, inline.
 *
 * Hand-drawn 24×24 stroke paths rather than a library. An icon font or an SVG
 * package is 30–100KB for the twenty glyphs this console uses, and the whole
 * design rests on not spending a school's metered data on things a director
 * will not notice. Stroke, not fill, so one `currentColor` follows the theme.
 */
const props = defineProps<{ name: IconName; size?: number }>();

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5",
  tree: "M4 4h6v5H4zM14 15h6v5h-6zM4 15h6v5H4zM7 9v6M17 15v-3H7",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5h4L11 8h8.5A1.5 1.5 0 0 1 21 9.5v9A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z",
  school: "M12 3 2 8l10 5 10-5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5",
  userPlus: "M15 20v-1.5A3.5 3.5 0 0 0 11.5 15h-5A3.5 3.5 0 0 0 3 18.5V20M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8v6M21 11h-6",
  users: "M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-6A3.5 3.5 0 0 0 3 18.5V20M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 3.1a3.5 3.5 0 0 1 0 6.8",
  upload: "M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15M12 3v12M8 7l4-4 4 4",
  calendar: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3",
  clipboard: "M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16M9 13l2 2 4-4",
  fileText: "M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6",
  check: "M4 12.5 9 18 20 6",
  lock: "M6 10.5h12v10H6zM8.5 10.5V7a3.5 3.5 0 1 1 7 0v3.5",
  wallet: "M3 7.5A1.5 1.5 0 0 1 4.5 6H18v3M3 7.5v10A1.5 1.5 0 0 0 4.5 19H19.5A1.5 1.5 0 0 0 21 17.5V11A1.5 1.5 0 0 0 19.5 9.5H4.5A1.5 1.5 0 0 1 3 8zM17 14.2h.01",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5",
  coins: "M9 12a5 3 0 1 0 0-6 5 3 0 0 0 0 6ZM4 9v4c0 1.7 2.2 3 5 3s5-1.3 5-3V9M10 16v3c0 1.7 2.2 3 5 3s5-1.3 5-3v-4M10 15a5 3 0 0 0 10 0",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5 12 22l9-4.5",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  chevronRight: "M9 5l7 7-7 7",
  chevronLeft: "M15 5l-7 7 7 7",
  dots: "M12 6.5h.01M12 12h.01M12 17.5h.01",
  chevronDown: "M5 9l7 7 7-7",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7V16h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3Z",
} as const;

void 0;

const px = computed(() => props.size ?? 16);
</script>

<template>
  <svg
    class="icon"
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
