<script setup lang="ts">
import DialogShell from "./DialogShell.vue";

/**
 * A question asked before something becomes true for other people.
 *
 * Not for every destructive act — the console already leans on undo and on
 * writes being cheap to correct. This is for PUBLICATION specifically: the
 * moment a draft stops being the office's private working copy and starts
 * being what a parent is quoted or a teacher plans their week around. Those
 * cannot be taken back quietly; the correction is itself a new public version.
 *
 * So the dialog states what will become visible and to whom, rather than
 * asking "are you sure?", which tells nobody anything.
 */
withDefaults(
  defineProps<{
    title: string;
    /** What is being acted on — the class, the year. */
    subtitle?: string;
    confirmLabel?: string;
    busy?: boolean;
    /** Publication is not destructive; this is for the ones that are. */
    danger?: boolean;
  }>(),
  { confirmLabel: "Confirmer", busy: false, danger: false },
);
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <DialogShell :title="title" :subtitle="subtitle" @close="emit('close')">
    <div class="stack">
      <div class="confirm-body"><slot /></div>
      <div class="dialog-actions">
        <button class="btn ghost" type="button" :disabled="busy" @click="emit('close')">
          Annuler
        </button>
        <button
          class="btn"
          :class="danger ? 'danger' : 'primary'"
          type="button"
          :disabled="busy"
          @click="emit('confirm')"
        >
          <span v-if="busy" class="btn-spin" aria-hidden="true" />
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </DialogShell>
</template>
