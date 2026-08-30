<script setup lang="ts">
import { computed } from "vue";
import { IDENTITY, type SheetColumn, type SheetTab } from "./columns";

/**
 * Rows as a spreadsheet, because that is what a class list IS.
 *
 * Schools already keep this in Excel — the effectif down the side, whatever
 * they are working on across the top — and the console's card-and-table layout
 * was fighting that rather than serving it. So: a dense grid, a frozen header,
 * frozen identity columns, and a totals row. The point of density here is not
 * aesthetics; a titulaire comparing forty pupils needs them on one screen, and
 * every pixel of padding costs a row.
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
}>();
const emit = defineEmits<{ pick: [row: Record<string, unknown>] }>();

/**
 * Flat list of the leaf columns, whether or not they came from groups.
 *
 * A grouped tab declares only its groups, and identity is prepended here — the
 * first version left it to the caller and the marks tab shipped without names
 * on it. Whose 12.63 that is, is the one thing the column cannot be read
 * without.
 */
const columns = computed<SheetColumn[]>(() =>
  props.tab.groups
    ? [...IDENTITY, ...props.tab.groups.flatMap((g) => g.columns)]
    : (props.tab.columns ?? []),
);

const frozen = computed(() => Math.min(props.tab.frozen ?? IDENTITY.length, columns.value.length));

/**
 * Where a frozen column starts: the widths of the ones before it.
 *
 * Computed rather than written into the stylesheet as nth-child offsets, which
 * is what it was — those hard-coded one tab's widths and were silently wrong on
 * every other. Widths are `ch` under `box-sizing: border-box`, so the padding is
 * already inside them and only the collapsed borders need adding back.
 */
const DEFAULT_WIDTH = 12;
/**
 * Declared widths are CONTENT widths; the padding is added here.
 *
 * `box-sizing: border-box` is global, so `width: 7ch` on a cell with 10px of
 * padding each side leaves about two characters of room — which is how a column
 * of marks came out reading "10….". Every width in columns.ts means "this many
 * characters", and this is the one place that knows what a cell costs around
 * them.
 */
const PADDING_PX = 21; // 10 + 10, plus the collapsed border
const widthOf = (column: SheetColumn) => column.width ?? DEFAULT_WIDTH;
const cssWidth = (column: SheetColumn) => `calc(${widthOf(column)}ch + ${PADDING_PX}px)`;

function frozenLeft(index: number): string | undefined {
  if (index >= frozen.value) return undefined;
  const ch = columns.value.slice(0, index).reduce((sum, c) => sum + widthOf(c), 0);
  return `calc(${ch}ch + ${index * PADDING_PX}px)`;
}

const totals = computed(() => {
  const out: Record<string, number> = {};
  for (const column of columns.value) {
    if (!column.total) continue;
    out[column.key] = props.rows.reduce((sum, row) => {
      const v = row[column.key];
      return sum + (typeof v === "number" ? v : 0);
    }, 0);
  }
  return out;
});
const hasTotals = computed(() => Object.keys(totals.value).length > 0);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function format(value: unknown, column: SheetColumn): string {
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

const isNumeric = (column: SheetColumn) =>
  ["number", "money", "percent", "grade"].includes(column.type ?? "text");

/** Only where the column asked for it, and only on the wrong side of zero. */
function warns(value: unknown, column: SheetColumn): boolean {
  return (
    column.warnAbove !== undefined && typeof value === "number" && value >= column.warnAbove
  );
}

/**
 * Widths live in a colgroup, not on the cells.
 *
 * Two reasons, both found the hard way. Under `table-layout: fixed` the browser
 * takes column widths from the FIRST header row, and the marks tab's first row
 * is the période groups — so widths got split evenly across each group and the
 * declared ones were ignored. And a trailing slack column made the auto layout
 * redistribute everything, which left the frozen columns' computed offsets
 * pointing at the wrong place: names overlapping the column beside them.
 *
 * A colgroup is the one declaration that both the layout and `frozenLeft` read,
 * so they cannot disagree.
 */
const colWidths = computed(() => columns.value.map(cssWidth));
</script>

<template>
  <div class="sheet" :class="{ 'is-clickable': clickable }">
    <div class="sheet-scroll">
      <table class="sheet-table">
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
            >
              {{ group.label }}
            </th>
            <th class="sheet-fill" />
          </tr>
          <tr>
            <th
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{ 'is-frozen': i < frozen, 'is-last-frozen': i === frozen - 1, 'is-num': isNumeric(column) }"
              :style="{ left: frozenLeft(i) }"
              :title="column.hint ?? column.label"
            >
              {{ column.label }}
            </th>
            <!-- Absorbs the slack so declared widths are honoured instead of
                 the last real column stretching to fill the table. -->
            <th class="sheet-fill" />
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in rows"
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
                'is-warn': warns(row[column.key], column),
                'is-empty': row[column.key] === null || row[column.key] === undefined,
              }"
              :style="{ left: frozenLeft(i) }"
            >
              {{ format(row[column.key], column) }}
            </td>
            <td class="sheet-fill" />
          </tr>

          <tr v-if="!rows.length">
            <td :colspan="columns.length + 1" class="sheet-blank">Aucune ligne.</td>
          </tr>
        </tbody>

        <!-- Sums, where summing means something. An average of averages does
             not, so those columns are simply left blank. -->
        <tfoot v-if="hasTotals && rows.length">
          <tr>
            <td
              v-for="(column, i) in columns"
              :key="column.key"
              :class="{ 'is-frozen': i < frozen, 'is-last-frozen': i === frozen - 1, 'is-num': isNumeric(column) }"
              :style="{ left: frozenLeft(i) }"
            >
              <template v-if="i === 0">{{ rows.length }} ligne(s)</template>
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
