<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import { useOrgStore } from "../../stores/org";

/**
 * RÉINSCRIPTION — one pupil at a time.
 *
 * The first two versions of this screen were bulk operations: read a proposed
 * list of six hundred, correct it, commit. That is the right tool for a rentrée
 * planned in July and the wrong one for what actually happens at a school —
 * a family arrives at the counter in septembre with one child, and the operator
 * needs THAT child, found by name, with everything the decision needs beside
 * them: what the conseil decided, where they would go, what they still owe on
 * the year that is ending, and what coming back costs.
 *
 * Two boundaries, one act:
 *
 *   ANNÉE     the pupil moves into next year's classe — a new enrolment.
 *   PÉRIODE   the same pupils opt into the next semester of the year they are
 *             already in. A université does this twice a year.
 *
 * Closing the year is NOT here. It belongs with locking a period — both are
 * about the calendar, and neither is about a pupil.
 */
const org = useOrgStore();

type Mode = "year" | "period";
const mode = ref<Mode>("year");

const years = ref<api.AcademicYear[]>([]);
const toId = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const working = ref<string | null>(null);

const classes = computed(() => org.ofKind(["CLASSE"]).filter((u) => !u.validTo));
const classeName = (id: string | null) => (id ? org.byId(id)?.name ?? "—" : "—");

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;

onMounted(async () => {
  try {
    const [list] = await Promise.all([api.academics.years(), org.load()]);
    years.value = list;
    const current = list.find((y) => y.isCurrent) ?? list[0] ?? null;
    // The year they are moving INTO: the next one by date, if the school has
    // opened it.
    const later = list
      .filter((y) => current && new Date(y.startsOn) > new Date(current.startsOn))
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    toId.value = later[0]?.id ?? current?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

// ── année → année, one pupil at a time ──────────────────────────────────────
const query = ref("");
const candidates = ref<api.ReinscriptionCandidates["candidates"]>([]);
const searching = ref(false);
/** studentId → the classe the operator settled on. Starts at the proposal. */
const target = ref<Record<string, string>>({});

async function search() {
  if (!toId.value) return;
  searching.value = true;
  error.value = null;
  try {
    const res = await api.academics.reinscriptionCandidates(toId.value, query.value.trim());
    candidates.value = res.candidates;
    const pick: Record<string, string> = {};
    for (const c of res.candidates) if (c.suggestedClasseId) pick[c.studentId] = c.suggestedClasseId;
    target.value = pick;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Recherche impossible.";
    candidates.value = [];
  } finally {
    searching.value = false;
  }
}
watch([toId, mode], () => { if (mode.value === "year") void search(); });
let timer: ReturnType<typeof setTimeout> | null = null;
watch(query, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void search(), 350);
});

/** One pupil, re-enrolled. Nothing bulk, nothing implicit. */
async function reinscrire(c: api.ReinscriptionCandidates["candidates"][number]) {
  const classeId = target.value[c.studentId];
  if (!toId.value || !classeId || working.value) return;
  working.value = c.studentId;
  error.value = null;
  try {
    const res = await api.academics.rollover(toId.value, [
      { studentId: c.studentId, toClasseId: classeId, isRepeating: c.isRepeating },
    ]);
    notice.value = res.enrolled
      ? `${c.lastName.toUpperCase()} ${c.firstName} réinscrit(e) en ${classeName(classeId)}.`
      : `${c.lastName.toUpperCase()} ${c.firstName} était déjà réinscrit(e).`;
    candidates.value = candidates.value.filter((x) => x.studentId !== c.studentId);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réinscription impossible.";
  } finally {
    working.value = null;
  }
}

// ── période → période, the semester case ────────────────────────────────────
/**
 * A calendar belongs to an ÉTABLISSEMENT.
 *
 * Only écoles here: an école runs one calendar for every cycle inside it, and
 * offering the cycle as well invited three copies of the same three dates.
 */
const schools = computed(() => org.ofKind(["SCHOOL"]).filter((u) => !u.validTo));
const schoolId = ref<string | null>(null);
const periods = ref<api.Period[]>([]);
const periodId = ref<string | null>(null);
const periodPlan = ref<api.PeriodRegistrationPlan | null>(null);
const periodQuery = ref("");

async function loadPeriods() {
  periods.value = [];
  periodId.value = null;
  periodPlan.value = null;
  const year = years.value.find((y) => y.isCurrent)?.id ?? toId.value;
  if (!schoolId.value || !year) return;
  periods.value = await api.academics.periods(schoolId.value, year).catch(() => []);
  const today = Date.now();
  const ahead = periods.value.filter((p) => new Date(p.startsOn).getTime() > today);
  const now = periods.value.find(
    (p) => new Date(p.startsOn).getTime() <= today && today <= new Date(p.endsOn).getTime(),
  );
  periodId.value = (ahead[0] ?? now ?? periods.value[periods.value.length - 1])?.id ?? null;
}
watch(schoolId, loadPeriods);

async function loadPeriodPlan() {
  periodPlan.value = null;
  if (!periodId.value) return;
  searching.value = true;
  error.value = null;
  try {
    periodPlan.value = await api.academics.periodRegistration(periodId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    searching.value = false;
  }
}
watch(periodId, loadPeriodPlan);

/** Flattened and filtered — the counter looks somebody up, it does not scroll. */
const periodPupils = computed(() => {
  const all = (periodPlan.value?.classes ?? []).flatMap((c) => c.pupils);
  const q = periodQuery.value.trim().toLowerCase();
  return q
    ? all.filter((p) =>
        `${p.lastName} ${p.firstName} ${p.matricule} ${p.classe.name}`.toLowerCase().includes(q))
    : all;
});

async function setStatus(
  p: api.PeriodRegistrationPlan["classes"][number]["pupils"][number],
  status: "ACTIVE" | "BLOCKED",
) {
  if (!periodId.value || working.value) return;
  working.value = p.studentId;
  error.value = null;
  try {
    await api.academics.registerPeriod(periodId.value, [p.studentId], { status });
    notice.value =
      status === "ACTIVE"
        ? `${p.lastName.toUpperCase()} ${p.firstName} réinscrit(e) pour ${periodPlan.value?.period.label}.`
        : `${p.lastName.toUpperCase()} ${p.firstName} bloqué(e) pour ${periodPlan.value?.period.label}.`;
    await loadPeriodPlan();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    working.value = null;
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
const STATUS_FR: Record<string, string> = {
  PENDING: "En attente",
  ACTIVE: "Réinscrit",
  BLOCKED: "Bloqué",
};
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Réinscription</h1>
        <div class="page-sub">
          Une période se termine, l'élève se réinscrit pour la suivante — et la
          réinscription se paie. Un élève à la fois : cherchez-le, vérifiez ce
          qu'il doit, réinscrivez-le.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else>
      <!-- The boundary, then the one question that boundary needs. -->
      <div class="card">
        <div class="card-body reins-form">
          <div class="field">
            <label>Type de réinscription</label>
            <div class="viewswitch">
              <button
                class="viewswitch-btn"
                :class="{ 'is-on': mode === 'year' }"
                type="button"
                @click="mode = 'year'"
              >Année suivante</button>
              <button
                class="viewswitch-btn"
                :class="{ 'is-on': mode === 'period' }"
                type="button"
                @click="mode = 'period'"
              >Période suivante</button>
            </div>
            <!-- Also what keeps this field the same height as the ones beside
                 it: every control on the row carries a hint under it, so they
                 bottom-align instead of one floating 25px proud. -->
            <span class="hint">
              Année : l'élève change de classe. Période : il garde la sienne.
            </span>
          </div>

          <template v-if="mode === 'year'">
            <div class="field">
              <label for="r-to">Année d'arrivée</label>
              <select id="r-to" v-model="toId">
                <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
              <span class="hint">L'année dans laquelle il entre.</span>
            </div>
            <div class="field field-grow">
              <label for="r-q">Élève</label>
              <input
                id="r-q"
                v-model="query"
                autocomplete="off"
                placeholder="Nom, prénom ou matricule…"
              />
              <span class="hint">
                Seuls les élèves inscrits une année précédente et pas encore
                réinscrits pour {{ years.find((y) => y.id === toId)?.label ?? "cette année" }}
                apparaissent.
              </span>
            </div>
          </template>

          <template v-else>
            <div class="field">
              <label for="r-school">École</label>
              <select id="r-school" v-model="schoolId">
                <option :value="null">Choisir…</option>
                <option v-for="u in schools" :key="u.id" :value="u.id">{{ u.name }}</option>
              </select>
              <span class="hint">Le calendrier appartient à l'établissement.</span>
            </div>
            <div class="field">
              <label for="r-period">Période à ouvrir</label>
              <select id="r-period" v-model="periodId" :disabled="!periods.length">
                <option :value="null">—</option>
                <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
              <span v-if="schoolId && !periods.length" class="hint">
                Aucune période définie pour cette école.
              </span>
            </div>
            <div class="field field-grow">
              <label for="r-pq">Élève</label>
              <input
                id="r-pq"
                v-model="periodQuery"
                autocomplete="off"
                placeholder="Nom, prénom ou matricule…"
              />
            </div>
          </template>
        </div>
      </div>

      <div v-if="searching" class="card"><div class="empty">Recherche…</div></div>

      <!-- ── année → année ───────────────────────────────────────────────── -->
      <template v-else-if="mode === 'year'">
        <div v-if="!candidates.length" class="card">
          <div class="empty">
            <div class="empty-title">
              {{ query ? "Aucun élève ne correspond" : "Aucun élève à réinscrire" }}
            </div>
            <div v-if="!query">
              Tous les élèves des années précédentes sont déjà réinscrits — ou
              aucune année antérieure n'existe encore.
            </div>
            <div class="empty-actions">
              <RouterLink class="btn" :to="{ name: 'enroll' }">
                Inscrire un nouvel élève
              </RouterLink>
            </div>
          </div>
        </div>

        <div v-else class="card is-grid">
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Élève</th>
                  <th class="c-text">Venait de</th>
                  <th class="c-text">Conseil</th>
                  <th class="c-num">Reste dû</th>
                  <th class="c-text">Classe d'arrivée</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in candidates" :key="c.studentId">
                  <td class="c-name">
                    <RouterLink
                      class="cell-strong"
                      :to="{ name: 'student', params: { id: c.studentId } }"
                    >{{ c.lastName.toUpperCase() }} {{ c.firstName }}</RouterLink>
                    <span class="cell-sub">{{ c.matricule }}</span>
                  </td>
                  <td class="c-text">
                    {{ c.from.classe }}
                    <span class="cell-sub">{{ c.from.yearLabel }}</span>
                  </td>
                  <td class="c-text">
                    <span
                      class="pill"
                      :class="{
                        ok: c.decision === 'ADMIS',
                        warn: c.decision === 'REDOUBLE' || c.decision === 'RATTRAPAGE',
                        danger: c.decision === 'EXCLU',
                      }"
                    >{{ DECISION_FR[c.decision] ?? c.decision }}</span>
                  </td>
                  <!-- What they owe on the year they are leaving: the question
                       the counter asks before it agrees to anything. -->
                  <td class="c-num" :class="{ 'is-warn': c.owesXaf > 0 }">
                    {{ c.owesXaf > 0 ? money(c.owesXaf) : "—" }}
                  </td>
                  <td class="c-text">
                    <select v-model="target[c.studentId]" :aria-label="`Classe de ${c.lastName}`">
                      <option value="">Choisir…</option>
                      <option v-for="k in classes" :key="k.id" :value="k.id">{{ k.name }}</option>
                    </select>
                  </td>
                  <td>
                    <button
                      class="btn sm primary"
                      type="button"
                      :disabled="!target[c.studentId] || working === c.studentId"
                      @click="reinscrire(c)"
                    >
                      <span v-if="working === c.studentId" class="btn-spin" aria-hidden="true" />
                      Réinscrire
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- ── période → période ───────────────────────────────────────────── -->
      <template v-else>
        <div v-if="!periodId" class="card">
          <div class="empty">
            <div class="empty-title">Choisissez l'école et la période</div>
            <div>
              La réinscription d'un semestre porte sur les élèves déjà inscrits
              pour l'année : ils ne changent pas de classe, ils optent pour la
              période suivante.
            </div>
          </div>
        </div>

        <template v-else-if="periodPlan">
          <div class="rentree-bar">
            <span>
              {{ periodPupils.length }} élève(s) ·
              {{ periodPupils.filter((p) => p.status === 'ACTIVE').length }} réinscrit(s)
              <template v-if="periodPlan.fee"> · frais : {{ periodPlan.fee.name }}</template>
              <template v-else> · aucun frais de réinscription au tarif</template>
            </span>
          </div>

          <div class="card is-grid">
            <div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th class="c-name">Élève</th>
                    <th class="c-text">Classe</th>
                    <th class="c-text">État</th>
                    <th class="c-num">Versé</th>
                    <th class="c-text">Facture</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in periodPupils" :key="p.studentId">
                    <td class="c-name">
                      <span class="cell-strong">{{ p.lastName.toUpperCase() }} {{ p.firstName }}</span>
                      <span class="cell-sub">{{ p.matricule }}</span>
                    </td>
                    <td class="c-text">{{ p.classe.name }}</td>
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
                    <td>
                      <span style="display: flex; gap: var(--s2); justify-content: flex-end">
                        <button
                          v-if="p.status !== 'BLOCKED'"
                          class="btn sm ghost"
                          type="button"
                          :disabled="working === p.studentId"
                          @click="setStatus(p, 'BLOCKED')"
                        >Bloquer</button>
                        <button
                          v-if="p.status !== 'ACTIVE'"
                          class="btn sm primary"
                          type="button"
                          :disabled="working === p.studentId"
                          @click="setStatus(p, 'ACTIVE')"
                        >
                          <span v-if="working === p.studentId" class="btn-spin" aria-hidden="true" />
                          Réinscrire
                        </button>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
