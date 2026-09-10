<script setup lang="ts">
/**
 * A message that stays until somebody closes it.
 *
 * Every banner in this console used to stay until whatever set it decided
 * otherwise — which, for most of them, was never. So: a close button on
 * everything.
 *
 * Confirmations used to remove themselves after six seconds, and that was
 * wrong in the room this runs in. The counter looks down at a receipt, back up,
 * and the line telling them what was recorded — the receipt number, the change
 * to give — is gone, with nothing to bring it back. A machine that decides when
 * you have finished reading is a machine that hides what it did. The × stays,
 * and the operator uses it when they are done.
 *
 * One at a time: a new message REPLACES the one before it rather than piling on
 * top of it (see `useBanner`), because two banners stacked above a form are one
 * banner and one piece of scrollback.
 */
withDefaults(
  defineProps<{
    kind?: "error" | "ok" | "warn";
    /** Set false for a banner that IS the page — a failed load has nothing behind it. */
    closable?: boolean;
  }>(),
  { kind: "error", closable: true },
);
const emit = defineEmits<{ close: [] }>();
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
