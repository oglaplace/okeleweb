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
    <!--
      TWO COMPACT ROWS above the grid, where there were a poster and a card.
      The heading, its subtitle, the save state and four dropdowns took about a
      fifth of the window on a laptop, on a screen whose whole job is a column
      of forty numbers. Nothing is gone; it is one line of chrome instead of
      three blocks of it.
    -->
    <div class="nodebar">
      <div class="nodebar-id">
        <h1 class="nodebar-title">Saisie des notes — {{ classeName }}</h1>
        <span class="nodebar-kind">
          <template v-if="grid">
            {{ grid.assessment.subject }} · {{ grid.assessment.type }} ·
            sur {{ grid.assessment.maxScore }} · coef {{ grid.assessment.weight }}
          </template>
          <template v-else>Choisissez une matière et une évaluation</template>
        </span>
      </div>
      <div class="nodebar-stats">
        <span v-if="savedAt" class="pill ok">Enregistré à {{ savedAt }}</span>
        <span v-else-if="dirty" class="pill warn">Non enregistré</span>
        <button
          class="btn sm primary"
          type="button"
          :disabled="!grid || saving || locked || !dirty"
          @click="save"
        >
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
      </div>
    </div>

    <div class="markbar">
      <label v-if="years.length" class="sheet-pick">
        <span>Année</span>
        <select v-model="yearId" aria-label="Année scolaire">
          <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
        </select>
      </label>
      <label v-if="periods.length" class="sheet-pick">
        <span>Période</span>
        <select v-model="periodId" aria-label="Période">
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label v-if="offerings.length" class="sheet-pick">
        <span>Matière</span>
        <select v-model="offeringId" aria-label="Matière">
          <option v-for="o in offerings" :key="o.id" :value="o.id">{{ o.subject.name }}</option>
        </select>
      </label>
      <label v-if="assessments.length" class="sheet-pick">
        <span>Épreuve</span>
        <select v-model="assessmentId" aria-label="Épreuve">
          <option v-for="a in assessments" :key="a.id" :value="a.id">
            {{ a.assessmentType.name }}{{ a.title ? ` — ${a.title}` : "" }} (/{{ a.maxScore }})
          </option>
        </select>
      </label>
      <button
        v-if="periodId && offeringId"
        class="btn sm"
        type="button"
        @click="creating = !creating"
      >
        {{ creating ? "Annuler" : "Nouvelle évaluation" }}
      </button>

      <div class="sheet-bar-fill" />
      <!--
        The one thing that stops this screen dead, said where it stops.
        An épreuve carries a type; with none defined the form below opens with
        an empty dropdown and no explanation. The readiness engine reports it as
        blocking for the whole school — this is the same fact, in the place a
        teacher meets it.
      -->
      <span v-if="!types.length" class="pill warn">Aucun type d'évaluation défini</span>
    </div>

    <div v-if="creating" class="markbar is-form">
      <div class="field">
        <label for="atype">Type</label>
        <select id="atype" v-model="newType">
          <option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="atitle">Intitulé</label>
        <input id="atitle" v-model="newTitle" placeholder="Devoir n°1" />
      </div>
      <div class="field is-narrow">
        <label for="amax">Barème</label>
        <input id="amax" v-model.number="newMax" type="number" min="1" />
      </div>
      <button
        class="btn sm primary"
        type="button"
        :disabled="saving || !newType"
        @click="createAssessment"
      >
        Créer
      </button>
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

    <div v-else class="card is-grid">
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
              <th class="c-text" style="width: 34px">N°</th>
              <th class="c-text">Matricule</th>
              <th class="c-name">Élève</th>
              <th style="width: 120px">Note / {{ maxScore }}</th>
              <th class="c-text" style="width: 90px">Absent</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in grid.rows" :key="row.studentId">
              <td class="c-text" style="color: var(--ink-3)">{{ i + 1 }}</td>
              <td class="c-text">{{ row.matricule }}</td>
              <td class="c-name">{{ row.lastName.toUpperCase() }} {{ row.firstName }}</td>
              <td>
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
              <td class="c-text">
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
