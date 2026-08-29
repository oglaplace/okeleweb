<script setup lang="ts">
import { computed } from "vue";
import { cycleTheme, theme } from "../lib/theme";

// One button rather than three, because this is a preference and not a
// feature — it should not take a row of chrome away from the work.
const label = computed(() =>
  theme.value === "light" ? "Thème clair" : theme.value === "dark" ? "Thème sombre" : "Thème système",
);
const glyph = computed(() => (theme.value === "light" ? "☀" : theme.value === "dark" ? "☾" : "◐"));
</script>

<template>
  <button
    class="btn ghost icon"
    type="button"
    :title="`${label} — cliquer pour changer`"
    :aria-label="label"
    @click="cycleTheme()"
  >
    <span aria-hidden="true">{{ glyph }}</span>
  </button>
</template>
