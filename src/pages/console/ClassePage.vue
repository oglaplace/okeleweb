<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import DataSheet from "../../components/sheet/DataSheet.vue";
import { studentTabs, flattenStudentRow } from "../../components/sheet/columns";
import { useAuthStore } from "../../stores/auth";

/**
 * LE CONSEIL DE CLASSE — the meeting, as a screen.
 *
 * It used to be a page with five equal-looking buttons where the council was
 * one of them, disabled until a période was picked, and nothing said what state
 * anything was in. An operator who clicked "Conseil de classe" in the menu
 * arrived here, saw "Saisie des notes" and left: the council itself looked like
 * one more link rather than the thing the screen is for.
 *
 * So the screen states where the council IS, in order:
 *   1. the marks — how many are in, what is still a teacher's draft
 *   2. the deliberation — every pupil's average, rank and mention, computed on
 *      demand, writing nothing
 *   3. the freeze — bulletins issued, and how many were already frozen
 *
 * The preview is still a READ, and issuing is still a separate act with legal
 * weight. What changed is that the sequence is visible and the next step is
 * always the obvious control on the page.
 */
const route = useRoute();
const classeId = computed(() => String(route.params.id));

const classe = ref<api.OrgUnit | null>(null);
const ancestors = ref<api.OrgUnit[]>([]);
const years = ref<api.AcademicYear[]>([]);
const periods = ref<api.Period[]>([]);
const roster = ref<api.RosterRow[]>([]);

/**
 * THE MARKS, as the class sheet shows them.
 *
 * The same grid the Notes tab of the classe draws — same columns, same
 * averages, same engine behind them — because a conseil deliberating on
 * different numbers from the ones the teachers entered is the failure this
 * whole module exists to prevent. Read-only here: the council reads marks, it
 * does not type them.
 */
const sheet = ref<api.StudentSheet | null>(null);

/**
 * WHO MAY FREEZE.
 *
 * `grading.issue`, not `grading.write`: entering a mark and deciding that the
 * term's numbers are final are different authorities, and the second belongs to
 * whoever chairs the conseil. A titulaire who may type marks all term must not
 * be able to close the term on their own.
 */
const auth = useAuthStore();
const mayFreeze = computed(() => auth.can("grading.issue"));
const preview = ref<api.ClassePreview | null>(null);

const yearId = ref<string | null>(null);
const periodId = ref<string | null>(null);

const loading = ref(true);
const previewing = ref(false);
const issuing = ref(false);
const issued = ref<{ issued: number; alreadyIssued: number } | null>(null);
const error = ref<string | null>(null);

/** Bulletins already frozen for the période on screen — the council's state. */
const frozen = ref<api.MarkSheet[]>([]);

/**
 * WHERE THE MEETING STANDS, read before anything is computed.
 *
 * The engine refuses for three ordinary reasons — nobody enrolled, no
 * programme, no marks yet — and each used to surface as a red banner saying
 * so in the API's words, or as nothing at all, leaving a roster on screen with
 * a button back to mark entry. This is what the council actually asks first:
 * which subjects are in, what is still a teacher's draft, what is frozen.
 */
const council = ref<api.CouncilState | null>(null);

const BLOCKED_FR: Record<string, { title: string; detail: string }> = {
  NO_PUPILS: {
    title: "Aucun élève inscrit dans cette classe",
    detail: "Un conseil délibère sur des élèves. Inscrivez-les d'abord.",
  },
  NO_PROGRAMME: {
    title: "Aucune matière programmée pour ce niveau",
    detail:
      "Les moyennes se calculent sur le programme du niveau et ses coefficients. " +
      "Programmez les matières avant le conseil.",
  },
  NO_MARKS: {
    title: "Aucune note saisie pour cette période",
    detail:
      "Le conseil lit des notes. Tant qu'aucune épreuve n'en porte, il n'y a rien à délibérer.",
  },
};

/**
 * Whose calendar this class runs on.
 *
 * Périodes are declared on the ÉCOLE now — one calendar per établissement — and
 * the API walks up from whatever unit it is given, so either answer works. The
 * école is asked first because that is where new ones are created.
 */
const calendarId = computed(
  () =>
    ancestors.value.find((a) => a.kind === "SCHOOL")?.id ??
    ancestors.value.find((a) => a.kind === "CYCLE")?.id ??
    classe.value?.parentId ??
    null,
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
    const [rosterRows, periodList, classSheet] = await Promise.all([
      api.enrollment.roster(classeId.value, yearId.value),
      calendarId.value
        ? api.academics.periods(calendarId.value, yearId.value)
        : Promise.resolve([]),
      api.sheets.classe(classeId.value, yearId.value).catch(() => null),
    ]);
    roster.value = rosterRows;
    sheet.value = classSheet;
    periods.value = periodList;
    /*
     * The période a school is actually IN, not the first of the year — the
     * same fix as the print run. A council held in février opens on the 2e
     * trimestre; opening on the 1er showed an empty screen for a term that
     * was over and deliberated.
     */
    periodId.value = currentPeriod(periodList);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

function currentPeriod(list: api.Period[]): string | null {
  if (!list.length) return null;
  const today = Date.now();
  const holding = list.find(
    (p) => new Date(p.startsOn).getTime() <= today && today <= new Date(p.endsOn).getTime(),
  );
  if (holding) return holding.id;
  const started = list.filter((p) => new Date(p.startsOn).getTime() <= today);
  return (started[started.length - 1] ?? list[0])?.id ?? null;
}

/** What is already frozen for this période — read on every period change. */
async function loadFrozen() {
  frozen.value = periodId.value
    ? await api.grading.sheetsForClasse(classeId.value, periodId.value).catch(() => [])
    : [];
}

async function loadCouncil() {
  council.value = periodId.value
    ? await api.grading.council(classeId.value, periodId.value).catch(() => null)
    : null;
}

/** Who has a frozen bulletin, so the roster can say so pupil by pupil. */
const frozenBy = computed(() => new Set(frozen.value.map((s) => s.studentId)));

/**
 * The Notes tab of the class sheet, focused on the période being deliberated.
 *
 * `editable: false` on purpose — see mayFreeze. Marks are typed in the mark
 * entry screen, which is one click away and says so.
 */
const marksTab = computed(() =>
  sheet.value
    ? studentTabs(sheet.value, { periodId: periodId.value, editable: false })
        .find((t) => t.id === "grades") ?? null
    : null,
);
const marksRows = computed(() => (sheet.value?.rows ?? []).map(flattenStudentRow));

/**
 * THE DECISION, which is the council's own act.
 *
 * Averages and mentions are computed; "admis" or "redouble" is decided, by
 * people, in a room. The engine's proposal is shown beside the picker and
 * recorded with the decision, so the file keeps both — and the réinscription
 * screen reads exactly this when it proposes where each pupil goes next.
 */
const DECISIONS = [
  { id: "ADMIS", label: "Admis" },
  { id: "ADMIS_SOUS_CONDITION", label: "Admis sous condition" },
  { id: "REDOUBLE", label: "Redouble" },
  { id: "RATTRAPAGE", label: "Rattrapage" },
  { id: "EXCLU", label: "Exclu" },
  { id: "EN_ATTENTE", label: "En attente" },
] as const;
const decisions = ref<Record<string, string>>({});
const decidingId = ref<string | null>(null);

async function decide(studentId: string, kind: string, computed_: string) {
  if (!yearId.value || decidingId.value) return;
  decidingId.value = studentId;
  error.value = null;
  try {
    await api.grading.decide({
      studentId,
      academicYearId: yearId.value,
      kind: kind as "ADMIS",
      ...(computed_ ? { computedKind: computed_ as "ADMIS" } : {}),
    });
    decisions.value = { ...decisions.value, [studentId]: kind };
    await loadCouncil();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Décision impossible.";
  } finally {
    decidingId.value = null;
  }
}

/** What the engine proposes for a pupil, in the DecisionKind vocabulary. */
function proposed(s: { isEliminated: boolean; needsResit: boolean; isPassing: boolean }) {
  if (s.isEliminated) return "EXCLU";
  if (s.needsResit) return "RATTRAPAGE";
  return s.isPassing ? "ADMIS" : "REDOUBLE";
}

/** The council's own summary line: what is done and what is left. */
const state = computed(() => {
  const total = roster.value.length;
  const done = frozen.value.length;
  return {
    total,
    done,
    left: Math.max(0, total - done),
    complete: total > 0 && done >= total,
    started: done > 0,
  };
});

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
    issued.value = { issued: res.issued, alreadyIssued: res.alreadyIssued ?? 0 };
    await Promise.all([loadFrozen(), loadCouncil(), runPreview()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Publication impossible.";
  } finally {
    issuing.value = false;
  }
}

onMounted(load);
watch(yearId, () => void loadYearScoped());
/*
 * The council opens ready. Computing on arrival rather than behind a button:
 * the numbers are a READ, the meeting exists to look at them, and a screen that
 * shows nothing until you find the right control is a screen people leave.
 */
watch(periodId, async () => {
  preview.value = null;
  issued.value = null;
  await Promise.all([loadFrozen(), loadCouncil()]);
  // Only compute when there is something to compute. A council that opens on
  // an empty term should explain that, not show the engine's refusal.
  if (!council.value?.blocked) await runPreview();
});
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
          {{ previewing ? "Calcul…" : "Recalculer" }}
        </button>
        <RouterLink
          v-if="state.started"
          class="btn"
          :to="{ name: 'bulletins', params: { id: classeId } }"
        >
          Imprimer les bulletins
        </RouterLink>
      </div>
    </div>

    <!--
      WHERE THE COUNCIL IS, said before anything else.

      Three states, and each names its own next step. The old page showed a row
      of equal buttons and left the operator to work out which one the meeting
      needed — which is how "Conseil de classe" came to look like one more link
      beside "Saisie des notes".
    -->
    <div v-if="periodId" class="council">
      <div class="council-step" :class="{ 'is-done': !!council && council.marksIn.subjects > 0 }">
        <span class="council-n">1</span>
        <div>
          <strong>Les notes</strong>
          <span v-if="council">
            {{ council.marksIn.subjects }}/{{ council.marksIn.of }} matière(s) ·
            {{ council.marksIn.marks }} note(s)
            <template v-if="council.unsubmitted">
              · {{ council.unsubmitted }} épreuve(s) non remise(s)
            </template>
          </span>
          <span v-else>{{ roster.length }} élève(s)</span>
        </div>
      </div>
      <div class="council-step" :class="{ 'is-on': !!preview && !state.complete }">
        <span class="council-n">2</span>
        <div>
          <strong>La délibération</strong>
          <span v-if="preview">
            Moyennes, rangs et mentions — rien n'est écrit
            <template v-if="council"> · {{ council.decided }} décision(s) prise(s)</template>
          </span>
          <span v-else-if="council?.blocked">Rien à délibérer pour l'instant</span>
          <span v-else>Calcul en cours…</span>
        </div>
      </div>
      <div class="council-step" :class="{ 'is-done': state.complete, 'is-on': !!preview && !state.complete }">
        <span class="council-n">3</span>
        <div>
          <strong>Le gel</strong>
          <span v-if="state.complete">
            {{ state.done }} bulletin(s) figé(s) — la période est délibérée
          </span>
          <span v-else-if="state.started">
            {{ state.done }} figé(s), {{ state.left }} en attente
          </span>
          <span v-else>Aucun bulletin figé pour cette période</span>
        </div>
      </div>

      <!-- The one control the meeting exists to press. Enabled as soon as
           there is something to freeze, including a partial class: a pupil
           whose marks are in should not wait for one whose are not. -->
      <!-- Freezing is `grading.issue` — see mayFreeze. Absent the grant the
           council is still readable: a titulaire may sit in it, read the
           numbers and print, and may not close the term. -->
      <span v-if="!mayFreeze" class="hint council-go">
        Le gel des bulletins demande le droit « conseil de classe ».
      </span>
      <button
        v-else
        class="btn primary council-go"
        type="button"
        :disabled="issuing || !preview || state.complete"
        @click="issue"
      >
        <span v-if="issuing" class="btn-spin" aria-hidden="true" />
        {{
          issuing ? "Publication…"
          : state.started ? `Figer les ${state.left} restant(s)`
          : "Figer les bulletins"
        }}
      </button>
    </div>

    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>
    <Alert v-if="issued !== null" kind="ok" :auto-dismiss="0" @close="issued = null">
      <template v-if="issued.issued">
        {{ issued.issued }} bulletin(s) figé(s)<template v-if="issued.alreadyIssued">,
        {{ issued.alreadyIssued }} l'étaient déjà</template>.
      </template>
      <template v-else>
        Rien de nouveau à figer — {{ issued.alreadyIssued }} bulletin(s) le sont déjà.
        Une correction se fait par réédition, depuis la fiche de l'élève.
      </template>
      <RouterLink :to="{ name: 'bulletins', params: { id: classeId } }">Imprimer →</RouterLink>
    </Alert>
    <!--
      THE NOTES, as the class sheet shows them.

      A conseil reads the term's marks; this is that reading, in the grid the
      teachers filled. Read-only: entering marks is one screen away and is a
      different job from deciding what they mean.
    -->
    <div v-if="marksTab && marksRows.length" class="card is-grid council-marks">
      <div class="card-head">
        <span>Notes — {{ periods.find((p) => p.id === periodId)?.label ?? "période" }}</span>
        <RouterLink class="btn sm ghost" :to="{ name: 'marks', params: { id: classeId } }">
          Saisir les notes
        </RouterLink>
      </div>
      <DataSheet :tab="marksTab" :rows="marksRows" row-key="studentId" />
    </div>

    <div v-if="loading" class="card"><div class="empty">Chargement…</div></div>

    <!--
      WHAT IS MISSING, where the results would have been.

      Not an error banner: "No course offerings for this niveau" is the API
      telling a developer why it refused. A conseil that cannot sit yet needs
      the reason in its own words and the way out.
    -->
    <div v-else-if="council?.blocked" class="card">
      <div class="empty">
        <div class="empty-title">{{ BLOCKED_FR[council.blocked]?.title }}</div>
        <div>{{ BLOCKED_FR[council.blocked]?.detail }}</div>
        <div class="empty-actions">
          <RouterLink
            v-if="council.blocked === 'NO_MARKS'"
            class="btn primary"
            :to="{ name: 'marks', params: { id: classeId } }"
          >Saisir les notes</RouterLink>
          <RouterLink
            v-else-if="council.blocked === 'NO_PROGRAMME'"
            class="btn primary"
            :to="{ name: 'action', params: { id: 'create-offering' }, query: { scope: classe?.parentId } }"
          >Programmer les matières</RouterLink>
          <RouterLink
            v-else
            class="btn primary"
            :to="{ name: 'enroll' }"
          >Inscrire des élèves</RouterLink>
        </div>
      </div>

      <!-- What IS in, subject by subject: a council that cannot sit still
           needs to see which teacher it is waiting on. -->
      <div v-if="council.subjects.length" class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Matière</th>
              <th class="c-num">Épreuves</th>
              <th class="c-num">Notes</th>
              <th class="c-text">État</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in council.subjects" :key="s.courseOfferingId">
              <td class="c-name">{{ s.name }}</td>
              <td class="c-num">{{ s.marked }} / {{ s.assessments }}</td>
              <td class="c-num">{{ s.marks || "—" }}</td>
              <td class="c-text">
                <span v-if="!s.marks" class="cell-sub">rien de saisi</span>
                <span v-else-if="s.unsubmitted" class="pill warn">{{ s.unsubmitted }} non remise(s)</span>
                <span v-else class="pill ok">remis</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

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
              <th class="c-text">Proposition</th>
              <th class="c-text">Décision du conseil</th>
              <th class="c-text">Bulletin</th>
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
              <!-- What the ENGINE proposes. The council's own answer is the
                   next column, and the two are kept apart on purpose. -->
              <td class="c-text">
                <span v-if="s.isEliminated" class="pill danger">Éliminé</span>
                <span v-else-if="s.needsResit" class="pill warn">Rattrapage</span>
                <span v-else-if="s.isPassing" class="pill ok">Admis</span>
                <span v-else class="pill danger">Non admis</span>
              </td>
              <td class="c-text">
                <select
                  v-if="mayFreeze"
                  :value="decisions[s.studentId] ?? ''"
                  :disabled="decidingId === s.studentId"
                  :aria-label="`Décision pour ${byStudent.get(s.studentId)?.student.matricule ?? s.studentId}`"
                  @change="decide(s.studentId, ($event.target as HTMLSelectElement).value, proposed(s))"
                >
                  <option value="">Décider…</option>
                  <option v-for="d in DECISIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
                </select>
                <span v-else class="cell-sub">
                  {{ DECISIONS.find((d) => d.id === decisions[s.studentId])?.label ?? "—" }}
                </span>
              </td>
              <!-- Per pupil, because freezing is per pupil: a class where three
                   are frozen and the rest are not is a normal state now. -->
              <td class="c-text">
                <span v-if="frozenBy.has(s.studentId)" class="pill ok">Figé</span>
                <span v-else class="cell-sub">à figer</span>
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
