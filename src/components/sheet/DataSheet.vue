<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { IDENTITY, type SheetColumn, type SheetTab } from "./columns";
import Icon from "../ui/Icon.vue";

/**
 * Rows as a spreadsheet, because that is what a class list IS.
 *
 * Schools already keep this in Excel — the effectif down the side, whatever
 * they are working on across the top — and the console's card-and-table layout
 * was fighting that rather than serving it. So: a dense grid, a frozen header,
 * frozen identity columns, a totals row, and the three things nobody accepts a
 * grid without: sort by clicking a heading, filter by typing, and export.
 *
 * The header can be two rows deep, because marks are grouped by période and a
 * flat header would repeat "Trimestre 1" against every subject.
 */
const props = defineProps<{
  tab: SheetTab;
  rows: Record<string, unknown>[];
  rowKey: string;
  /** Marks a row as selected, e.g. the pupil whose file is open. */
  selected?: string | null;
  /** Rows lead somewhere. Without it a pointer cursor promises a click that
   *  does nothing, which is worse than no affordance at all. */
  clickable?: boolean;
  /** Names the export file: "6e A — Finances.csv". */
  title?: string;
}>();
const emit = defineEmits<{ pick: [row: Record<string, unknown>] }>();

/** A column plus what the renderer needs to know about its neighbours. */
interface Col extends SheetColumn {
  /** First column of a période, so the block boundary can be drawn. */
  groupStart?: boolean;
  /** Alternates per group, so two périodes read as two blocks. */
  groupIndex?: number;
}

/** The row-number gutter, like every spreadsheet has. */
const GUTTER: Col = { key: "__n", label: "#", width: 3, type: "number" };

/**
 * Flat list of the leaf columns, whether or not they came from groups.
 *
 * A grouped tab declares only its groups, and identity is prepended here — the
 * first version left it to the caller and the marks tab shipped without names
 * on it. Whose 12.63 that is, is the one thing the column cannot be read
 * without.
 */
const columns = computed<Col[]>(() => {
  if (!props.tab.groups) return [GUTTER, ...(props.tab.columns ?? [])];
  const out: Col[] = [GUTTER, ...IDENTITY];
  props.tab.groups.forEach((group, groupIndex) => {
    group.columns.forEach((column, i) => {
      out.push({ ...column, groupIndex, groupStart: i === 0 });
    });
  });
  return out;
});

/** +1 for the gutter, which is always frozen. */
const frozen = computed(() =>
  Math.min((props.tab.frozen ?? IDENTITY.length) + 1, columns.value.length),
);

const DEFAULT_WIDTH = 12;
/**
 * Declared widths are CONTENT widths; the padding is added here.
 *
 * `box-sizing: border-box` is global, so `width: 7ch` on a cell with 10px of
 * padding each side leaves about two characters of room — which is how a column
 * of marks came out reading "10….".
 */
const PADDING_PX = 21;
const widthOf = (column: Col) => column.width ?? DEFAULT_WIDTH;
const cssWidth = (column: Col) => `calc(${widthOf(column)}ch + ${PADDING_PX}px)`;

function frozenLeft(index: number): string | undefined {
  if (index >= frozen.value) return undefined;
  const ch = columns.value.slice(0, index).reduce((sum, c) => sum + widthOf(c), 0);
  return `calc(${ch}ch + ${index * PADDING_PX}px)`;
}

/**
 * Widths live in a colgroup, not on the cells.
 *
 * Under `table-layout: fixed` the browser takes column widths from the FIRST
 * header row, and the marks tab's first row is the période groups — so widths
 * got split evenly across each group. A colgroup is the one declaration that
 * both the layout and `frozenLeft` read, so they cannot disagree.
 */
const colWidths = computed(() => columns.value.map(cssWidth));

// ── filter ───────────────────────────────────────────────────────────────────
const filter = ref("");

/** Accent-insensitive: nobody types "Grâce" with the circumflex in a hurry. */
const fold = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ── sort ─────────────────────────────────────────────────────────────────────
const sort = ref<{ key: string; dir: 1 | -1 } | null>(null);

function sortBy(column: Col) {
  if (column.key === "__n") return;
  if (sort.value?.key !== column.key) {
    // Numbers descend first — "who owes the most" and "who is bottom of the
    // class" are the questions a numeric column gets clicked for.
    sort.value = { key: column.key, dir: isNumeric(column) ? -1 : 1 };
  } else if (sort.value.dir === (isNumeric(column) ? -1 : 1)) {
    sort.value = { key: column.key, dir: sort.value.dir === 1 ? -1 : 1 };
  } else {
    sort.value = null; // third click restores the natural order
  }
}
// A tab change must not leave a sort pointing at a column that is gone.
watch(() => props.tab.id, () => (sort.value = null));

const viewRows = computed<Record<string, unknown>[]>(() => {
  const needle = fold(filter.value.trim());
  let out = props.rows;

  if (needle) {
    const keys = columns.value.map((c) => c.key);
    out = out.filter((row) =>
      keys.some((key) => {
        const v = row[key];
        return v !== null && v !== undefined && fold(String(v)).includes(needle);
      }),
    );
  }

  if (sort.value) {
    const { key, dir } = sort.value;
    out = [...out].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      // Missing sorts last in BOTH directions. A pupil with no mark is not the
      // worst in the class, and the schema is careful to distinguish them.
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      if (typeof x === "boolean" && typeof y === "boolean") return (Number(x) - Number(y)) * dir;
      return String(x).localeCompare(String(y), "fr") * dir;
    });
  }

  // The gutter is a column like any other, so it is a value on the row.
  return out.map((row, i) => ({ ...row, __n: i + 1 }) as Record<string, unknown>);
});

// ── totals ───────────────────────────────────────────────────────────────────
const totals = computed(() => {
  const out: Record<string, number> = {};
  for (const column of columns.value) {
    if (!column.total) continue;
    out[column.key] = viewRows.value.reduce((sum, row) => {
      const v = row[column.key];
      return sum + (typeof v === "number" ? v : 0);
    }, 0);
  }
  return out;
});
const hasTotals = computed(() => Object.keys(totals.value).length > 0);

// ── formatting ───────────────────────────────────────────────────────────────
const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function format(value: unknown, column: Col): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (column.type) {
    case "money":
      return typeof value === "number" ? XAF.format(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${value.toFixed(1)} %` : String(value);
    case "grade":
      // Two decimals, always: 12 and 12.00 in the same column read as different
      // precisions when they are the same number.
      return typeof value === "number" ? value.toFixed(2) : String(value);
    case "date":
      return typeof value === "string" ? value.split("-").reverse().join("/") : String(value);
    case "pill":
      return value ? "Oui" : "Non";
    default:
      return String(value);
  }
}

const isNumeric = (column: Col) =>
  ["number", "money", "percent", "grade"].includes(column.type ?? "text");

/** Only where the column asked for it, and only on the wrong side of zero. */
function warns(value: unknown, column: Col): boolean {
  return column.warnAbove !== undefined && typeof value === "number" && value >= column.warnAbove;
}

// ── fill the height ──────────────────────────────────────────────────────────
/**
 * Blank rows to the bottom of the pane.
 *
 * A grid that stops after nine pupils and leaves grey space beneath it reads as
 * broken — a spreadsheet's ruled lines run to the edge of the paper whether or
 * not anything is written on them, and that is what tells you where you may
 * still write. Measured rather than guessed: row height comes from a real row,
 * so a browser zoom or a font change cannot leave a gap.
 */
const scroller = ref<HTMLElement | null>(null);
const table = ref<HTMLElement | null>(null);
const fillers = ref(0);

function measure() {
  const box = scroller.value;
  const grid = table.value;
  if (!box || !grid) return;
  const rowEl = grid.querySelector<HTMLElement>("tbody tr:not(.is-filler)");
  const rowHeight = rowEl?.offsetHeight || 27;
  const filled = fillers.value * rowHeight;
  const spare = box.clientHeight - (grid.offsetHeight - filled);
  fillers.value = Math.max(0, Math.floor(spare / rowHeight));
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => measure());
  if (scroller.value) observer.observe(scroller.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch([viewRows, columns], () => requestAnimationFrame(measure));

// ── export ───────────────────────────────────────────────────────────────────
/**
 * The tab, as a CSV.
 *
 * Not a grudging concession to Excel: a school's année is audited on paper and
 * shared with a ministry that asks for files. Exporting what is ON SCREEN —
 * this tab, this filter, this sort — rather than "everything" is the whole
 * point; the operator has already said what they mean by narrowing it.
 */
function exportCsv() {
  const cols = columns.value.filter((c) => c.key !== "__n");
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    cols.map((c) => cell(c.label)).join(";"),
    ...viewRows.value.map((row) => cols.map((c) => cell(row[c.key])).join(";")),
  ];
  // Semicolons and a BOM: French Excel splits on ";" and needs the BOM to read
  // "Grâce" as anything but "GrÃ¢ce".
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.title ?? "feuille"} — ${props.tab.label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

defineExpose({ exportCsv });
</script>

<template>
  <div class="sheet" :class="{ 'is-clickable': clickable }">
    <!-- The one strip above the grid: what is shown, and how to take it away. -->
    <div class="sheet-bar">
      <div class="sheet-find">
        <Icon name="search" :size="14" />
        <input
          v-model="filter"
          type="search"
          placeholder="Filtrer les lignes…"
          aria-label="Filtrer les lignes"
        />
      </div>
      <span class="sheet-count">
        {{ viewRows.length }}<template v-if="filter"> / {{ rows.length }}</template> ligne(s)
      </span>
      <button
        v-if="sort"
        class="btn sm ghost"
        type="button"
        title="Revenir à l'ordre naturel"
        @click="sort = null"
      >
        Annuler le tri
      </button>
      <div class="sheet-bar-fill" />
      <button class="btn sm ghost" type="button" :disabled="!viewRows.length" @click="exportCsv">
        Exporter (CSV)
      </button>
    </div>

    <div ref="scroller" class="sheet-scroll">
      <table ref="table" class="sheet-table">
        <colgroup>
          <col v-for="(w, i) in colWidths" :key="i" :style="{ width: w }" />
          <!-- The slack column: takes whatever is left over so the declared
               widths are honoured instead of being stretched. -->
          <col />
        </colgroup>

        <thead>
          <!-- Two-row header only when the columns are grouped. -->
          <tr v-if="tab.groups" class="sheet-groups">
            <th class="sheet-corner" :colspan="frozen" />
            <th
              v-for="(group, i) in tab.groups"
              :key="i"
              :colspan="group.columns.length"
              class="sheet-group"
              :class="{ 'is-alt': i % 2 === 1 }"
            >
              {{ group.label }}
            </th>
            <th class="sheet-fill" />
          </tr>
          <tr>
            <th
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{
                'is-frozen': i < frozen,
                'is-last-frozen': i === frozen - 1,
                'is-num': isNumeric(column),
                'is-group-start': column.groupStart,
                'is-alt': column.groupIndex !== undefined && column.groupIndex % 2 === 1,
                'is-sorted': sort?.key === column.key,
                'is-sortable': column.key !== '__n',
              }"
              :style="{ left: frozenLeft(i) }"
              :title="column.hint ?? column.label"
              :aria-sort="sort?.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined"
              @click="sortBy(column)"
            >
              {{ column.label }}
              <span v-if="sort?.key === column.key" class="sheet-caret" aria-hidden="true">
                {{ sort.dir === 1 ? "▲" : "▼" }}
              </span>
            </th>
            <th class="sheet-fill" />
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in viewRows"
            :key="String(row[rowKey])"
            :class="{ 'is-selected': selected === row[rowKey] }"
            @click="emit('pick', row)"
          >
            <td
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{
                'is-frozen': i < frozen,
                'is-last-frozen': i === frozen - 1,
                'is-num': isNumeric(column),
                'is-group-start': column.groupStart,
                'is-alt': column.groupIndex !== undefined && column.groupIndex % 2 === 1,
                'is-warn': warns(row[column.key], column),
                'is-empty': row[column.key] === null || row[column.key] === undefined,
                'is-gutter': column.key === '__n',
              }"
              :style="{ left: frozenLeft(i) }"
            >
              {{ format(row[column.key], column) }}
            </td>
            <td class="sheet-fill" />
          </tr>

          <tr v-if="!viewRows.length" class="is-filler">
            <td :colspan="columns.length + 1" class="sheet-blank">
              {{ filter ? `Aucune ligne ne correspond à « ${filter} ».` : "Aucune ligne." }}
            </td>
          </tr>

          <!-- Ruled to the bottom of the pane, like paper. -->
          <tr v-for="n in fillers" :key="`f${n}`" class="is-filler" aria-hidden="true">
            <td
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{
                'is-frozen': i < frozen,
                'is-last-frozen': i === frozen - 1,
                'is-group-start': column.groupStart,
                'is-alt': column.groupIndex !== undefined && column.groupIndex % 2 === 1,
              }"
              :style="{ left: frozenLeft(i) }"
            />
            <td class="sheet-fill" />
          </tr>
        </tbody>

        <!-- Sums, where summing means something. An average of averages does
             not, so those columns are simply left blank. -->
        <tfoot v-if="hasTotals && viewRows.length">
          <tr>
            <td
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{
                'is-frozen': i < frozen,
                'is-last-frozen': i === frozen - 1,
                'is-num': isNumeric(column),
                'is-group-start': column.groupStart,
              }"
              :style="{ left: frozenLeft(i) }"
            >
              <template v-if="i === 0">Σ</template>
              <template v-else-if="totals[column.key] !== undefined">
                {{ format(totals[column.key], column) }}
              </template>
            </td>
            <td class="sheet-fill" />
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
