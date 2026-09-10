<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import * as api from "../../lib/api";
import BulletinSheet from "../../components/bulletin/BulletinSheet.vue";
import NoCurrentPeriod from "../../components/console/NoCurrentPeriod.vue";

/**
 * The print run.
 *
 * Every current bulletin for one classe and period, one per page. The browser's
 * own print dialog is the PDF writer — no server-side renderer, nothing to
 * install on the school's machine, and it works identically on the cloud and on
 * an edge box with no internet.
 *
 * Superseded versions are excluded by the API: a stack containing both v1 and
 * v2 of the same pupil is the exact confusion versioning exists to prevent.
 */
const route = useRoute();
const classeId = computed(() => String(route.params.id));

const sheets = ref<api.MarkSheet[]>([]);
/** Bulletins the conseil took back to correct: not printable until re-frozen. */
const reopened = ref(0);
const periods = ref<api.Period[]>([]);
/** True when the school has declared no période en cours — see the banner. */
const noCurrent = ref(false);
const years = ref<api.AcademicYear[]>([]);
const ancestors = ref<api.OrgUnit[]>([]);

const yearId = ref<string | null>(null);
const periodId = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

/** Périodes hang off the cycle, not the classe. */
const cycleId = computed(() => ancestors.value.find((a) => a.kind === "CYCLE")?.id ?? null);

/** The établissement name for the bulletin header. */
const schoolName = computed(
  () => ancestors.value.find((a) => a.kind === "SCHOOL")?.name ?? null,
);

const classeName = computed(
  () => ancestors.value[ancestors.value.length - 1]?.name ?? "Classe",
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [chain, yearList] = await Promise.all([
      api.orgUnits.ancestors(classeId.value),
      api.academics.years(),
    ]);
    ancestors.value = chain;
    years.value = yearList;
    yearId.value = (yearList.find((y) => y.isCurrent) ?? yearList[0])?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

/**
 * THE PERIOD A SCHOOL IS ACTUALLY IN, not the first of the year.
 *
 * THE BUG THIS FIXES. This page opened on `periods[0]` — the 1er trimestre —
 * whatever the date. A council held in février issues the 2e trimestre's
 * bulletins, and the print screen then showed an empty 1er trimestre: bulletins
 * existed, the operator could see them one at a time from a pupil's own page,
 * and this screen said there were none. The one place the whole run is printed
 * from was the one place they were invisible.
 *
 * So: the période containing today, else the last one already started, else the
 * first. Bulletins are printed while the term is on or just after it.
 */

async function loadPeriods() {
  sheets.value = [];
  periodId.value = null;
  if (!yearId.value || !cycleId.value) return;
  try {
    periods.value = await api.academics.periods(cycleId.value, yearId.value);
    /*
     * THE PÉRIODE THE SCHOOL DECLARED — not one guessed from today's date.
     *
     * A print run opening on the wrong trimestre prints the wrong bulletins,
     * and the old guess ("the one containing today, else the last started")
     * disagreed with the conseil screen whenever a term ran late. When nothing
     * is declared, nothing opens: the banner sends the operator to the
     * calendar rather than printing a term nobody chose.
     */
    const declared = api.currentPeriodOf(periods.value);
    noCurrent.value = declared === null;
    // The declaration or nothing: a screen that falls back to the wall
    // calendar writes into a trimestre that ended in décembre.
    periodId.value = declared?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function loadSheets() {
  if (!periodId.value) return;
  loading.value = true;
  error.value = null;
  try {
    /*
     * ISSUED ONLY. The endpoint answers with drafts too — a bulletin the
     * council reopened to correct is a DRAFT again — and printing those would
     * hand a family a document under signature lines that no meeting has
     * validated. The count of them is shown instead, above the run.
     */
    const rows = await api.grading.sheetsForClasse(classeId.value, periodId.value);
    sheets.value = rows.filter((s) => s.status === "ISSUED");
    reopened.value = rows.filter((s) => s.status === "DRAFT").length;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
    sheets.value = [];
  } finally {
    loading.value = false;
  }
}

/** `window` is not in template scope — expose it explicitly. */
function printRun() {
  window.print();
}

onMounted(load);
watch(yearId, () => void loadPeriods());
watch(periodId, () => void loadSheets());
</script>

<template>
  <div>
    <!-- Screen chrome only — hidden in print by .no-print. -->
    <div class="page-head no-print">
      <div>
        <h1 class="page-title">Bulletins — {{ classeName }}</h1>
        <div class="page-sub">
          {{ sheets.length }} bulletin(s) · un par page à l'impression
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <select v-if="years.length" v-model="yearId" class="btn">
          <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
        </select>
        <select v-if="periods.length" v-model="periodId" class="btn">
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <button
          class="btn primary"
          type="button"
          :disabled="!sheets.length"
          @click="printRun"
        >
          Imprimer
        </button>
      </div>
    </div>

    <div v-if="error" class="form-error no-print">{{ error }}</div>

    <NoCurrentPeriod
      v-if="noCurrent && periods.length"
      what="l'impression des bulletins"
    />

    <div v-if="reopened" class="alert is-warn no-print">
      {{ reopened }} bulletin(s) ont été rouverts par le conseil et ne sont pas
      imprimés : ils redeviennent des documents une fois figés de nouveau.
    </div>

    <div v-if="loading" class="card no-print"><div class="empty">Chargement…</div></div>

    <div v-else-if="!sheets.length" class="card no-print">
      <div class="empty">
        <div class="empty-title">
          {{ reopened ? "Les bulletins de cette période sont rouverts"
             : "Aucun bulletin figé pour cette période" }}
        </div>
        <div>
          Les bulletins d'une période sont figés par le conseil de classe. Ceux
          d'une autre période sont peut-être prêts — le sélecteur ci-dessus les
          montre.
        </div>
        <div class="empty-actions">
          <RouterLink class="btn primary" :to="{ name: 'classe', params: { id: classeId } }">
            Ouvrir le conseil de classe
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- The print run itself. -->
    <div v-else class="bulletin-run">
      <BulletinSheet
        v-for="sheet in sheets"
        :key="sheet.id"
        :sheet="sheet"
        :school-name="schoolName"
      />
    </div>
  </div>
</template>
