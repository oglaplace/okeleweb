<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import BulletinSheet from "../../components/bulletin/BulletinSheet.vue";

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
const periods = ref<api.Period[]>([]);
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

async function loadPeriods() {
  sheets.value = [];
  periodId.value = null;
  if (!yearId.value || !cycleId.value) return;
  try {
    periods.value = await api.academics.periods(cycleId.value, yearId.value);
    periodId.value = periods.value[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function loadSheets() {
  if (!periodId.value) return;
  loading.value = true;
  error.value = null;
  try {
    sheets.value = await api.grading.sheetsForClasse(classeId.value, periodId.value);
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

    <div v-if="loading" class="card no-print"><div class="empty">Chargement…</div></div>

    <div v-else-if="!sheets.length" class="card no-print">
      <div class="empty">
        Aucun bulletin publié pour cette période.
        <br />
        Passez par le conseil de classe, puis publiez.
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
