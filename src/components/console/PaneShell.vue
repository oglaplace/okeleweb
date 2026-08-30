<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

/**
 * The second column of the console, whatever is in it.
 *
 * Two things live here — the organisation tree, and "où appliquer cette
 * action" — and they are the same column doing the same job: holding the
 * structure beside the work rather than in front of it. Sharing the shell means
 * they share the width, so switching from one to the other does not make the
 * layout jump.
 *
 * RESIZABLE, with hard limits. A pane the user can drag to 40px is a pane they
 * can destroy, and one they can drag to half the window leaves no room for the
 * work. The bounds are enforced on the drag, not just in the stylesheet, and the
 * width is remembered so the layout survives a reload.
 */
const MIN = 220;
const MAX = 460;
const KEY = "ec_orgpane_w";

defineProps<{ label: string }>();

const width = ref(clamp(Number(localStorage.getItem(KEY)) || 280));
function clamp(px: number) {
  return Math.min(MAX, Math.max(MIN, px));
}

const dragging = ref(false);
let startX = 0;
let startW = 0;

function onDown(event: PointerEvent) {
  dragging.value = true;
  startX = event.clientX;
  startW = width.value;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}
function onMove(event: PointerEvent) {
  if (!dragging.value) return;
  width.value = clamp(startW + (event.clientX - startX));
}
function onUp() {
  if (!dragging.value) return;
  dragging.value = false;
  localStorage.setItem(KEY, String(width.value));
}
onBeforeUnmount(onUp);

/** Keyboard resize, because a drag handle nobody can tab to is not a control. */
function onKey(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  width.value = clamp(width.value + (event.key === "ArrowRight" ? 16 : -16));
  localStorage.setItem(KEY, String(width.value));
}

const style = computed(() => ({ width: `${width.value}px` }));
</script>

<template>
  <aside class="orgpane" :style="style" :aria-label="label">
    <div v-if="$slots.head" class="orgpane-head">
      <slot name="head" />
    </div>

    <div class="orgpane-body">
      <slot />
    </div>

    <div
      class="orgpane-grip"
      :class="{ 'is-dragging': dragging }"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      :aria-valuemin="MIN"
      :aria-valuemax="MAX"
      tabindex="0"
      aria-label="Redimensionner le panneau"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
    />
  </aside>
</template>
