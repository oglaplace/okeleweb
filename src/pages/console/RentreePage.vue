<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { useOrgStore } from "../../stores/org";

/**
 * LA RENTRÉE — ending one year and re-enrolling into the next.
 *
 * The app had no way to do either. `closedAt` existed on the year and nothing
 * ever set it, so a complex ran its second année with the first still marked
 * current: every screen defaulting to "the current year" kept opening last
 * year's, and every re-enrolment had to be typed one form at a time. Six
 * hundred pupils is not work anybody does by hand, so it was not done.
 *
 * The screen is the two acts in order, and it refuses to blur them: closing is
 * about the year that is ending, the rentrée is about the one starting, and
 * nothing is written until the office has read the list and corrected it.
 */
const org = useOrgStore();
const years = ref<api.AcademicYear[]>([]);
const fromId = ref<string | null>(null);
const toId = ref<string | null>(null);
const plan = ref<api.RolloverPlan | null>(null);

const loading = ref(true);
const planning = ref(false);
const working = ref(false);
const closing = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

/** studentId → the classe the office decided on. Starts as the proposal. */
const chosen = ref<Record<string, string>>({});
const repeating = ref<Record<string, boolean>>({});
const skipped = ref<Record<string, boolean>>({});

const fromYear = computed(() => years.value.find((y) => y.id === fromId.value) ?? null);
const toYear = computed(() => years.value.find((y) => y.id === toId.value) ?? null);

/** Every classe that can receive a pupil — the destination picker's options. */
const classes = computed(() =>
  org.ofKind(["CLASSE"]).filter((u) => !u.validTo),
);

onMounted(async () => {
  try {
    const [list] = await Promise.all([api.academics.years(), org.load()]);
    years.value = list;
    const current = list.find((y) => y.isCurrent) ?? list[0] ?? null;
    fromId.value = current?.id ?? null;
    // The next year by date, when the school has already opened one.
    const later = list
      .filter((y) => current && new Date(y.startsOn) > new Date(current.startsOn))
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    toId.value = later[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

async function loadPlan() {
  plan.value = null;
  if (!fromId.value || !toId.value || fromId.value === toId.value) return;
  planning.value = true;
  error.value = null;
  try {
    plan.value = await api.academics.rolloverPlan(fromId.value, toId.value);
    const pick: Record<string, string> = {};
    const rep: Record<string, boolean> = {};
    const skip: Record<string, boolean> = {};
    for (const c of plan.value.classes) {
      for (const p of c.pupils) {
        if (p.toClasseId) pick[p.studentId] = p.toClasseId;
        rep[p.studentId] = p.isRepeating;
        // Excluded pupils and those already enrolled start unticked: the
        // proposal never moves somebody the council removed, and never
        // enrols the same child twice.
        skip[p.studentId] = p.blocked === "EXCLU" || p.alreadyEnrolled;
      }
    }
    chosen.value = pick;
    repeating.value = rep;
    skipped.value = skip;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Projection impossible.";
  } finally {
    planning.value = false;
  }
}
watch([fromId, toId], loadPlan);

/** Applying a destination to a whole cohort — the normal case, once. */
function applyToClass(classeId: string, toClasseId: string) {
  const cohort = plan.value?.classes.find((c) => c.from.id === classeId);
  if (!cohort || !toClasseId) return;
  const next = { ...chosen.value };
  for (const p of cohort.pupils) {
    // A repeater stays where they are: applying "the class above" to the whole
    // cohort must not quietly promote the pupils the council held back.
    if (!repeating.value[p.studentId]) next[p.studentId] = toClasseId;
  }
  chosen.value = next;
}

const moves = computed(() =>
  (plan.value?.classes ?? [])
    .flatMap((c) => c.pupils)
    .filter((p) => !skipped.value[p.studentId] && chosen.value[p.studentId])
    .map((p) => ({
      studentId: p.studentId,
      toClasseId: chosen.value[p.studentId]!,
      isRepeating: !!repeating.value[p.studentId],
    })),
);

async function runRollover() {
  if (!toId.value || !moves.value.length || working.value) return;
  working.value = true;
  error.value = null;
  try {
    const res = await api.academics.rollover(toId.value, moves.value);
    notice.value =
      `${res.enrolled} élève(s) réinscrit(s) en ${toYear.value?.label}` +
      (res.alreadyEnrolled ? ` · ${res.alreadyEnrolled} l'étaient déjà` : "") +
      (res.failed ? ` · ${res.failed} en échec` : "") + ".";
    await loadPlan();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réinscription impossible.";
  } finally {
    working.value = false;
  }
}

const confirmingClose = ref(false);
async function closeYear() {
  if (!fromId.value) return;
  closing.value = true;
  error.value = null;
  try {
    await api.academics.closeYear(fromId.value);
    notice.value = `${fromYear.value?.label} clôturée. Les notes de l'année sont définitives.`;
    confirmingClose.value = false;
    years.value = await api.academics.years();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Clôture impossible.";
  } finally {
    closing.value = false;
  }
}

const DECISION_FR: Record<string, string> = {
  ADMIS: "Admis",
  ADMIS_SOUS_CONDITION: "Admis sous condition",
  REDOUBLE: "Redouble",
  EXCLU: "Exclu",
  RATTRAPAGE: "Rattrapage",
  EN_ATTENTE: "En attente",
};
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Fin d'année et rentrée</h1>
        <div class="page-sub">
          Clôturer l'année qui se termine, puis réinscrire chaque élève dans la
          suivante — d'après la décision du conseil, corrigée ici avant d'être écrite.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else>
      <div class="card">
        <div class="card-body rentree-pick">
          <div class="field">
            <label for="r-from">Année qui se termine</label>
            <select id="r-from" v-model="fromId">
              <option v-for="y in years" :key="y.id" :value="y.id">
                {{ y.label }}{{ y.closedAt ? " · clôturée" : "" }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="r-to">Année d'arrivée</label>
            <select id="r-to" v-model="toId">
              <option :value="null">—</option>
              <option v-for="y in years.filter((x) => x.id !== fromId)" :key="y.id" :value="y.id">
                {{ y.label }}
              </option>
            </select>
            <span v-if="!years.some((y) => y.id !== fromId)" class="hint">
              Aucune autre année n'existe encore.
              <RouterLink :to="{ name: 'action', params: { id: 'create-year' } }">
                En ouvrir une →
              </RouterLink>
            </span>
          </div>
          <div class="field field-actions">
            <button
              class="btn"
              type="button"
              :disabled="!fromYear || !!fromYear.closedAt || closing"
              @click="confirmingClose = true"
            >
              {{ fromYear?.closedAt ? "Année clôturée" : "Clôturer l'année" }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="planning" class="card"><div class="empty">Projection…</div></div>

      <div v-else-if="!toId" class="card">
        <div class="empty">
          <div class="empty-title">Choisissez l'année d'arrivée</div>
          <div>La réinscription déplace chaque élève d'une année vers la suivante.</div>
        </div>
      </div>

      <template v-else-if="plan">
        <div class="rentree-bar">
          <span>
            {{ moves.length }} réinscription(s) prête(s) sur
            {{ plan.classes.reduce((n, c) => n + c.pupils.length, 0) }} élève(s)
          </span>
          <button
            class="btn primary"
            type="button"
            :disabled="!moves.length || working"
            @click="runRollover"
          >
            <span v-if="working" class="btn-spin" aria-hidden="true" />
            Réinscrire {{ moves.length }} élève(s)
          </button>
        </div>

        <div v-for="cohort in plan.classes" :key="cohort.from.id" class="card is-grid">
          <div class="card-head rentree-head">
            <span>{{ cohort.from.name }} · {{ cohort.pupils.length }} élève(s)</span>
            <!-- One destination for the cohort, because that is the decision a
                 school actually makes; the exceptions are edited per row. -->
            <label class="rentree-apply">
              <span>Vers</span>
              <select
                :value="cohort.toClasseId ?? ''"
                @change="applyToClass(cohort.from.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Choisir…</option>
                <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
          </div>

          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-num">Réinscrire</th>
                  <th class="c-name">Élève</th>
                  <th class="c-text">Décision du conseil</th>
                  <th class="c-text">Classe d'arrivée</th>
                  <th class="c-text">Redoublant</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in cohort.pupils" :key="p.studentId">
                  <td class="c-num">
                    <input
                      type="checkbox"
                      :checked="!skipped[p.studentId]"
                      :aria-label="`Réinscrire ${p.lastName}`"
                      @change="skipped[p.studentId] = !($event.target as HTMLInputElement).checked"
                    />
                  </td>
                  <td class="c-name">
                    <span class="cell-strong">{{ p.lastName.toUpperCase() }} {{ p.firstName }}</span>
                    <span class="cell-sub">{{ p.matricule }}</span>
                  </td>
                  <td class="c-text">
                    <span
                      class="pill"
                      :class="{
                        ok: p.decision === 'ADMIS',
                        warn: p.decision === 'REDOUBLE' || p.decision === 'RATTRAPAGE',
                        danger: p.decision === 'EXCLU',
                      }"
                    >{{ DECISION_FR[p.decision] ?? p.decision }}</span>
                    <span v-if="p.alreadyEnrolled" class="cell-sub">déjà réinscrit</span>
                  </td>
                  <td class="c-text">
                    <select v-model="chosen[p.studentId]" :aria-label="`Classe de ${p.lastName}`">
                      <option value="">—</option>
                      <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </td>
                  <td class="c-text">
                    <input
                      v-model="repeating[p.studentId]"
                      type="checkbox"
                      :aria-label="`${p.lastName} redouble`"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

    <ConfirmDialog
      v-if="confirmingClose && fromYear"
      title="Clôturer cette année ?"
      :subtitle="fromYear.label"
      confirm-label="Clôturer"
      :busy="closing"
      @close="confirmingClose = false"
      @confirm="closeYear"
    >
      <p style="margin-top: 0">
        L'année cesse d'être l'année en cours : les écrans qui s'ouvrent sur
        « l'année courante » ouvriront la suivante, et les notes de celle-ci sont
        définitives.
      </p>
      <p class="hint">
        Rien n'est supprimé ni archivé. Les bulletins, les factures et les notes
        de {{ fromYear.label }} restent consultables et imprimables.
      </p>
    </ConfirmDialog>
  </div>
</template>
