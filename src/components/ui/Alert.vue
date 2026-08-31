<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

/**
 * A message that can be got rid of.
 *
 * Every banner in this console used to stay until whatever set it decided
 * otherwise — which, for most of them, was never. "Emploi du temps publié"
 * sat above the grid for the rest of the session, pushing the sheet down and
 * telling the operator something they already knew; a stale error sat there
 * looking like a live one.
 *
 * So: a close button on everything, and CONFIRMATIONS go on their own after a
 * few seconds. The asymmetry is deliberate. A success is read once and then it
 * is noise — nobody needs "élève inscrit" ten minutes later. An error is a
 * thing that has to be dealt with, and a machine that decides when you have
 * finished reading a problem is a machine that hides problems.
 */
const props = withDefaults(
  defineProps<{
    kind?: "error" | "ok" | "warn";
    /** Set false for a banner that IS the page — a failed load has nothing behind it. */
    closable?: boolean;
    /** Milliseconds before a confirmation removes itself. 0 disables it. */
    autoDismiss?: number;
  }>(),
  { kind: "error", closable: true, autoDismiss: 6000 },
);
const emit = defineEmits<{ close: [] }>();

let timer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  if (props.kind === "ok" && props.closable && props.autoDismiss > 0) {
    timer = setTimeout(() => emit("close"), props.autoDismiss);
  }
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div
    class="alert"
    :class="`is-${kind}`"
    :role="kind === 'error' ? 'alert' : 'status'"
  >
    <div class="alert-body"><slot /></div>
    <button
      v-if="closable"
      class="alert-x"
      type="button"
      aria-label="Fermer ce message"
      title="Fermer"
      @click="emit('close')"
    >×</button>
  </div>
</template>
