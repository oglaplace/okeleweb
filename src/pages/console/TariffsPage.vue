<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import Icon from "../../components/ui/Icon.vue";
import { KIND_FR } from "../../components/structure/kinds";
import TariffTree, { type TreeNode } from "../../components/finance/TariffTree.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { useAuthStore } from "../../stores/auth";

/**
 * LA GRILLE TARIFAIRE — the organisation, priced.
 *
 * Two rewrites got here, and the second one is the point. The first turned a
 * one-field-at-a-time form into a spreadsheet: units down, every fee type
 * across, amounts in the cells. That fixed the arithmetic problem and left the
 * real one — it was a flat list. A school's prices are not a flat list. They
 * are a decision taken at one level of a hierarchy and inherited by everything
 * under it, and a table that hides the hierarchy cannot show you that.
 *
 * So this draws the whole tree, fully expanded, and prices ONE fee type at a
 * time in tabs. Three consequences, all of them the point:
 *
 *   · Siblings sit next to each other. "Why does the 5e cost more than the 4e"
 *     is a question you can only ask when they are one line apart.
 *   · Inheritance is visible. A classe with no price of its own shows what it
 *     inherits, in grey, from wherever up the tree the price actually lives —
 *     which is exactly what applicableSchedule will find at billing time.
 *   · One column instead of eight. A tab per fee type is the difference
 *     between reading a price and hunting for it.
 *
 * The level checkboxes decide what is EDITABLE, not what is visible. Rows at a
 * chosen level are white and take a figure; every other row stays and stays
 * grey. Filtering them out instead — which is what the previous version did —
 * removes the context that makes the numbers mean anything.
 */
const auth = useAuthStore();

const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const grid = ref<api.TariffGrid | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => XAF.format(v);
/** Digits only: a thousands separator typed by hand must not become a price. */
const clean = (raw: string) => raw.replace(/\D/g, "");

onMounted(async () => {
  try {
    years.value = await api.academics.years();
    yearId.value = (years.value.find((y) => y.isCurrent) ?? years.value[0])?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Années scolaires indisponibles.";
    loading.value = false;
  }
});

async function load() {
  if (!yearId.value) return;
  loading.value = true;
  error.value = null;
  try {
    grid.value = await api.finance.tariffs(yearId.value);
    edits.value.clear();
    selected.value.clear();
    if (!feeTypes.value.some((f) => f.id === activeFee.value)) {
      activeFee.value = feeTypes.value[0]?.id ?? "";
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Grille indisponible.";
    grid.value = null;
  } finally {
    loading.value = false;
  }
}
watch(yearId, load);

const feeTypes = computed(() => grid.value?.feeTypes ?? []);
/** One tab at a time: eight columns of figures is a wall, not a grille. */
const activeFee = ref("");

/**
 * TWO PICTURES OF THE SAME DATA, and the operator chooses.
 *
 * The list answers "what does each unit cost" — dense, scannable, one line per
 * row, the shape you want when you are checking forty figures against each
 * other. The graph answers "what does this complex look like, and where do the
 * prices live in it" — the shape you want when you are deciding WHERE a price
 * belongs rather than what it is.
 *
 * Everything else is shared: the same tabs, the same level pills, the same
 * selection, the same pending edits. Switching view mid-edit keeps the typing,
 * because they are two renderings of one screen and not two screens.
 *
 * Remembered, because whichever one a given person thinks in is not something
 * they should have to re-choose every morning.
 */
type ViewMode = "list" | "graph";
const VIEW_KEY = "teya.tariffs.view";
const view = ref<ViewMode>(
  (localStorage.getItem(VIEW_KEY) as ViewMode | null) ?? "list",
);
const treeRef = ref<InstanceType<typeof TariffTree> | null>(null);

function setView(next: ViewMode) {
  view.value = next;
  localStorage.setItem(VIEW_KEY, next);
  // The graph opens fitted to the window rather than at whatever pan the last
  // visit left behind.
  if (next === "graph") requestAnimationFrame(() => treeRef.value?.fit());
}

// ── the tree ────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
  kind: api.OrgUnitKind;
  depth: number;
  priceable: boolean;
  /** Last child at its depth — draws the elbow rather than the tee. */
  last: boolean;
}

/**
 * The tree flattened into rows, depth-first, parents before children.
 *
 * Fully expanded on purpose. A collapsed tree makes you click to find out
 * whether a niveau is priced, and the whole reason to draw the hierarchy is to
 * see the answer for all of them at once.
 */
const rows = computed<Row[]>(() => {
  const units = grid.value?.units ?? [];
  if (!units.length) return [];

  const children = new Map<string | null, typeof units>();
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    // A parent outside the caller's scope makes its child a root here — which
    // is right: a censeur scoped to the collège sees the collège as the top.
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    const list = children.get(key) ?? [];
    list.push(u);
    children.set(key, list);
  }

  const out: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = children.get(parent) ?? [];
    list.forEach((u, i) => {
      out.push({
        id: u.id, name: u.name, kind: u.kind, depth,
        priceable: u.priceable, last: i === list.length - 1,
      });
      walk(u.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
});

/** unitId → feeTypeId → what is stored, general grille only. */
const stored = computed(() => {
  const map = new Map<string, Map<string, { amountXaf: number; installments: number }>>();
  for (const sch of grid.value?.schedules ?? []) {
    // Série-specific prices are a second axis this screen does not draw. Folding
    // them into the same cell would show a Terminale D price on the D-less row.
    if (sch.serieId) continue;
    const row = map.get(sch.orgUnitId) ?? new Map();
    for (const item of sch.items) row.set(item.feeTypeId, item);
    map.set(sch.orgUnitId, row);
  }
  return map;
});

const parentOf = computed(() => {
  const map = new Map<string, string | null>();
  for (const u of grid.value?.units ?? []) map.set(u.id, u.parentId);
  return map;
});

/**
 * What a unit would actually be billed, and where the figure comes from.
 *
 * Walks UP exactly the way `applicableSchedule` does at billing time, so what
 * this screen shows in grey is what the API will find when it issues the
 * facture. A price displayed here that the biller would not use would be worse
 * than showing nothing.
 */
function inherited(unitId: string, feeTypeId: string): { amountXaf: number; from: string } | null {
  let cursor = parentOf.value.get(unitId) ?? null;
  const names = new Map((grid.value?.units ?? []).map((u) => [u.id, u.name]));
  while (cursor) {
    const item = stored.value.get(cursor)?.get(feeTypeId);
    if (item) return { amountXaf: item.amountXaf, from: names.get(cursor) ?? "" };
    cursor = parentOf.value.get(cursor) ?? null;
  }
  return null;
}

// ── which levels may be priced ──────────────────────────────────────────────

/**
 * The kinds present in THIS complex, in tree order.
 *
 * Offering "Faculté" to a collège or "Cycle" to a university is offering a
 * control that does nothing. The list is what the tree actually contains.
 */
const levels = computed(() => {
  const seen = new Map<api.OrgUnitKind, number>();
  for (const r of rows.value) {
    if (!r.priceable) continue;
    if (!seen.has(r.kind)) seen.set(r.kind, r.depth);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([kind]) => kind);
});

/** Which levels are open for pricing. Everything else is grey. */
const editableKinds = ref<Set<string>>(new Set());

watch(levels, (list) => {
  if (editableKinds.value.size || !list.length) return;
  // Opens on the niveau, which is where a grille normally lives — "ce que
  // coûte la 6e" — falling back to whatever the deepest level is.
  const start = list.includes("NIVEAU") ? "NIVEAU" : list[list.length - 1]!;
  editableKinds.value = new Set([start]);
});

const isEditable = (r: Row) => r.priceable && editableKinds.value.has(r.kind);

function toggleKind(kind: string) {
  const next = new Set(editableKinds.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  editableKinds.value = next;
  // A row that is no longer editable cannot stay selected: applying a figure
  // to it would write a price the operator can no longer see.
  const keep = new Set(
    [...selected.value].filter((id) => {
      const row = rows.value.find((r) => r.id === id);
      return row && isEditable(row);
    }),
  );
  selected.value = keep;
}

// ── typing a price ──────────────────────────────────────────────────────────

/** What has been typed and not yet saved. Key is `unitId|feeTypeId`. */
const edits = ref(new Map<string, string>());
const saving = ref(false);
const savedAt = ref<number | null>(null);

/**
 * ANY call in flight, not just the autosave.
 *
 * The bar is the one place that reports what the screen is doing, so bulk
 * applies, billing runs and publication all raise it too — otherwise a long
 * operation looks like a frozen page.
 */
const busy = computed(() => saving.value || bulkBusy.value || issuing.value || publishing.value);

const cellKey = (unitId: string) => `${unitId}|${activeFee.value}`;

function cellValue(unitId: string): string {
  const key = cellKey(unitId);
  if (edits.value.has(key)) return edits.value.get(key)!;
  const item = stored.value.get(unitId)?.get(activeFee.value);
  return item ? String(item.amountXaf) : "";
}

const installmentsOf = (unitId: string) =>
  stored.value.get(unitId)?.get(activeFee.value)?.installments ?? 1;

function onType(unitId: string, raw: string) {
  edits.value.set(cellKey(unitId), clean(raw));
  edits.value = new Map(edits.value);
  scheduleFlush();
}

/**
 * Saved shortly after the typing stops, never on a button — the same bargain
 * the mark sheet makes.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 900);
}

async function flush() {
  if (!yearId.value || !edits.value.size || saving.value) return;

  const byUnit = new Map<string, { feeTypeId: string; amountXaf: number | null }[]>();
  for (const [key, raw] of edits.value) {
    const [unitId, feeTypeId] = key.split("|");
    if (!unitId || !feeTypeId) continue;
    const list = byUnit.get(unitId) ?? [];
    // An emptied cell means "we do not charge this here", which is a removal
    // and not a zero — and it makes the row fall back to what it inherits.
    list.push({ feeTypeId, amountXaf: raw === "" ? null : Number(raw) });
    byUnit.set(unitId, list);
  }

  saving.value = true;
  error.value = null;
  const pending = new Map(edits.value);
  try {
    for (const [unitId, items] of byUnit) {
      await api.finance.setTariffs({
        academicYearId: yearId.value, orgUnitIds: [unitId], items,
      });
    }
    /*
     * RELOAD FIRST, THEN CLEAR — and the order is the whole bug.
     *
     * It used to clear the pending edits and then fetch. For the width of that
     * fetch, `cellValue` fell through to `stored`, which was still the grid
     * from BEFORE the save and had no price for the cell. So the figure you had
     * just typed blanked out and reappeared a moment later, which reads as the
     * save having failed and undone itself.
     *
     * Fetching first means the fallback is already correct by the time the
     * override is dropped, and the cell never shows a value it does not have.
     */
    const fresh = await api.finance.tariffs(yearId.value);
    grid.value = fresh;
    // Only the cells that were in flight are cleared: anything typed while the
    // request was out stays pending rather than being silently dropped.
    for (const key of pending.keys()) {
      if (edits.value.get(key) === pending.get(key)) edits.value.delete(key);
    }
    edits.value = new Map(edits.value);
    savedAt.value = Date.now();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    saving.value = false;
    if (edits.value.size) scheduleFlush();
  }
}

// ── one figure, many units ──────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const bulkAmount = ref("");
const bulkInstallments = ref("");
const bulkBusy = ref(false);

const editableRows = computed(() => rows.value.filter(isEditable));
const allSelected = computed(
  () => editableRows.value.length > 0 && editableRows.value.every((r) => selected.value.has(r.id)),
);

function toggleAll() {
  const next = new Set(selected.value);
  if (allSelected.value) editableRows.value.forEach((r) => next.delete(r.id));
  else editableRows.value.forEach((r) => next.add(r.id));
  selected.value = next;
}

function toggleUnit(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

/**
 * Cmd/Ctrl-click a node: OPEN ITS LEVEL for pricing.
 *
 * A shortcut to the pills, not to the selection. With only "Département" open
 * and "École" wanted too, the long way round is to leave the diagram, find the
 * right pill in the bar, and come back. The short way is to point at any école
 * on screen and say "this kind" — which is why it has to work on a node that is
 * currently locked, since that is the only state it will ever be in when you
 * want it.
 *
 * Toggles, so the same gesture closes the level again — the pill's own
 * behaviour, reached from the other end.
 */
function activateLevel(kind: api.OrgUnitKind) {
  toggleKind(kind);
}

/** Closes every level at once — the way out of a wide selection. */
function clearLevels() {
  editableKinds.value = new Set();
  selected.value = new Set();
}

/**
 * Removes a price this unit sets itself.
 *
 * Distinct from emptying the field, only in that it is discoverable: the ×
 * says a price CAN be taken away, which an empty box does not. Both end at the
 * same null, which makes the unit fall back to what it inherits.
 */
function clearTariff(id: string) {
  edits.value.set(cellKey(id), "");
  edits.value = new Map(edits.value);
  scheduleFlush();
}

async function applyToSelection() {
  if (!selected.value.size || !activeFee.value || !yearId.value || bulkBusy.value) return;
  bulkBusy.value = true;
  error.value = null;
  try {
    const amount = clean(bulkAmount.value);
    const inst = clean(bulkInstallments.value);
    const res = await api.finance.setTariffs({
      academicYearId: yearId.value,
      orgUnitIds: [...selected.value],
      items: [{
        feeTypeId: activeFee.value,
        amountXaf: amount === "" ? null : Number(amount),
        ...(inst ? { installments: Number(inst) } : {}),
      }],
    });
    notice.value =
      amount === ""
        ? `Ligne retirée de ${res.units} unité(s).`
        : `${money(Number(amount))} XAF appliqué à ${res.units} unité(s).`;
    grid.value = await api.finance.tariffs(yearId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Application impossible.";
  } finally {
    bulkBusy.value = false;
  }
}

// ── billing against the grille ──────────────────────────────────────────────
const issuing = ref(false);

/** Only classes can be billed: a facture belongs to a pupil, and pupils sit in
 *  classes. Selecting a niveau here would bill nobody. */
const billable = computed(() =>
  rows.value.filter((r) => selected.value.has(r.id) && r.kind === "CLASSE"),
);

async function issueInvoices() {
  if (!yearId.value || !billable.value.length) return;
  issuing.value = true;
  error.value = null;
  try {
    const r = await api.finance.issueInvoices(yearId.value, billable.value.map((u) => u.id));
    notice.value =
      `${r.pupils} élève(s) : ${r.issued} facture(s) émise(s), ${r.alreadyBilled} déjà facturé(s)` +
      (r.noSchedule ? `, ${r.noSchedule} sans grille` : "") +
      (r.failed ? `, ${r.failed} en échec` : "") + ".";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Émission impossible.";
  } finally {
    issuing.value = false;
  }
}

// ── publication ─────────────────────────────────────────────────────────────

/**
 * A grille is a draft until somebody with `finance.admin` releases it.
 *
 * Same rule the timetable already follows, and for the same reason: every
 * intermediate state of a price list is wrong, and a facture issued against one
 * has charged a family a number the school never agreed. The API resolves
 * billing against the released snapshot, so what this button does is not
 * cosmetic — before it is pressed, nothing here prices anybody.
 */
const publishing = ref(false);
const confirmingPublish = ref(false);

const publication = computed(() => grid.value?.publication ?? null);
const canPublish = computed(() => auth.can("finance.admin"));

async function publish() {
  if (!yearId.value) return;
  publishing.value = true;
  confirmingPublish.value = false;
  error.value = null;
  try {
    const r = await api.finance.publishTariffs(yearId.value);
    notice.value = `Grille publiée — version ${r.version}, ${r.units} unité(s) tarifée(s).`;
    grid.value = await api.finance.tariffs(yearId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Publication impossible.";
  } finally {
    publishing.value = false;
  }
}

// ── the catalogue ───────────────────────────────────────────────────────────
const catalogue = ref<api.FeeTypeTemplate[]>([]);
const pickingTypes = ref(false);
const wanted = ref<Set<string>>(new Set());
const installing = ref(false);

async function openCatalogue() {
  pickingTypes.value = true;
  wanted.value = new Set();
  catalogue.value = await api.finance.feeCatalogue().catch(() => []);
}

async function install() {
  if (!wanted.value.size) return;
  installing.value = true;
  try {
    const r = await api.finance.installFeeTypes([...wanted.value]);
    notice.value = `${r.installed} type(s) de frais ajouté(s).`;
    pickingTypes.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Installation impossible.";
  } finally {
    installing.value = false;
  }
}

const RECURRENCE_FR: Record<string, string> = {
  ONCE: "une fois",
  PER_PERIOD: "par tranche",
  MONTHLY: "par mois",
};

const activeFeeType = computed(() => feeTypes.value.find((f) => f.id === activeFee.value) ?? null);

/**
 * The same rows, prepared for the diagram.
 *
 * Computed HERE rather than in the graph component so both views are fed by one
 * source of truth: an inherited figure the list showed and the graph did not
 * would be two answers to the same question.
 */
const treeNodes = computed<TreeNode[]>(() =>
  rows.value.map((r) => {
    const own = stored.value.get(r.id)?.get(activeFee.value);
    const inh = own ? null : inherited(r.id, activeFee.value);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      parentId: (grid.value?.units ?? []).find((u) => u.id === r.id)?.parentId ?? null,
      editable: isEditable(r),
      priceable: r.priceable,
      value: cellValue(r.id),
      inherited: inh?.amountXaf ?? null,
      inheritedFrom: inh?.from ?? null,
      installments: installmentsOf(r.id),
      own: !!own,
    };
  }),
);

/** How many units carry a price for the fee type on screen. */
const pricedCount = computed(
  () => rows.value.filter((r) => stored.value.get(r.id)?.has(activeFee.value)).length,
);
</script>

<template>
  <div class="tarif-page">
    <!--
      DELIBERATELY TERSE. The page used to explain itself in two sentences of
      prose and repeat the same idea in a hint under the bulk bar. An operator
      reads that once; after that it is 60px of the screen spent saying nothing
      they do not already know. What is left is the state that changes: which
      version is live, and whether the draft has moved since.
    -->
    <div class="page-head is-tight">
      <div class="tarif-title">
        <h1 class="page-title">Grille tarifaire</h1>
        <span v-if="publication" class="tarif-pub" :class="{ 'is-stale': publication.hasUnpublishedChanges }">
          v{{ publication.version }}
          <template v-if="publication.hasUnpublishedChanges"> · brouillon modifié</template>
        </span>
        <span v-else-if="grid" class="tarif-pub is-draft">Brouillon — ne facture personne</span>
      </div>
      <div class="page-actions">
        <!-- Two renderings of one screen. Everything else — tabs, levels,
             selection, pending edits — is shared, so switching mid-edit keeps
             the typing. -->
        <div class="viewswitch" role="group" aria-label="Présentation">
          <button
            class="viewswitch-btn"
            :class="{ 'is-on': view === 'list' }"
            type="button"
            :aria-pressed="view === 'list'"
            @click="setView('list')"
          >Liste</button>
          <button
            class="viewswitch-btn"
            :class="{ 'is-on': view === 'graph' }"
            type="button"
            :aria-pressed="view === 'graph'"
            @click="setView('graph')"
          >Graphe</button>
        </div>
        <label class="sheet-pick">
          <span>Année</span>
          <select v-model="yearId" aria-label="Année scolaire">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
        <button class="btn sm ghost" type="button" @click="openCatalogue">Types de frais</button>
        <button
          v-if="canPublish && grid"
          class="btn primary"
          :class="{ 'is-attn': !publication || publication.hasUnpublishedChanges }"
          type="button"
          :disabled="publishing"
          @click="confirmingPublish = true"
        >
          <span v-if="publishing" class="btn-spin" aria-hidden="true" />
          Publier
        </button>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else-if="grid">
      <div v-if="!feeTypes.length" class="empty">
        <div class="empty-title">Aucun type de frais</div>
        <div>
          Une grille chiffre des types de frais — inscription, scolarité, cantine.
          Choisissez ceux que vous facturez.
        </div>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="openCatalogue">
            Choisir les types de frais
          </button>
        </div>
      </div>

      <template v-else>
        <!-- One fee type at a time. Eight columns of figures is a wall. -->
        <div class="tarif-tabs" role="tablist">
          <button
            v-for="f in feeTypes"
            :key="f.id"
            class="tarif-tab"
            :class="{ 'is-active': f.id === activeFee }"
            type="button"
            role="tab"
            :aria-selected="f.id === activeFee"
            @click="activeFee = f.id"
          >
            <span class="tarif-tab-name">{{ f.name }}</span>
            <span class="tarif-tab-sub">{{ RECURRENCE_FR[f.recurrence] ?? f.recurrence }}</span>
          </button>
        </div>

        <div class="card tarif-panel">
          <!-- WHICH LEVELS MAY BE PRICED. Not a visibility filter: the tree
               stays whole, and these decide which rows go white. -->
          <div class="card-head tarif-levels">
            <span class="tarif-levels-lead">Niveaux tarifables</span>
            <button
              v-for="k in levels"
              :key="k"
              class="tarif-level"
              :class="{ 'is-on': editableKinds.has(k) }"
              type="button"
              :aria-pressed="editableKinds.has(k)"
              @click="toggleKind(k)"
            >
              <Icon :name="editableKinds.has(k) ? 'check' : 'chevronRight'" :size="12" />
              {{ KIND_FR[k] }}
            </button>
            <button
              v-if="editableKinds.size"
              class="tarif-level is-clear"
              type="button"
              title="Fermer tous les niveaux"
              @click="clearLevels"
            >Tout fermer</button>

            <!-- THE ONE PLACE that says what the screen is doing. Every call
                 raises it — autosave, bulk apply, billing, publication — so a
                 slow operation never looks like a frozen page. -->
            <span class="marksave" style="margin-left: auto">
              <span v-if="busy" class="btn-spin" aria-hidden="true" />
              {{
                busy ? "Enregistrement…"
                : edits.size ? `${edits.size} en attente`
                : savedAt ? "Enregistré" : `${pricedCount} tarifé(s)`
              }}
            </span>
          </div>

          <!-- The bulk bar appears only with a selection: an always-present
               strip of disabled controls is furniture. -->
          <div v-if="selected.size" class="tarif-bulk">
            <span class="tarif-bulk-lead">
              <strong>{{ selected.size }}</strong> sélectionné(s) ·
              {{ activeFeeType?.name }}
            </span>
            <input v-model="bulkAmount" inputmode="numeric" placeholder="Montant (XAF)" aria-label="Montant" />
            <input
              v-if="activeFeeType?.recurrence === 'PER_PERIOD'"
              v-model="bulkInstallments"
              inputmode="numeric"
              placeholder="Tranches"
              aria-label="Tranches"
              style="max-width: 96px"
            />
            <button class="btn primary sm" type="button" :disabled="bulkBusy" @click="applyToSelection">
              <span v-if="bulkBusy" class="btn-spin" aria-hidden="true" />
              Appliquer
            </button>
            <button
              v-if="billable.length"
              class="btn sm"
              type="button"
              :disabled="issuing"
              @click="issueInvoices"
            >
              <span v-if="issuing" class="btn-spin" aria-hidden="true" />
              Facturer {{ billable.length }} classe(s)
            </button>
            <button class="btn sm ghost" type="button" @click="selected = new Set()">Désélectionner</button>
          </div>

          <!-- THE DIAGRAM. Same tabs above it, same level pills, same
               selection — only the picture changes. -->
          <TariffTree
            v-if="view === 'graph'"
            ref="treeRef"
            :nodes="treeNodes"
            :selected="selected"
            :show-installments="activeFeeType?.recurrence === 'PER_PERIOD'"
            @type="onType($event.id, $event.raw)"
            @toggle="toggleUnit"
            @activate-level="activateLevel"
            @clear="clearTariff"
            @clear-selection="selected = new Set()"
          />

          <div v-else class="tarif-tree">
            <div class="tarif-row is-head">
              <span class="tarif-cell-pick">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :disabled="!editableRows.length"
                  aria-label="Tout sélectionner"
                  @change="toggleAll"
                />
              </span>
              <span class="tarif-cell-name">Organisation</span>
              <span class="tarif-cell-amount">Montant</span>
            </div>

            <div
              v-for="r in rows"
              :key="r.id"
              class="tarif-row"
              :class="{
                'is-editable': isEditable(r),
                'is-picked': selected.has(r.id),
              }"
            >
              <span class="tarif-cell-pick">
                <input
                  v-if="isEditable(r)"
                  type="checkbox"
                  :checked="selected.has(r.id)"
                  :aria-label="`Sélectionner ${r.name}`"
                  @change="toggleUnit(r.id)"
                />
              </span>

              <span class="tarif-cell-name" :style="{ paddingLeft: `${r.depth * 20}px` }">
                <!-- The elbow, so depth is readable without counting pixels. -->
                <span v-if="r.depth" class="tarif-twig" aria-hidden="true">{{ r.last ? "└" : "├" }}</span>
                <span class="tarif-name">{{ r.name }}</span>
                <span class="tarif-kind">{{ KIND_FR[r.kind] }}</span>
              </span>

              <span class="tarif-cell-amount">
                <template v-if="isEditable(r)">
                  <span
                    v-if="activeFeeType?.recurrence === 'PER_PERIOD' && cellValue(r.id)"
                    class="tarif-inst"
                    :title="`Réparti en ${installmentsOf(r.id)} tranche(s)`"
                  >×{{ installmentsOf(r.id) }}</span>
                  <input
                    class="mark-input"
                    inputmode="numeric"
                    :value="cellValue(r.id)"
                    :aria-label="`${activeFeeType?.name} — ${r.name}`"
                    :placeholder="inherited(r.id, activeFee) ? String(inherited(r.id, activeFee)!.amountXaf) : '—'"
                    @input="onType(r.id, ($event.target as HTMLInputElement).value)"
                  />
                </template>

                <!-- Locked, but priceable: show what it is, or what it would
                     inherit. The inherited figure is found by walking up
                     exactly the way applicableSchedule does, so what is shown
                     here in grey is what the biller will actually use.

                     NOT priceable — the direction, the comptabilité — shows
                     nothing at all. Those units never carry a grille and never
                     inherit one either: no pupil is enrolled in the
                     comptabilité, so "25 000 hérité" beside it was a figure
                     that would never be charged to anybody. -->
                <template v-else-if="!r.priceable" />
                <template v-else-if="stored.get(r.id)?.get(activeFee)">
                  <span class="tarif-own">{{ money(stored.get(r.id)!.get(activeFee)!.amountXaf) }}</span>
                </template>
                <template v-else-if="inherited(r.id, activeFee)">
                  <span class="tarif-inherit" :title="`Hérité de ${inherited(r.id, activeFee)!.from}`">
                    {{ money(inherited(r.id, activeFee)!.amountXaf) }}
                    <em>hérité</em>
                  </span>
                </template>
                <span v-else class="tarif-none">—</span>
              </span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!--
      PUBLICATION IS THE ONE ACT HERE THAT LEAVES THE OFFICE. It states what
      becomes true and for whom rather than asking "are you sure?".
    -->
    <ConfirmDialog
      v-if="confirmingPublish"
      title="Publier la grille tarifaire"
      :subtitle="years.find((y) => y.id === yearId)?.label"
      confirm-label="Publier"
      :busy="publishing"
      @close="confirmingPublish = false"
      @confirm="publish"
    >
      <p>
        Les prix affichés deviendront ceux appliqués par le système :
        <strong>toute facture émise après cette publication</strong> utilisera cette
        grille.
      </p>
      <p v-if="publication">
        Elle remplacera la version {{ publication.version }}, publiée le
        {{ new Date(publication.publishedAt).toLocaleDateString("fr-FR") }}.
        Les factures déjà émises ne changent pas.
      </p>
      <p v-else>
        Aucune grille n'est publiée pour le moment : tant qu'elle ne l'est pas,
        aucun élève n'est facturé et les paiements reçus sont portés en avance.
      </p>
    </ConfirmDialog>

    <!-- The catalogue: an offer, never an installation. -->
    <div v-if="pickingTypes" class="scrim" @click.self="pickingTypes = false">
      <div class="scrim-card dialog is-wide" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <div class="dialog-title"><span>Types de frais</span></div>
          <button class="btn sm ghost" type="button" @click="pickingTypes = false">Fermer</button>
        </div>
        <div class="dialog-body">
          <p class="hint" style="margin-top: 0">
            Ce que perçoivent les établissements d'ici. Cochez ce que vous facturez —
            rien ne s'installe tout seul : une grille qui annonce un transport que
            vous n'assurez pas est une grille qui ment.
          </p>
          <div class="catalogue-list">
            <label
              v-for="t in catalogue"
              :key="t.code"
              class="catalogue-item"
              :class="{ 'is-installed': t.installed }"
            >
              <input
                type="checkbox"
                :disabled="t.installed"
                :checked="t.installed || wanted.has(t.code)"
                @change="wanted.has(t.code) ? wanted.delete(t.code) : wanted.add(t.code);
                         wanted = new Set(wanted)"
              />
              <span class="catalogue-text">
                <span class="catalogue-name">
                  {{ t.name }}
                  <span class="tranche-tag">{{ RECURRENCE_FR[t.recurrence] }}</span>
                  <span v-if="t.installed" class="tranche-tag is-clear">déjà là</span>
                </span>
                <span class="catalogue-detail">{{ t.detail }}</span>
              </span>
            </label>
          </div>
        </div>
        <div class="dialog-actions" style="padding: 0 var(--s5) var(--s4)">
          <button class="btn primary" type="button" :disabled="!wanted.size || installing" @click="install">
            <span v-if="installing" class="btn-spin" aria-hidden="true" />
            Ajouter {{ wanted.size || "" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
