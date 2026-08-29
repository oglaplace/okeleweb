<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";

/**
 * Mark entry — the teacher's daily screen, and the only place marks are created.
 *
 * Optimised for the actual task: forty names, one column of numbers, typed in
 * order without touching the mouse. Enter moves down the column; the whole grid
 * saves in one request because a half-saved column is worse than a failed save.
 *
 * Absence is a checkbox, never a zero. A pupil who missed a devoir has not
 * scored nothing on it, and the engine excludes absences from the mean.
 */
const route = useRoute();
const classeId = computed(() => String(route.params.id));

const ancestors = ref<api.OrgUnit[]>([]);
const years = ref<api.AcademicYear[]>([]);
const periods = ref<api.Period[]>([]);
const offerings = ref<api.CourseOffering[]>([]);
const assessments = ref<api.Assessment[]>([]);
const types = ref<api.AssessmentType[]>([]);
const grid = ref<api.MarkGrid | null>(null);

const yearId = ref<string | null>(null);
const periodId = ref<string | null>(null);
const offeringId = ref<string | null>(null);
const assessmentId = ref<string | null>(null);

const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const savedAt = ref<string | null>(null);
const dirty = ref(false);

/** Périodes and offerings hang off the cycle and niveau, not the classe. */
const cycleId = computed(() => ancestors.value.find((a) => a.kind === "CYCLE")?.id ?? null);
const niveauId = computed(() => ancestors.value.find((a) => a.kind === "NIVEAU")?.id ?? null);
const classeName = computed(
  () => ancestors.value[ancestors.value.length - 1]?.name ?? "Classe",
);

const locked = computed(() => grid.value?.assessment.locked ?? false);
const maxScore = computed(() => Number(grid.value?.assessment.maxScore ?? 20));

/** How many pupils still have nothing entered — the teacher's progress bar. */
const remaining = computed(
  () => grid.value?.rows.filter((r) => r.score === null && !r.isAbsent).length ?? 0,
);

// ── new-assessment form ──
const creating = ref(false);
const newType = ref<string | null>(null);
const newTitle = ref("");
const newMax = ref(20);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [chain, yearList, typeList] = await Promise.all([
      api.orgUnits.ancestors(classeId.value),
      api.academics.years(),
      api.academics.assessmentTypes(),
    ]);
    ancestors.value = chain;
    years.value = yearList;
    types.value = typeList;
    newType.value = typeList[0]?.id ?? null;
    yearId.value = (yearList.find((y) => y.isCurrent) ?? yearList[0])?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

async function loadYearScoped() {
  periods.value = [];
  offerings.value = [];
  periodId.value = null;
  offeringId.value = null;
  if (!yearId.value) return;
  try {
    const [periodList, offeringList] = await Promise.all([
      cycleId.value ? api.academics.periods(cycleId.value, yearId.value) : Promise.resolve([]),
      niveauId.value ? api.academics.offerings(niveauId.value, yearId.value) : Promise.resolve([]),
    ]);
    periods.value = periodList;
    offerings.value = offeringList;
    periodId.value = periodList[0]?.id ?? null;
    offeringId.value = offeringList[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function loadAssessments() {
  assessments.value = [];
  assessmentId.value = null;
  grid.value = null;
  if (!periodId.value || !offeringId.value) return;
  try {
    assessments.value = await api.grading.assessments(
      periodId.value,
      offeringId.value,
      classeId.value,
    );
    assessmentId.value = assessments.value[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function loadGrid() {
  grid.value = null;
  dirty.value = false;
  savedAt.value = null;
  if (!assessmentId.value) return;
  try {
    grid.value = await api.grading.marks(assessmentId.value, classeId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function createAssessment() {
  if (!periodId.value || !offeringId.value || !newType.value) return;
  saving.value = true;
  error.value = null;
  try {
    const created = await api.grading.createAssessment({
      periodId: periodId.value,
      courseOfferingId: offeringId.value,
      assessmentTypeId: newType.value,
      classeId: classeId.value,
      title: newTitle.value || undefined,
      maxScore: newMax.value,
    });
    assessments.value = [...assessments.value, created];
    assessmentId.value = created.id;
    creating.value = false;
    newTitle.value = "";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Création impossible.";
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (!grid.value || !assessmentId.value) return;
  saving.value = true;
  error.value = null;
  try {
    const res = await api.grading.saveMarks(
      assessmentId.value,
      grid.value.rows.map((r) => ({
        studentId: r.studentId,
        score: r.score,
        isAbsent: r.isAbsent,
        isExcused: r.isExcused,
      })),
    );
    savedAt.value = new Date().toLocaleTimeString("fr-FR");
    dirty.value = false;
    void res;
  } catch (e) {
    // The API names the offending pupil and the barème — surface it verbatim
    // rather than replacing it with something vaguer.
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    saving.value = false;
  }
}

/** Enter moves down the column — the whole point of the screen. */
function onKey(event: KeyboardEvent, index: number) {
  if (event.key !== "Enter" && event.key !== "ArrowDown") return;
  event.preventDefault();
  void nextTick(() => {
    const next = document.querySelector<HTMLInputElement>(`[data-mark="${index + 1}"]`);
    next?.focus();
    next?.select();
  });
}

/** Ticking absent clears the box: absence is not a score. */
function toggleAbsent(row: api.MarkRow) {
  if (row.isAbsent) row.score = null;
  dirty.value = true;
}

onMounted(load);
watch(yearId, () => void loadYearScoped());
watch([periodId, offeringId], () => void loadAssessments());
watch(assessmentId, () => void loadGrid());
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Saisie des notes — {{ classeName }}</h1>
        <div class="page-sub">
          <span v-if="grid">
            {{ grid.assessment.subject }} · {{ grid.assessment.type }} ·
            sur {{ grid.assessment.maxScore }} · coef {{ grid.assessment.weight }}
          </span>
          <span v-else>Choisissez une matière et une évaluation</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <span v-if="savedAt" class="pill ok">Enregistré à {{ savedAt }}</span>
        <span v-else-if="dirty" class="pill warn">Non enregistré</span>
        <button
          class="btn primary"
          type="button"
          :disabled="!grid || saving || locked || !dirty"
          @click="save"
        >
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
      </div>
    </div>

    <!-- selectors -->
    <div class="card" style="margin-bottom: 16px">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
        <select v-if="years.length" v-model="yearId" class="btn">
          <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
        </select>
        <select v-if="periods.length" v-model="periodId" class="btn">
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <select v-if="offerings.length" v-model="offeringId" class="btn">
          <option v-for="o in offerings" :key="o.id" :value="o.id">{{ o.subject.name }}</option>
        </select>
        <select v-if="assessments.length" v-model="assessmentId" class="btn">
          <option v-for="a in assessments" :key="a.id" :value="a.id">
            {{ a.assessmentType.name }}{{ a.title ? ` — ${a.title}` : "" }} (/{{ a.maxScore }})
          </option>
        </select>
        <button
          v-if="periodId && offeringId"
          class="btn"
          type="button"
          @click="creating = !creating"
        >
          {{ creating ? "Annuler" : "Nouvelle évaluation" }}
        </button>
      </div>

      <div v-if="creating" class="card-body" style="border-top: 1px solid var(--line-soft)">
        <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end">
          <div class="field" style="margin: 0">
            <label for="atype">Type</label>
            <select id="atype" v-model="newType" class="btn">
              <option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div class="field" style="margin: 0">
            <label for="atitle">Intitulé</label>
            <input id="atitle" v-model="newTitle" placeholder="Devoir n°1" />
          </div>
          <div class="field" style="margin: 0; max-width: 110px">
            <label for="amax">Barème</label>
            <input id="amax" v-model.number="newMax" type="number" min="1" />
          </div>
          <button class="btn primary" type="button" :disabled="saving" @click="createAssessment">
            Créer
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div v-if="locked" class="form-error" style="background: var(--warn-soft); color: var(--warn)">
      Cette période est verrouillée — les notes sont en lecture seule.
    </div>

    <div v-if="loading" class="card"><div class="empty">Chargement…</div></div>

    <div v-else-if="!grid" class="card">
      <div class="empty">
        Aucune évaluation pour cette matière et cette période.
        <br />
        Créez-en une pour commencer la saisie.
      </div>
    </div>

    <div v-else class="card">
      <div class="card-head">
        <span>{{ grid.rows.length }} élève(s)</span>
        <span class="unit-meta">
          <template v-if="remaining > 0">{{ remaining }} sans note</template>
          <template v-else>Toutes les notes sont saisies</template>
        </span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th style="width: 34px">N°</th>
              <th>Matricule</th>
              <th>Élève</th>
              <th class="num" style="width: 120px">Note / {{ maxScore }}</th>
              <th style="width: 90px">Absent</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in grid.rows" :key="row.studentId">
              <td style="color: var(--ink-3)">{{ i + 1 }}</td>
              <td>{{ row.matricule }}</td>
              <td>{{ row.lastName.toUpperCase() }} {{ row.firstName }}</td>
              <td class="num">
                <input
                  v-model="row.score"
                  :data-mark="i"
                  class="mark-input"
                  type="number"
                  inputmode="decimal"
                  step="0.25"
                  min="0"
                  :max="maxScore"
                  :disabled="row.isAbsent || locked"
                  @input="dirty = true"
                  @keydown="onKey($event, i)"
                />
              </td>
              <td>
                <input
                  v-model="row.isAbsent"
                  type="checkbox"
                  :disabled="locked"
                  @change="toggleAbsent(row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
