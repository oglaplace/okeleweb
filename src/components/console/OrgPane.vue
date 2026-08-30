<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import Explorer from "../structure/Explorer.vue";
import NodeMenuDialogs from "./NodeMenuDialogs.vue";

/**
 * The organisation tree, as its own column between the rail and the content.
 *
 * It was inside the Structure page, which meant it existed only there — and the
 * tree is the thing you navigate BY, not a screen you visit. Here it is present
 * for every action: pick a classe on the left, act on it on the right.
 *
 * RESIZABLE, with hard limits. A pane the user can drag to 40px is a pane they
 * can destroy, and one they can drag to half the window leaves no room for the
 * work. The bounds are enforced on the drag, not just on the stylesheet, and the
 * width is remembered so the layout survives a reload.
 */
const MIN = 220;
const MAX = 460;
const KEY = "ec_orgpane_w";

const emit = defineEmits<{ select: [api.TreeUnit] }>();
const props = defineProps<{ selected: string | null }>();

const router = useRouter();
const units = ref<api.TreeUnit[]>([]);
const loading = ref(true);

const width = ref(clamp(Number(localStorage.getItem(KEY)) || 280));
function clamp(px: number) {
  return Math.min(MAX, Math.max(MIN, px));
}

async function load() {
  loading.value = true;
  try {
    units.value = await api.orgUnits.tree();
  } catch {
    units.value = [];
  } finally {
    loading.value = false;
  }
}
onMounted(load);
defineExpose({ reload: load });

// ── drag to resize ──────────────────────────────────────────────────────────
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

/**
 * The node the ⋯ menu is acting on, and which action.
 *
 * Held here rather than in the Explorer: the tree is a pure renderer of rows,
 * and a row must not own a modal — a dialog attached to a node that the next
 * reload removes would be left pointing at nothing.
 */
const menuUnit = ref<api.TreeUnit | null>(null);
const menuAction = ref<"add" | "rename" | "close" | "reopen" | null>(null);

function onMenu(payload: { unit: api.TreeUnit; action: string }) {
  if (payload.action === "open") {
    pick(payload.unit);
    return;
  }
  menuUnit.value = payload.unit;
  menuAction.value = payload.action as "add" | "rename" | "close" | "reopen";
}

async function onDialogDone(changed: boolean) {
  menuUnit.value = null;
  menuAction.value = null;
  if (changed) await load();
}

function pick(unit: api.TreeUnit) {
  emit("select", unit);
  // EVERY node opens its own view, leaf or not. Selecting without navigating
  // was the old behaviour and it meant a classe told you nothing until you
  // found a second control to open it with.
  void router.push({ name: "unit", params: { id: unit.id } });
}
</script>

<template>
  <aside class="orgpane" :style="style" aria-label="Organisation">
    <div class="orgpane-body">
      <div v-if="loading" class="tnode-hint">Chargement…</div>
      <Explorer
        v-else
        :units="units"
        :selected="selected"
        @select="pick"
        @menu="onMenu"
      />
    </div>

    <NodeMenuDialogs :unit="menuUnit" :action="menuAction" @done="onDialogDone" />

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
