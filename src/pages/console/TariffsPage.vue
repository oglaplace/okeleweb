<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import { KIND_FR } from "../../components/structure/kinds";

/**
 * LA GRILLE TARIFAIRE, as a grid you type into.
 *
 * It used to be a form: pick a unit, pick a fee type, type one amount, submit,
 * repeat. A collège with six niveaux and five fee types is thirty passes
 * through that form, with no way to see what you already entered — which is
 * how a school ends up charging the 5e more than the 4e by accident. And the
 * form could only ever CREATE: correcting a price collided with the unique
 * index and the save just failed.
 *
 * So it is the same shape as the mark sheet and the timetable, because it is
 * the same job — a table of numbers somebody fills in and checks against its
 * neighbours. Units down, fee types across, amounts in the cells, saved shortly
 * after the typing stops.
 *
 * The selection column is the other half of the ask. A school decides "the
 * inscription is 25 000 for the whole collège" once; making them type it six
 * times is six chances to type it differently. Tick the rows, type one figure,
 * apply.
 */
const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const grid = ref<api.TariffGrid | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => XAF.format(v);

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
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Grille indisponible.";
    grid.value = null;
  } finally {
    loading.value = false;
  }
}
watch(yearId, load);

/**
 * Which units are worth showing.
 *
 * A grille prices a level of study, and in practice that is the niveau: "ce
 * que coûte la 6e". Classes are offered too because some schools price 6e A
 * differently from 6e B, but they are off by default — sixty rows of the same
 * figure is not a grille, it is a wall.
 */
const KINDS = ["SCHOOL", "CYCLE", "NIVEAU", "CLASSE", "FACULTY", "DEPARTMENT"] as const;
const showKinds = ref<Set<string>>(new Set(["NIVEAU", "FACULTY", "DEPARTMENT"]));

const units = computed(() =>
  (grid.value?.units ?? []).filter((u) => showKinds.value.has(u.kind)),
);
const feeTypes = computed(() => grid.value?.feeTypes ?? []);

/** unitId → feeTypeId → what is stored. */
const stored = computed(() => {
  const map = new Map<string, Map<string, { amountXaf: number; installments: number }>>();
  for (const sch of grid.value?.schedules ?? []) {
    // The general grille only. Série-specific prices are a second axis this
    // screen does not draw yet, and silently folding them into the same cell
    // would show a Terminale D price on the Terminale A row.
    if (sch.serieId) continue;
    const row = map.get(sch.orgUnitId) ?? new Map();
    for (const item of sch.items) row.set(item.feeTypeId, item);
    map.set(sch.orgUnitId, row);
  }
  return map;
});

/** What has been typed and not yet saved. Key is `unitId|feeTypeId`. */
const edits = ref(new Map<string, string>());
const saving = ref(false);
const savedAt = ref<number | null>(null);

const cellKey = (unitId: string, feeTypeId: string) => `${unitId}|${feeTypeId}`;

function cellValue(unitId: string, feeTypeId: string): string {
  const key = cellKey(unitId, feeTypeId);
  if (edits.value.has(key)) return edits.value.get(key)!;
  const item = stored.value.get(unitId)?.get(feeTypeId);
  return item ? String(item.amountXaf) : "";
}

function installmentsOf(unitId: string, feeTypeId: string): number {
  return stored.value.get(unitId)?.get(feeTypeId)?.installments ?? 1;
}

/** Digits only: a thousands separator typed by hand must not become a price. */
const clean = (raw: string) => raw.replace(/\D/g, "");

function onType(unitId: string, feeTypeId: string, raw: string) {
  edits.value.set(cellKey(unitId, feeTypeId), clean(raw));
  edits.value = new Map(edits.value);
  scheduleFlush();
}

/**
 * Saved shortly after the typing stops, never on a button.
 *
 * The same bargain the mark sheet makes: nobody presses save, the writes go
 * out when the keystrokes stop, and the strip above says where they got to.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 900);
}

async function flush() {
  if (!yearId.value || !edits.value.size || saving.value) return;

  // One request per unit's worth of changes would be six requests to price a
  // cycle. Grouped by the set of items so a whole row goes in one call.
  const byUnit = new Map<string, { feeTypeId: string; amountXaf: number | null }[]>();
  for (const [key, raw] of edits.value) {
    const [unitId, feeTypeId] = key.split("|");
    if (!unitId || !feeTypeId) continue;
    const list = byUnit.get(unitId) ?? [];
    // An emptied cell means "we do not charge this", which is a removal and
    // not a zero — see setTariffs.
    list.push({ feeTypeId, amountXaf: raw === "" ? null : Number(raw) });
    byUnit.set(unitId, list);
  }

  saving.value = true;
  error.value = null;
  const pending = new Map(edits.value);
  try {
    for (const [unitId, items] of byUnit) {
      await api.finance.setTariffs({
        academicYearId: yearId.value,
        orgUnitIds: [unitId],
        items,
      });
    }
    // Only the cells that were in flight are cleared: anything typed while the
    // request was out stays pending rather than being silently dropped.
    for (const key of pending.keys()) {
      if (edits.value.get(key) === pending.get(key)) edits.value.delete(key);
    }
    edits.value = new Map(edits.value);
    savedAt.value = Date.now();
    grid.value = await api.finance.tariffs(yearId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    saving.value = false;
    if (edits.value.size) scheduleFlush();
  }
}

// ── applying one figure to many units ───────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const bulkFeeTypeId = ref("");
const bulkAmount = ref("");
const bulkInstallments = ref("");
const bulkBusy = ref(false);

const allShownSelected = computed(
  () => units.value.length > 0 && units.value.every((u) => selected.value.has(u.id)),
);

function toggleAll() {
  const next = new Set(selected.value);
  if (allShownSelected.value) units.value.forEach((u) => next.delete(u.id));
  else units.value.forEach((u) => next.add(u.id));
  selected.value = next;
}

function toggleUnit(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

const canApply = computed(
  () => selected.value.size > 0 && bulkFeeTypeId.value !== "" && !bulkBusy.value,
);

async function applyToSelection() {
  if (!canApply.value || !yearId.value) return;
  bulkBusy.value = true;
  error.value = null;
  try {
    const amount = clean(bulkAmount.value);
    const inst = clean(bulkInstallments.value);
    const res = await api.finance.setTariffs({
      academicYearId: yearId.value,
      orgUnitIds: [...selected.value],
      items: [{
        feeTypeId: bulkFeeTypeId.value,
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
const billableSelection = computed(() =>
  (grid.value?.units ?? []).filter((u) => selected.value.has(u.id) && u.kind === "CLASSE"),
);

async function issueInvoices() {
  if (!yearId.value || !billableSelection.value.length) return;
  issuing.value = true;
  error.value = null;
  try {
    const r = await api.finance.issueInvoices(
      yearId.value,
      billableSelection.value.map((u) => u.id),
    );
    notice.value =
      `${r.pupils} élève(s) : ${r.issued} facture(s) émise(s), ` +
      `${r.alreadyBilled} déjà facturé(s)` +
      (r.noSchedule ? `, ${r.noSchedule} sans grille` : "") +
      (r.failed ? `, ${r.failed} en échec` : "") + ".";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Émission impossible.";
  } finally {
    issuing.value = false;
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

/** What a unit costs in total for the year — the figure a parent asks for. */
function totalFor(unitId: string): number {
  let sum = 0;
  for (const f of feeTypes.value) {
    const raw = cellValue(unitId, f.id);
    if (raw) sum += Number(raw);
  }
  return sum;
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Grille tarifaire</h1>
        <div class="page-sub">
          Ce que coûte une année, unité par unité. Tapez dans les cases : rien à
          enregistrer, les prix partent tout seuls.
        </div>
      </div>
      <div class="page-actions">
        <label class="sheet-pick">
          <span>Année</span>
          <select v-model="yearId" aria-label="Année scolaire">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="openCatalogue">Types de frais</button>
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
        <!-- The one figure, applied to everything ticked. -->
        <div class="card tariff-bulk">
          <div class="card-body">
            <div class="tariff-bulk-row">
              <span class="tariff-bulk-lead">
                <strong>{{ selected.size }}</strong> unité(s) sélectionnée(s)
              </span>
              <select v-model="bulkFeeTypeId" aria-label="Type de frais">
                <option value="">Type de frais…</option>
                <option v-for="f in feeTypes" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <input
                v-model="bulkAmount"
                inputmode="numeric"
                placeholder="Montant (XAF)"
                aria-label="Montant à appliquer"
              />
              <input
                v-model="bulkInstallments"
                inputmode="numeric"
                placeholder="Tranches"
                aria-label="Tranches"
                style="max-width: 100px"
              />
              <button class="btn primary" type="button" :disabled="!canApply" @click="applyToSelection">
                <span v-if="bulkBusy" class="btn-spin" aria-hidden="true" />
                Appliquer
              </button>
              <button
                v-if="billableSelection.length"
                class="btn"
                type="button"
                :disabled="issuing"
                @click="issueInvoices"
              >
                <span v-if="issuing" class="btn-spin" aria-hidden="true" />
                Facturer {{ billableSelection.length }} classe(s)
              </button>
            </div>
            <!-- Says what an empty amount does, before somebody discovers it. -->
            <span class="hint">
              Montant vide = la ligne est retirée de ces unités (« nous ne facturons pas ça »),
              ce qui n'est pas la même chose qu'un prix de zéro.
            </span>
          </div>
        </div>

        <div class="card">
          <div class="card-head tariff-tools">
            <span class="hint">Afficher</span>
            <label v-for="k in KINDS" :key="k" class="unpaid-toggle">
              <input
                type="checkbox"
                :checked="showKinds.has(k)"
                @change="showKinds.has(k) ? showKinds.delete(k) : showKinds.add(k);
                         showKinds = new Set(showKinds)"
              />
              <span>{{ KIND_FR[k] }}</span>
            </label>
            <span class="marksave" style="margin-left: auto">
              <span v-if="saving" class="btn-spin" aria-hidden="true" />
              {{ saving ? "Enregistrement…" : edits.size ? `${edits.size} modification(s)` : savedAt ? "Enregistré" : "" }}
            </span>
          </div>

          <div v-if="!units.length" class="empty">
            <div class="empty-title">Aucune unité affichée</div>
            <div>Cochez un type d'unité ci-dessus.</div>
          </div>

          <div v-else class="table-wrap">
            <table class="data tariff-grid">
              <thead>
                <tr>
                  <th class="tariff-pick">
                    <input
                      type="checkbox"
                      :checked="allShownSelected"
                      aria-label="Tout sélectionner"
                      @change="toggleAll"
                    />
                  </th>
                  <th class="c-name">Unité</th>
                  <th v-for="f in feeTypes" :key="f.id" class="c-num tariff-head">
                    {{ f.name }}
                    <!-- The périodicité is what turns a price into an
                         échéancier, so it belongs on the column that sets it. -->
                    <span class="tariff-head-sub">{{ RECURRENCE_FR[f.recurrence] ?? f.recurrence }}</span>
                  </th>
                  <th class="c-num">Total année</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in units" :key="u.id" :class="{ 'is-picked': selected.has(u.id) }">
                  <td class="tariff-pick">
                    <input
                      type="checkbox"
                      :checked="selected.has(u.id)"
                      :aria-label="`Sélectionner ${u.name}`"
                      @change="toggleUnit(u.id)"
                    />
                  </td>
                  <td class="c-name">
                    <span class="cell-strong">{{ u.name }}</span>
                    <span class="cell-sub">{{ KIND_FR[u.kind] }}</span>
                  </td>
                  <td v-for="f in feeTypes" :key="f.id" class="c-num tariff-cell">
                    <span class="tariff-cell-box">
                      <span
                        v-if="f.recurrence === 'PER_PERIOD' && cellValue(u.id, f.id)"
                        class="tariff-inst"
                        :title="`Réparti en ${installmentsOf(u.id, f.id)} tranche(s)`"
                      >×{{ installmentsOf(u.id, f.id) }}</span>
                      <input
                        class="mark-input"
                        inputmode="numeric"
                        :value="cellValue(u.id, f.id)"
                        :aria-label="`${f.name} — ${u.name}`"
                        @input="onType(u.id, f.id, ($event.target as HTMLInputElement).value)"
                      />
                    </span>
                  </td>
                  <td class="c-num tariff-total">
                    {{ totalFor(u.id) ? money(totalFor(u.id)) : "—" }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

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
