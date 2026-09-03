<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import { useAuthStore } from "../../stores/auth";
import { KIND_FR } from "../../components/structure/kinds";

/**
 * THE GRILLE AS A DOCUMENT — its own page, not a dialog over the editor.
 *
 * A price list is something a school prints, hands to a parent, pins to a wall
 * and links to. All of those want an address. It was a modal, which gave it
 * none: you could not reload it, send it, or come back to it.
 *
 * What it shows is the RESOLVED grille — every unit with the price it would
 * actually be billed, inheritance included, across every fee type at once. The
 * editor is a working surface with one fee type per tab and prices that live
 * on a niveau; none of that is what a family reads. They read one table.
 *
 * Fee types with no price anywhere are DROPPED. A column of dashes is a column
 * about a fee the school does not charge, and printing it invites the question
 * "how much is the canteen?" of a school that runs none.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const yearId = computed(() => (typeof route.query.year === "string" ? route.query.year : null));

/**
 * Which units to print, carried in the URL.
 *
 * A query param rather than a store, so the sheet survives a reload and can be
 * sent to somebody: a document you cannot link to is not a document.
 */
const wanted = computed(() => {
  const raw = typeof route.query.units === "string" ? route.query.units : "";
  return new Set(raw.split(",").filter(Boolean));
});

const grid = ref<api.TariffGrid | null>(null);
const years = ref<api.AcademicYear[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

/**
 * "selection" only offered when the caller actually brought one.
 *
 * Re-derived when the query changes, not snapshotted at setup. Vue reuses the
 * component when only the query moves, so arriving here a second time with a
 * different selection left the scope pointing at the previous visit's answer —
 * which is a sheet that quietly prints the wrong units.
 */
const scope = ref<"all" | "selection">(wanted.value.size ? "selection" : "all");
watch(wanted, (next, prev) => {
  if ([...next].join(",") === [...prev].join(",")) return;
  scope.value = next.size ? "selection" : "all";
});

onMounted(async () => {
  try {
    years.value = await api.academics.years();
    const id = yearId.value ?? years.value.find((y) => y.isCurrent)?.id ?? years.value[0]?.id;
    if (!id) throw new api.ApiError(404, "Aucune année scolaire.");
    grid.value = await api.finance.tariffs(id);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Grille indisponible.";
  } finally {
    loading.value = false;
  }
});

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => XAF.format(v);

const yearLabel = computed(
  () => years.value.find((y) => y.id === (yearId.value ?? ""))?.label
    ?? years.value.find((y) => y.isCurrent)?.label
    ?? "",
);

/** unitId → feeTypeId → the price that unit sets itself. */
const stored = computed(() => {
  const map = new Map<string, Map<string, { amountXaf: number; installments: number }>>();
  for (const sch of grid.value?.schedules ?? []) {
    if (sch.serieId) continue;
    const row = map.get(sch.orgUnitId) ?? new Map();
    for (const item of sch.items) row.set(item.feeTypeId, item);
    map.set(sch.orgUnitId, row);
  }
  return map;
});

const parentOf = computed(
  () => new Map((grid.value?.units ?? []).map((u) => [u.id, u.parentId])),
);

/**
 * What a unit would actually be billed, walking UP exactly as the biller does.
 *
 * A printed figure the invoice would not use is worse than no figure at all.
 */
function effective(unitId: string, feeTypeId: string): { amountXaf: number; installments: number } | null {
  let cursor: string | null = unitId;
  while (cursor) {
    const own = stored.value.get(cursor)?.get(feeTypeId);
    if (own) return own;
    cursor = parentOf.value.get(cursor) ?? null;
  }
  return null;
}

/** The tree in reading order, parents before children. */
const ordered = computed(() => {
  const units = grid.value?.units ?? [];
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, typeof units>();
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    children.set(key, [...(children.get(key) ?? []), u]);
  }
  const out: typeof units = [];
  const walk = (parent: string | null) => {
    for (const u of children.get(parent) ?? []) {
      out.push(u);
      walk(u.id);
    }
  };
  walk(null);
  return out;
});

const rows = computed(() => {
  const base = ordered.value.filter((u) => u.priceable);
  const picked = scope.value === "selection" && wanted.value.size
    ? base.filter((u) => wanted.value.has(u.id))
    : base;

  return picked
    .map((u) => {
      const cells = (grid.value?.feeTypes ?? []).map((f) => ({
        feeTypeId: f.id,
        ...(effective(u.id, f.id) ?? { amountXaf: null as number | null, installments: 1 }),
      }));
      return {
        id: u.id,
        name: u.name,
        kind: u.kind,
        cells,
        total: cells.reduce((sum, c) => sum + (c.amountXaf ?? 0), 0),
      };
    })
    // A unit with no price at all is not on a price list.
    .filter((r) => r.total > 0);
});

/**
 * Columns for fee types that anybody on this sheet is charged.
 *
 * A type added to the grid and never priced would print a column of dashes —
 * a column about a fee the school does not charge, which invites the question
 * "how much is the canteen?" of a school that runs none.
 */
const columns = computed(() =>
  (grid.value?.feeTypes ?? []).filter((f) =>
    rows.value.some((r) => r.cells.find((c) => c.feeTypeId === f.id)?.amountXaf),
  ),
);

const dropped = computed(() => (grid.value?.feeTypes.length ?? 0) - columns.value.length);

const publication = computed(() => grid.value?.publication ?? null);
const printedOn = new Date().toLocaleDateString("fr-FR", {
  day: "2-digit", month: "long", year: "numeric",
});

function setScope(next: "all" | "selection") {
  scope.value = next;
}
const back = () => router.push({ name: "tariffs" });
const printSheet = () => window.print();
</script>

<template>
  <div class="printpage">
    <!-- Chrome. None of it prints — see the @media print rules. -->
    <div class="bulletin-bar printpage-bar">
      <button class="btn sm ghost" type="button" @click="back">← Retour à la grille</button>

      <template v-if="grid">
        <div class="viewswitch" role="group" aria-label="Étendue">
          <button
            class="viewswitch-btn"
            :class="{ 'is-on': scope === 'all' }"
            type="button"
            :aria-pressed="scope === 'all'"
            @click="setScope('all')"
          >Toute la grille</button>
          <button
            v-if="wanted.size"
            class="viewswitch-btn"
            :class="{ 'is-on': scope === 'selection' }"
            type="button"
            :aria-pressed="scope === 'selection'"
            @click="setScope('selection')"
          >Sélection ({{ wanted.size }})</button>
        </div>
        <span class="hint">{{ rows.length }} unité(s) tarifée(s)</span>
        <button class="btn primary sm" type="button" style="margin-left: auto" @click="printSheet">
          Imprimer / PDF
        </button>
      </template>
    </div>

    <Alert v-if="error" :closable="false">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <article v-else-if="grid" class="tarifdoc">
      <header class="tarifdoc-head">
        <div>
          <div class="tarifdoc-school">{{ auth.profile?.complexName ?? "" }}</div>
          <div class="tarifdoc-sub">Grille tarifaire · {{ yearLabel }}</div>
        </div>
        <div class="tarifdoc-meta">
          <template v-if="publication">Version {{ publication.version }}</template>
          <template v-else>Brouillon — non publiée</template>
          <span>Éditée le {{ printedOn }}</span>
        </div>
      </header>

      <!-- A draft says so on its face: a price list nothing is billing against
           is a quotation the school cannot honour. -->
      <p v-if="!publication" class="tarifdoc-warn">
        Cette grille n'est pas publiée : aucune facture n'est émise sur cette base
        pour le moment.
      </p>

      <table v-if="rows.length && columns.length" class="tarifdoc-table">
        <thead>
          <tr>
            <th>Unité</th>
            <th v-for="f in columns" :key="f.id" class="c-num">{{ f.name }}</th>
            <th class="c-num">Total année</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>
              <span class="tarifdoc-name">{{ r.name }}</span>
              <span class="tarifdoc-kind">{{ KIND_FR[r.kind] }}</span>
            </td>
            <td v-for="f in columns" :key="f.id" class="c-num">
              <template v-if="r.cells.find((c) => c.feeTypeId === f.id)?.amountXaf">
                {{ money(r.cells.find((c) => c.feeTypeId === f.id)!.amountXaf!) }}
                <small v-if="(r.cells.find((c) => c.feeTypeId === f.id)?.installments ?? 1) > 1">
                  ×{{ r.cells.find((c) => c.feeTypeId === f.id)!.installments }}
                </small>
              </template>
              <template v-else>—</template>
            </td>
            <td class="c-num tarifdoc-total">{{ money(r.total) }}</td>
          </tr>
        </tbody>
      </table>

      <p v-else class="tarifdoc-warn">
        Aucune unité tarifée dans cette sélection.
      </p>

      <footer class="tarifdoc-foot">
        Montants en francs CFA. « ×3 » indique un montant réparti en 3 tranches.
        <!-- Says so rather than leaving somebody to wonder where the column
             they added went. -->
        <template v-if="dropped > 0">
          {{ dropped }} type(s) de frais sans tarif ne figurent pas sur cette grille.
        </template>
      </footer>
    </article>
  </div>
</template>
