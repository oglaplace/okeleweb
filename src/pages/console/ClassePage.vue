<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";

/**
 * One classe: the roster, and the conseil de classe preview.
 *
 * The preview is a READ — it computes every pupil and writes nothing, which is
 * exactly what a council needs before it freezes anything. Issuing is a
 * separate, deliberate action.
 */
const route = useRoute();
const classeId = computed(() => String(route.params.id));

const classe = ref<api.OrgUnit | null>(null);
const ancestors = ref<api.OrgUnit[]>([]);
const years = ref<api.AcademicYear[]>([]);
const periods = ref<api.Period[]>([]);
const roster = ref<api.RosterRow[]>([]);
const preview = ref<api.ClassePreview | null>(null);

const yearId = ref<string | null>(null);
const periodId = ref<string | null>(null);

const loading = ref(true);
const previewing = ref(false);
const issuing = ref(false);
const issued = ref<number | null>(null);
const error = ref<string | null>(null);

/** Periods hang off the cycle, not the classe — walk up to find it. */
const cycleId = computed(
  () => ancestors.value.find((a) => a.kind === "CYCLE")?.id ?? classe.value?.parentId ?? null,
);

const names = (r: api.RosterRow) =>
  `${r.student.person.lastName.toUpperCase()} ${r.student.person.firstName}`;

/** studentId → roster row, so the preview table can show names not ids. */
const byStudent = computed(() => {
  const map = new Map<string, api.RosterRow>();
  for (const r of roster.value) map.set(r.studentId, r);
  return map;
});

const sortedPreview = computed(() =>
  preview.value
    ? [...preview.value.students].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    : [],
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [unit, chain, yearList] = await Promise.all([
      api.orgUnits.get(classeId.value),
      api.orgUnits.ancestors(classeId.value),
      api.academics.years(),
    ]);
    classe.value = unit;
    ancestors.value = chain;
    years.value = yearList;
    yearId.value = (yearList.find((y) => y.isCurrent) ?? yearList[0])?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

async function loadYearScoped() {
  if (!yearId.value) return;
  preview.value = null;
  periodId.value = null;
  try {
    const [rosterRows, periodList] = await Promise.all([
      api.enrollment.roster(classeId.value, yearId.value),
      cycleId.value ? api.academics.periods(cycleId.value, yearId.value) : Promise.resolve([]),
    ]);
    roster.value = rosterRows;
    periods.value = periodList;
    periodId.value = periodList[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

async function runPreview() {
  if (!periodId.value) return;
  previewing.value = true;
  error.value = null;
  try {
    preview.value = await api.grading.preview(classeId.value, periodId.value);
  } catch (e) {
    // NO_COEFFICIENT is the common one and it is actionable — say which
    // subject rather than "erreur".
    error.value = e instanceof api.ApiError ? e.message : "Calcul impossible.";
    preview.value = null;
  } finally {
    previewing.value = false;
  }
}

/**
 * Freezes the whole class's bulletins.
 *
 * Deliberately separate from the preview: the council looks at real numbers
 * first, and issuing is an explicit act with legal weight behind it.
 */
async function issue() {
  if (!periodId.value) return;
  issuing.value = true;
  error.value = null;
  try {
    const res = await api.grading.issue(classeId.value, periodId.value);
    issued.value = res.issued;
  } catch (e) {
    // SHEET_ISSUED is the common one and it is actionable — the API says to
    // correct via reissue rather than publishing twice.
    error.value = e instanceof api.ApiError ? e.message : "Publication impossible.";
  } finally {
    issuing.value = false;
  }
}

onMounted(load);
watch(yearId, () => void loadYearScoped());
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ classe?.name ?? "Classe" }}</h1>
        <!-- The path used to be repeated here; it is in the trail above now,
             from the root down to this class. -->
        <div class="page-sub">{{ roster.length }} élève(s) inscrit(s)</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <select v-if="years.length" v-model="yearId" class="btn">
          <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
        </select>
        <select v-if="periods.length" v-model="periodId" class="btn">
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <RouterLink class="btn" :to="{ name: 'marks', params: { id: classeId } }">
          Saisie des notes
        </RouterLink>
        <button class="btn" type="button" :disabled="!periodId || previewing" @click="runPreview">
          {{ previewing ? "Calcul…" : "Conseil de classe" }}
        </button>
        <button
          v-if="preview"
          class="btn primary"
          type="button"
          :disabled="issuing"
          @click="issue"
        >
          {{ issuing ? "Publication…" : "Publier les bulletins" }}
        </button>
        <RouterLink
          v-if="periodId"
          class="btn"
          :to="{ name: 'bulletins', params: { id: classeId } }"
        >
          Bulletins
        </RouterLink>
      </div>
    </div>

    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>
    <Alert v-if="issued !== null" kind="ok" :auto-dismiss="0" @close="issued = null">
      {{ issued }} bulletin(s) publié(s) et figé(s).
      <RouterLink :to="{ name: 'bulletins', params: { id: classeId } }">Imprimer →</RouterLink>
    </Alert>
    <div v-if="loading" class="card"><div class="empty">Chargement…</div></div>

    <!-- Preview: computed, nothing written. -->
    <div v-else-if="preview" class="card is-grid">
      <div class="card-head">
        <span>Résultats — {{ preview.gradingSystem.name }}</span>
        <span class="unit-meta">
          Moyenne classe {{ preview.classAvg ?? "—" }} ·
          min {{ preview.classMin ?? "—" }} · max {{ preview.classMax ?? "—" }} ·
          {{ preview.rankOf }} élèves
        </span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Rang</th>
              <th class="c-text">Matricule</th>
              <th class="c-name">Élève</th>
              <th>Moyenne</th>
              <th class="c-text">Mention</th>
              <th>Abs. (h)</th>
              <th class="c-text">Décision</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sortedPreview" :key="s.studentId">
              <td>{{ s.rank ?? "—" }}</td>
              <td class="c-text">{{ byStudent.get(s.studentId)?.student.matricule ?? "—" }}</td>
              <td class="c-name">
                {{ byStudent.get(s.studentId) ? names(byStudent.get(s.studentId)!) : s.studentId }}
              </td>
              <td>{{ s.average ?? "—" }}</td>
              <td class="c-text">{{ s.mention ?? "—" }}</td>
              <td>{{ s.absenceHours }}</td>
              <td class="c-text">
                <span v-if="s.isEliminated" class="pill danger">Éliminé</span>
                <span v-else-if="s.needsResit" class="pill warn">Rattrapage</span>
                <span v-else-if="s.isPassing" class="pill ok">Admis</span>
                <span v-else class="pill danger">Non admis</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Otherwise the plain roster. -->
    <div v-else class="card is-grid">
      <div class="card-head">
        <span>Effectif</span>
        <span class="unit-meta">{{ roster.length }} élève(s)</span>
      </div>
      <div v-if="!roster.length" class="empty">Aucun élève inscrit pour cette année.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Matricule</th>
              <th>Élève</th>
              <th>Série</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in roster" :key="r.id">
              <td>{{ r.student.matricule }}</td>
              <td>{{ names(r) }}</td>
              <td>{{ r.serie?.code ?? "—" }}</td>
              <td>
                <span v-if="r.isRepeating" class="pill warn">Redoublant</span>
                <span v-else class="pill">Inscrit</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
