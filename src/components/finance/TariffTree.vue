<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { KIND_FR } from "../structure/kinds";
import type { OrgUnitKind } from "../../lib/api";

/**
 * THE ORGANISATION AS A DIAGRAM, priced.
 *
 * The list view answers "what does each unit cost"; this one answers "what does
 * this complex look like, and where do the prices live in it". They are
 * different questions and they want different pictures, which is why both are
 * kept rather than one replacing the other.
 *
 * ── LAYOUT ──
 * Left-to-right, depth on the x axis: names are horizontal words and an org
 * tree is four levels deep and dozens wide, so the wide axis has to be the one
 * with the most nodes on it. Leaves take consecutive rows; a parent centres
 * between its first and last child.
 *
 * That is the first pass of Reingold–Tilford without the second. The full
 * algorithm — and Buchheim's linear-time variant, which is what d3.tree
 * implements — exists to COMPACT the result by sliding disjoint subtrees
 * together along their contours. It never affects correctness: laying leaves
 * out consecutively already guarantees no two nodes overlap. What it buys is
 * width, and it buys it where trees are deep and bushy. An org chart is four
 * levels deep with fixed-size cards, so the compaction saves almost nothing
 * and costs the threading machinery. If a complex ever nests deeply enough for
 * this to look sparse, the upgrade path is Buchheim and it is a drop-in
 * replacement for `layout()` below.
 *
 * ── RENDERING ──
 * Edges are SVG, nodes are HTML positioned on top. Mixing the two on purpose:
 * curves want a path element, and a price wants a real <input> — one that
 * focuses, takes a keyboard, and inherits the console's own field styling.
 * `foreignObject` can host an input but is a well-known source of layout and
 * focus bugs across engines, and it would put the field beyond the reach of
 * every rule in app.css.
 */
export interface TreeNode {
  id: string;
  name: string;
  kind: OrgUnitKind;
  parentId: string | null;
  /** May this row take a price, given the levels the operator opened? */
  editable: boolean;
  /** Structure only — the direction, the comptabilité. Never priced. */
  priceable: boolean;
  /** What is typed or stored for the active fee type. Empty when unset. */
  value: string;
  /** What it would be billed if it sets nothing, and from where. */
  inherited: number | null;
  inheritedFrom: string | null;
  installments: number;
  /** True when the figure is this unit's own rather than inherited. */
  own: boolean;
}

const props = defineProps<{
  nodes: TreeNode[];
  selected: Set<string>;
  /** Only shown where it means something — a PER_PERIOD fee with a price. */
  showInstallments: boolean;
}>();
const emit = defineEmits<{
  type: [{ id: string; raw: string }];
  /** `wholeLevel` is a Cmd/Ctrl-click: take every node at this one's level. */
  toggle: [{ id: string; wholeLevel: boolean }];
  clear: [string];
}>();

/**
 * The platform's own multi-select modifier.
 *
 * Meta on a Mac, Control everywhere else. Reading `metaKey || ctrlKey` and
 * being done with it would make Ctrl-click on a Mac — which is the
 * right-click gesture — silently select a whole level.
 */
const isApple = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const wholeLevel = (e: MouseEvent) => (isApple ? e.metaKey : e.ctrlKey);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => XAF.format(v);

// ── layout ──────────────────────────────────────────────────────────────────
const CARD_W = 196;
const CARD_H = 68;
const COL_GAP = 64;
const ROW_GAP = 16;

interface Placed extends TreeNode { x: number; y: number; depth: number }

const placed = computed<Placed[]>(() => {
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, TreeNode[]>();
  for (const n of props.nodes) {
    // A parent outside the caller's scope makes its child a root here, which is
    // right: a censeur scoped to the collège sees the collège as the top.
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    const list = children.get(key) ?? [];
    list.push(n);
    children.set(key, list);
  }

  const out: Placed[] = [];
  const pos = new Map<string, { x: number; y: number; depth: number }>();
  let nextRow = 0;

  /** Returns the node's centre row, so the parent can sit between its children. */
  const walk = (node: TreeNode, depth: number): number => {
    const kids = children.get(node.id) ?? [];
    let row: number;
    if (!kids.length) {
      row = nextRow++;
    } else {
      const rows = kids.map((k) => walk(k, depth + 1));
      row = (rows[0]! + rows[rows.length - 1]!) / 2;
    }
    pos.set(node.id, {
      x: depth * (CARD_W + COL_GAP),
      y: row * (CARD_H + ROW_GAP),
      depth,
    });
    return row;
  };

  for (const root of children.get(null) ?? []) walk(root, 0);
  // Emitted in the original order so Vue keys stay stable across re-layouts.
  for (const n of props.nodes) {
    const p = pos.get(n.id);
    if (p) out.push({ ...n, ...p });
  }
  return out;
});

const bounds = computed(() => {
  if (!placed.value.length) return { w: 0, h: 0 };
  return {
    w: Math.max(...placed.value.map((n) => n.x)) + CARD_W,
    h: Math.max(...placed.value.map((n) => n.y)) + CARD_H,
  };
});

/**
 * One path per parent→child link.
 *
 * A cubic with horizontal control points, which is the connector every org
 * chart and file tree uses: it leaves the parent going right and arrives at the
 * child going right, so the eye follows the direction of the hierarchy rather
 * than a diagonal that could be read either way.
 */
const edges = computed(() => {
  const byId = new Map(placed.value.map((n) => [n.id, n]));
  const out: { d: string; id: string; lit: boolean }[] = [];
  for (const n of placed.value) {
    const parent = n.parentId ? byId.get(n.parentId) : null;
    if (!parent) continue;
    const x1 = parent.x + CARD_W;
    const y1 = parent.y + CARD_H / 2;
    const x2 = n.x;
    const y2 = n.y + CARD_H / 2;
    const mid = x1 + (x2 - x1) / 2;
    out.push({
      id: `${parent.id}->${n.id}`,
      d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
      // A lit edge is one whose child is open for pricing: it draws the eye
      // down the branches the operator is actually working in.
      lit: n.editable || props.selected.has(n.id),
    });
  }
  return out;
});

// ── pan & zoom ──────────────────────────────────────────────────────────────
const scale = ref(1);
const tx = ref(24);
const ty = ref(24);
const viewport = ref<HTMLElement | null>(null);
const panning = ref(false);

let start = { x: 0, y: 0, tx: 0, ty: 0 };

function onPointerDown(e: PointerEvent) {
  // Only the background pans. Dragging from a card would fight the input and
  // make selecting text inside a price impossible.
  if ((e.target as HTMLElement).closest(".tgraph-node")) return;
  panning.value = true;
  start = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!panning.value) return;
  tx.value = start.tx + (e.clientX - start.x);
  ty.value = start.ty + (e.clientY - start.y);
}
function onPointerUp(e: PointerEvent) {
  panning.value = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

/** Zoom about the cursor, so the thing under the pointer stays under it. */
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const box = viewport.value?.getBoundingClientRect();
  if (!box) return;
  const px = e.clientX - box.left;
  const py = e.clientY - box.top;
  const next = Math.min(2, Math.max(0.3, scale.value * (e.deltaY > 0 ? 0.9 : 1.1)));
  const k = next / scale.value;
  tx.value = px - (px - tx.value) * k;
  ty.value = py - (py - ty.value) * k;
  scale.value = next;
}

function zoomBy(k: number) {
  const box = viewport.value?.getBoundingClientRect();
  const px = (box?.width ?? 0) / 2;
  const py = (box?.height ?? 0) / 2;
  const next = Math.min(2, Math.max(0.3, scale.value * k));
  const ratio = next / scale.value;
  tx.value = px - (px - tx.value) * ratio;
  ty.value = py - (py - ty.value) * ratio;
  scale.value = next;
}

/** Fit the whole complex in the window — the "where am I" button. */
function fit() {
  const box = viewport.value?.getBoundingClientRect();
  const b = bounds.value;
  if (!box || !b.w || !b.h) return;
  const pad = 40;
  const next = Math.min(1, (box.width - pad * 2) / b.w, (box.height - pad * 2) / b.h);
  scale.value = Math.max(0.3, next);
  tx.value = (box.width - b.w * scale.value) / 2;
  ty.value = (box.height - b.h * scale.value) / 2;
}

defineExpose({ fit });
onBeforeUnmount(() => { panning.value = false; });
</script>

<template>
  <div class="tgraph">
    <div class="tgraph-tools">
      <button class="btn sm ghost" type="button" title="Ajuster à la fenêtre" @click="fit">
        Ajuster
      </button>
      <button class="btn sm ghost" type="button" aria-label="Dézoomer" @click="zoomBy(0.85)">−</button>
      <span class="tgraph-zoom">{{ Math.round(scale * 100) }} %</span>
      <button class="btn sm ghost" type="button" aria-label="Zoomer" @click="zoomBy(1.18)">+</button>
    </div>

    <div
      ref="viewport"
      class="tgraph-viewport"
      :class="{ 'is-panning': panning }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    >
      <div
        class="tgraph-canvas"
        :style="{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          width: `${bounds.w}px`,
          height: `${bounds.h}px`,
        }"
      >
        <!-- Edges below, nodes above: a connector must never cross a card. -->
        <svg class="tgraph-edges" :width="bounds.w" :height="bounds.h" aria-hidden="true">
          <path
            v-for="e in edges"
            :key="e.id"
            :d="e.d"
            class="tgraph-edge"
            :class="{ 'is-lit': e.lit }"
          />
        </svg>

        <div
          v-for="n in placed"
          :key="n.id"
          class="tgraph-node"
          :class="{
            'is-editable': n.editable,
            'is-picked': selected.has(n.id),
            'is-structure': !n.priceable,
          }"
          :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${CARD_W}px`, height: `${CARD_H}px` }"
          @click="n.editable && emit('toggle', { id: n.id, wholeLevel: wholeLevel($event) })"
        >
          <span class="tgraph-name" :title="n.name">{{ n.name }}</span>
          <span class="tgraph-kind">{{ KIND_FR[n.kind] }}</span>

          <span class="tgraph-price">
            <!-- Editable: the price IS the field. Clicking the card selects it,
                 so the input stops the click from doing both at once. -->
            <template v-if="n.editable">
              <span
                v-if="showInstallments && n.value"
                class="tgraph-inst"
                :title="`Réparti en ${n.installments} tranche(s)`"
              >×{{ n.installments }}</span>
              <input
                class="mark-input"
                inputmode="numeric"
                :value="n.value"
                :aria-label="`Prix — ${n.name}`"
                :placeholder="n.inherited !== null ? String(n.inherited) : '—'"
                @click.stop
                @pointerdown.stop
                @input="emit('type', { id: n.id, raw: ($event.target as HTMLInputElement).value })"
              />
              <!-- Only where there is something to take away. An empty field
                   reaches the same null, but the × is what SAYS a price can be
                   removed at all. -->
              <button
                v-if="n.own"
                class="tgraph-clear"
                type="button"
                :title="`Retirer le tarif de ${n.name}`"
                :aria-label="`Retirer le tarif de ${n.name}`"
                @click.stop
                @pointerdown.stop
                @click="emit('clear', n.id)"
              >×</button>
            </template>

            <!-- Structure carries no price and inherits none: no pupil is
                 enrolled in the comptabilité, so a figure beside it would be
                 one that is never charged to anybody. -->
            <template v-else-if="!n.priceable" />
            <span v-else-if="n.own" class="tgraph-own">{{ money(Number(n.value)) }}</span>
            <span
              v-else-if="n.inherited !== null"
              class="tgraph-inherit"
              :title="`Hérité de ${n.inheritedFrom}`"
            >{{ money(n.inherited) }} <em>hérité</em></span>
            <span v-else class="tgraph-none">—</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
