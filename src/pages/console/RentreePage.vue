<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { useOrgStore } from "../../stores/org";

/**
 * RÉINSCRIPTION — and it is not only a year boundary.
 *
 * The first version of this screen assumed it was. It is the common case in a
 * collège, but the general shape is: a period ends — usually with exams —
 * students opt into the next one, and coming back normally costs something the
 * grille already prices. A université does that every semester, twice a year,
 * with the same students staying in the same year.
 *
 * So the screen asks which boundary first:
 *
 *   ANNÉE → ANNÉE   a new Enrollment in the next year's classe, from the
 *                   conseil's decision (admis monte, redouble reste).
 *   PÉRIODE         the same students opting into the next semester, with what
 *                   they owe for it beside their name.
 *
 * Closing the year stays here because it belongs to the same moment, and it is
 * refused while a période is still open.
 */
const org = useOrgStore();

/** Which boundary this réinscription is about. */
type Mode = "year" | "period";
const mode = ref<Mode>("year");

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

// ── the période boundary — semesters, and any term that ends with exams ─────
const periodScopes = computed(() => org.ofKind(["CYCLE", "SCHOOL"]).filter((u) => !u.validTo));
const scopeId = ref<string | null>(null);
const periods = ref<api.Period[]>([]);
const periodId = ref<string | null>(null);
const periodPlan = ref<api.PeriodRegistrationPlan | null>(null);
const picked = ref<Record<string, boolean>>({});

async function loadPeriods() {
  periods.value = [];
  periodId.value = null;
  periodPlan.value = null;
  if (!scopeId.value || !fromId.value) return;
  periods.value = await api.academics.periods(scopeId.value, fromId.value).catch(() => []);
  // The one that has not started yet is the one you register FOR; failing
  // that, the one running now.
  const today = Date.now();
  const ahead = periods.value.filter((p) => new Date(p.startsOn).getTime() > today);
  const now = periods.value.find(
    (p) => new Date(p.startsOn).getTime() <= today && today <= new Date(p.endsOn).getTime(),
  );
  periodId.value = (ahead[0] ?? now ?? periods.value[periods.value.length - 1])?.id ?? null;
}
watch([scopeId, fromId], loadPeriods);

async function loadPeriodPlan() {
  periodPlan.value = null;
  picked.value = {};
  if (!periodId.value) return;
  planning.value = true;
  error.value = null;
  try {
    periodPlan.value = await api.academics.periodRegistration(periodId.value);
    const next: Record<string, boolean> = {};
    for (const c of periodPlan.value.classes) {
      // Already active or deliberately blocked: not offered again by default.
      for (const p of c.pupils) next[p.studentId] = p.status === "PENDING";
    }
    picked.value = next;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Projection impossible.";
  } finally {
    planning.value = false;
  }
}
watch(periodId, loadPeriodPlan);

const periodPupils = computed(() => (periodPlan.value?.classes ?? []).flatMap((c) => c.pupils));
const toRegister = computed(() =>
  periodPupils.value.filter((p) => picked.value[p.studentId]).map((p) => p.studentId),
);

async function activate(status: "ACTIVE" | "BLOCKED") {
  if (!periodId.value || !toRegister.value.length || working.value) return;
  working.value = true;
  error.value = null;
  try {
    const res = await api.academics.registerPeriod(periodId.value, toRegister.value, { status });
    notice.value =
      status === "ACTIVE"
        ? `${res.activated} élève(s) réinscrit(s) pour ${periodPlan.value?.period.label}` +
          (res.unchanged ? ` · ${res.unchanged} déjà réinscrit(s)` : "") + "."
        : `${res.activated} élève(s) bloqué(s) pour ${periodPlan.value?.period.label}.`;
    await loadPeriodPlan();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réinscription impossible.";
  } finally {
    working.value = false;
  }
}

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;

const STATUS_FR: Record<string, string> = {
  PENDING: "En attente",
  ACTIVE: "Réinscrit",
  BLOCKED: "Bloqué",
};

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
        <h1 class="page-title">Réinscription</h1>
        <div class="page-sub">
          Une période se termine, les élèves se réinscrivent pour la suivante — et
          la réinscription se paie. C'est vrai d'une année à l'autre comme d'un
          semestre à l'autre ; choisissez laquelle.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else>
      <!-- The boundary first, because everything below depends on it. -->
      <div class="viewswitch" role="group" aria-label="Type de réinscription" style="margin-bottom: var(--s4)">
        <button
          class="viewswitch-btn"
          :class="{ 'is-on': mode === 'year' }"
          type="button"
          title="Fin d'année : les élèves passent dans la classe suivante"
          @click="mode = 'year'"
        >D'une année à la suivante</button>
        <button
          class="viewswitch-btn"
          :class="{ 'is-on': mode === 'period' }"
          type="button"
          title="Fin de semestre ou de trimestre : les élèves s'inscrivent pour la période suivante"
          @click="mode = 'period'"
        >D'une période à la suivante</button>
      </div>

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
          <div v-if="mode === 'year'" class="field">
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
          <!-- The période boundary needs the calendar it hangs off: périodes
               belong to a cycle or a school, not to a classe. -->
          <template v-if="mode === 'period'">
            <div class="field">
              <label for="r-scope">Cycle ou école</label>
              <select id="r-scope" v-model="scopeId">
                <option :value="null">Choisir…</option>
                <option v-for="u in periodScopes" :key="u.id" :value="u.id">{{ u.name }}</option>
              </select>
            </div>
            <div class="field">
              <label for="r-period">Période à ouvrir</label>
              <select id="r-period" v-model="periodId" :disabled="!periods.length">
                <option :value="null">—</option>
                <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
              <span v-if="scopeId && !periods.length" class="hint">
                Aucune période définie pour ce cycle sur cette année.
              </span>
            </div>
          </template>

          <div v-if="mode === 'year'" class="field field-actions">
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

      <div v-else-if="mode === 'year' && !toId" class="card">
        <div class="empty">
          <div class="empty-title">Choisissez l'année d'arrivée</div>
          <div>La réinscription déplace chaque élève d'une année vers la suivante.</div>
        </div>
      </div>

      <template v-else-if="mode === 'year' && plan">
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

      <!-- ── the période boundary ──────────────────────────────────────── -->
      <div v-else-if="mode === 'period' && !periodId" class="card">
        <div class="empty">
          <div class="empty-title">Choisissez la période à ouvrir</div>
          <div>
            La réinscription d'un semestre porte sur les élèves déjà inscrits pour
            l'année : ils ne changent pas de classe, ils optent pour la période
            suivante.
          </div>
        </div>
      </div>

      <template v-else-if="mode === 'period' && periodPlan">
        <div class="rentree-bar">
          <span>
            {{ toRegister.length }} sélectionné(s) ·
            {{ periodPupils.filter((p) => p.status === 'ACTIVE').length }} déjà réinscrit(s)
            sur {{ periodPupils.length }}
            <template v-if="periodPlan.fee">
              · frais : {{ periodPlan.fee.name }}
            </template>
            <template v-else>
              · aucun frais de réinscription au tarif
            </template>
          </span>
          <span style="display: flex; gap: var(--s2)">
            <!-- Blocking is a decision a school makes and should be able to
                 record, rather than leaving somebody PENDING and hoping
                 whoever knows why is still there in January. -->
            <button
              class="btn"
              type="button"
              :disabled="!toRegister.length || working"
              @click="activate('BLOCKED')"
            >Bloquer</button>
            <button
              class="btn primary"
              type="button"
              :disabled="!toRegister.length || working"
              @click="activate('ACTIVE')"
            >
              <span v-if="working" class="btn-spin" aria-hidden="true" />
              Réinscrire {{ toRegister.length }} élève(s)
            </button>
          </span>
        </div>

        <div v-for="cohort in periodPlan.classes" :key="cohort.classe.id" class="card is-grid">
          <div class="card-head">
            <span>{{ cohort.classe.name }} · {{ cohort.pupils.length }} élève(s)</span>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-num">Réinscrire</th>
                  <th class="c-name">Élève</th>
                  <th class="c-text">État</th>
                  <th class="c-num">Versé pour la période</th>
                  <th class="c-text">Facture</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in cohort.pupils" :key="p.studentId">
                  <td class="c-num">
                    <input
                      type="checkbox"
                      :checked="!!picked[p.studentId]"
                      :aria-label="`Réinscrire ${p.lastName}`"
                      @change="picked[p.studentId] = ($event.target as HTMLInputElement).checked"
                    />
                  </td>
                  <td class="c-name">
                    <span class="cell-strong">{{ p.lastName.toUpperCase() }} {{ p.firstName }}</span>
                    <span class="cell-sub">{{ p.matricule }}</span>
                  </td>
                  <td class="c-text">
                    <span
                      class="pill"
                      :class="{ ok: p.status === 'ACTIVE', danger: p.status === 'BLOCKED' }"
                    >{{ STATUS_FR[p.status] }}</span>
                  </td>
                  <td class="c-num">{{ p.paidXaf ? money(p.paidXaf) : "—" }}</td>
                  <td class="c-text">
                    <RouterLink
                      class="cell-sub"
                      :to="{ name: 'student-finance', params: { id: p.studentId } }"
                    >{{ p.invoice?.number ?? "Voir les finances" }}</RouterLink>
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
