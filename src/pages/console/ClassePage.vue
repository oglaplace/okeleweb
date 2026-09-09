<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import NoCurrentPeriod from "../../components/console/NoCurrentPeriod.vue";
import DataSheet from "../../components/sheet/DataSheet.vue";
import { studentTabs, flattenStudentRow } from "../../components/sheet/columns";
import { useMarkEntry } from "../../lib/markEntry";
import type { SheetGroup, SheetTab } from "../../components/sheet/columns";
import SheetTabs from "../../components/sheet/SheetTabs.vue";
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
/** The school declared no période en cours — the banner says so. */
const noCurrent = ref(false);
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
/**
 * May type a mark into a reopened column.
 *
 * Both grants, deliberately: `grading.write` is who may touch a mark at all,
 * and `grading.issue` is who sits on the conseil. A titulaire reading the
 * deliberation over somebody's shoulder has neither business nor button.
 */
const mayCorrect = computed(() => mayFreeze.value && auth.can("grading.write"));
const preview = ref<api.ClassePreview | null>(null);

const yearId = ref<string | null>(null);
const periodId = ref<string | null>(null);

const loading = ref(true);
const previewing = ref(false);
const issuing = ref(false);
const issued = ref<{ issued: number; alreadyIssued: number } | null>(null);
const error = ref<string | null>(null);
/** What just happened, said once and dismissible. */
const notice = ref<string | null>(null);

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
/** Reopened bulletins, waiting to be frozen again — not documents yet. */
const drafts = ref<api.MarkSheet[]>([]);

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
    /*
     * THE PÉRIODE THE SCHOOL DECLARED.
     *
     * A conseil held in février deliberates the trimestre the school says it
     * is in — not the one today's date lands in, which was the old guess and
     * which disagreed with the print run whenever a term ran late.
     */
    const declared = api.currentPeriodOf(periodList);
    noCurrent.value = declared === null && periodList.length > 0;
    periodId.value = (declared ?? api.guessPeriodOf(periodList))?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}


/**
 * What is already FROZEN for this période.
 *
 * THE BUG THIS FIXES: the endpoint returns DRAFT sheets as well as ISSUED ones,
 * and counting both made the screen announce "4 bulletin(s) figé(s)" over a
 * class whose bulletins were all drafts — then offer to reopen them and get
 * "aucun bulletin figé" back from an API that counts the way the word does.
 * A draft is a working copy; only ISSUED is a document.
 */
async function loadFrozen() {
  const rows = periodId.value
    ? await api.grading.sheetsForClasse(classeId.value, periodId.value).catch(() => [])
    : [];
  frozen.value = rows.filter((s) => s.status === "ISSUED");
  drafts.value = rows.filter((s) => s.status === "DRAFT");
}

async function loadCouncil() {
  council.value = periodId.value
    ? await api.grading.council(classeId.value, periodId.value).catch(() => null)
    : null;
  // The decisions already on file — the column shows them rather than offering
  // the engine's proposal again for a pupil the council settled last week.
  decisions.value = { ...(council.value?.decisions ?? {}) };
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
    ? studentTabs(sheet.value, {
        periodId: periodId.value,
        editable: false,
        lockable: mayFreeze.value,
        // Reopening a subject is what makes its column typeable — see
        // marksEditable. The council corrects in the grid it is reading.
        marksEditable: mayCorrect.value,
        // One verdict on what is remise: the council's — see submittedSubjects.
        submittedSubjects: new Set(
          (council.value?.subjects ?? []).filter((x) => x.submitted).map((x) => x.subjectId),
        ),
        councilColumns: councilColumns.value,
      }).find((t) => t.id === "grades") ?? null
    : null,
);

/**
 * THE CONSEIL'S THREE COLUMNS, on the same row as the marks.
 *
 * Décision first, because it is the act. Its cell shows what the engine
 * PROPOSES until somebody decides — "Admis ?" with a question mark, not a
 * value — so a class nobody has been through reads as forty open questions
 * rather than forty settled ones.
 */
const councilColumns = computed<SheetGroup[] | undefined>(() =>
  mayFreeze.value
    ? [{
        label: "Conseil",
        title: "Ce que le conseil décide, dit et fige",
        columns: [
          { key: "c:decision", label: "Décision", width: 20,
            action: { when: "always" },
            hint: "Cliquer pour décider. La proposition du moteur est celle qui est présélectionnée." },
          { key: "c:observation", label: "Observation", width: 26,
            action: { when: "always" },
            hint: "Ce que le conseil veut voir imprimé sur le bulletin de l'élève." },
          { key: "c:bulletin", label: "Bulletin", type: "pill", width: 10,
            hint: "Figé = le document est émis et imprimable." },
        ],
      }]
    : undefined,
);

/** The engine's row for a pupil, so a cell can show what the marks say. */
const previewOf = computed(() => {
  const map = new Map<string, api.ClassePreview["students"][number]>();
  for (const s of preview.value?.students ?? []) map.set(s.studentId, s);
  return map;
});

const marks = useMarkEntry({
  sheet,
  periodId,
  // The council's own reload: the sheet, and everything that reads from it.
  reload: async () => { await refresh(); },
});

const marksRows = computed(() =>
  marks.apply((sheet.value?.rows ?? []).map((row) => {
    const flat = flattenStudentRow(row);
    const id = String(flat.studentId ?? "");
    const p = previewOf.value.get(id);
    const decided = decisions.value[id];
    return {
      ...flat,
      "c:decision": decided
        ? DECISIONS.find((d) => d.id === decided)?.label ?? decided
        : p
          ? `${DECISIONS.find((d) => d.id === proposed(p))?.label} ?`
          : "—",
      "c:observation": observationOf.value.get(id) ?? "—",
      "c:bulletin": frozenBy.value.has(id) ? "Figé" : "à figer",
    };
  })),
);

/** Which subject a padlock belongs to — the sheet names subjects, not offerings. */
const offeringOfSubject = computed(() => {
  const map = new Map<string, { id: string; name: string; submitted: boolean }>();
  for (const s of council.value?.subjects ?? []) {
    map.set(s.subjectId, { id: s.courseOfferingId, name: s.name, submitted: s.submitted });
  }
  return map;
});

/** A padlock was clicked in a subject header: hand it over, or reopen it. */
function onGroupAct(key: string) {
  const subjectId = key.startsWith("lock:") ? key.slice(5) : null;
  const target = subjectId ? offeringOfSubject.value.get(subjectId) : null;
  if (!target) return;
  if (target.submitted) unlocking.value = { id: target.id, name: target.name, reason: "" };
  else submitSubject(target.id, target.name);
}

/** A conseil cell was clicked: décision or observation, both per pupil. */
function onCellAct({ row, column }: { row: Record<string, unknown>; column: { key: string } }) {
  const id = String(row.studentId ?? "");
  const name = `${String(row.lastName ?? "").toUpperCase()} ${row.firstName ?? ""}`.trim();
  if (column.key === "c:observation") {
    observing.value = { studentId: id, name, text: observationOf.value.get(id) ?? "" };
  } else if (column.key === "c:decision") {
    deciding.value = {
      studentId: id,
      name,
      // The default IS what the marks say — the council overrides it or agrees
      // with it, and agreeing should be one click.
      kind: decisions.value[id] ?? (previewOf.value.get(id) ? proposed(previewOf.value.get(id)!) : "ADMIS"),
    };
  }
}

/** The picker the décision cell opens. */
const deciding = ref<{ studentId: string; name: string; kind: string } | null>(null);
const decidingRow = computed(() =>
  deciding.value ? previewOf.value.get(deciding.value.studentId) ?? null : null,
);
const decidingProposal = computed(() =>
  decidingRow.value
    ? DECISIONS.find((d) => d.id === proposed(decidingRow.value!))?.label ?? "—"
    : "—",
);
async function saveDecision() {
  const target = deciding.value;
  if (!target) return;
  const p = previewOf.value.get(target.studentId);
  await decide(target.studentId, target.kind, p ? proposed(p) : "");
  deciding.value = null;
}

/*
 * ── THE MEETING'S FOUR ACTS ────────────────────────────────────────────────
 *
 * A conseil hands the marks over, corrects what it finds, says what it wants
 * printed, and freezes. Each of those writes a line in the minute book — which
 * is the point: months later, when a family disputes a bulletin, the question
 * is who changed what and when, and the app used to keep none of it.
 */
const manifest = ref<api.CouncilManifest | null>(null);
const acting = ref<string | null>(null);

async function loadManifest() {
  manifest.value = periodId.value
    ? await api.grading.councilManifest(classeId.value, periodId.value).catch(() => null)
    : null;
}

/** Hands one subject over, on the teacher's behalf if need be. */
async function submitSubject(courseOfferingId: string, name: string) {
  if (!periodId.value || acting.value) return;
  acting.value = courseOfferingId;
  error.value = null;
  try {
    const res = await api.grading.submitSubject(classeId.value, periodId.value, courseOfferingId);
    // Zero is not a success. It means the subject has no marked evaluation to
    // hand over, and the padlock will stay open however often it is clicked —
    // saying "remis — 0 épreuve(s)" was how that looked like a broken button.
    if (res.submitted === 0) {
      error.value =
        `Rien à remettre en ${name} : aucune épreuve notée sur cette période. ` +
        `Saisissez les notes, puis remettez la matière.`;
    } else {
      notice.value = `${name} remis — ${res.submitted} épreuve(s).`;
    }
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Remise impossible.";
  } finally {
    acting.value = null;
  }
}

/** Reopens one, with the reason that goes in the minutes. */
const unlocking = ref<{ id: string; name: string; reason: string } | null>(null);
async function unlockSubject() {
  const target = unlocking.value;
  if (!target || !periodId.value || !target.reason.trim() || acting.value) return;
  acting.value = target.id;
  error.value = null;
  try {
    const res = await api.grading.unlockSubject(
      classeId.value, periodId.value, target.id, target.reason.trim(),
    );
    if (res.unlocked === 0) {
      error.value = `${target.name} n'avait aucune épreuve remise à rouvrir.`;
    } else {
      notice.value =
        `${target.name} rouvert (${res.unlocked} épreuve(s)) — ` +
        `la correction est tracée au procès-verbal.`;
    }
    unlocking.value = null;
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réouverture impossible.";
  } finally {
    acting.value = null;
  }
}

/** What the council wants printed on one pupil's bulletin. */
const observing = ref<{ studentId: string; name: string; text: string } | null>(null);
async function saveObservation() {
  const target = observing.value;
  if (!target || !periodId.value || !target.text.trim() || acting.value) return;
  acting.value = target.studentId;
  error.value = null;
  try {
    await api.grading.observe(classeId.value, periodId.value, target.studentId, target.text.trim());
    notice.value = `Observation enregistrée pour ${target.name}.`;
    observing.value = null;
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    acting.value = null;
  }
}

/** A mistake still slipped through: reopen, correct, freeze again. */
const unfreezing = ref<{ reason: string } | null>(null);
async function unfreeze() {
  const target = unfreezing.value;
  if (!target || !periodId.value || !target.reason.trim() || acting.value) return;
  acting.value = "unfreeze";
  error.value = null;
  try {
    const res = await api.grading.unfreeze(classeId.value, periodId.value, target.reason.trim());
    notice.value = `${res.reopened} bulletin(s) rouvert(s) — le motif est au procès-verbal.`;
    unfreezing.value = null;
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réouverture impossible.";
  } finally {
    acting.value = null;
  }
}

/** One reload for all of it: the state, the minutes, the sheets, the numbers. */
/**
 * One reload for every consequence of one act.
 *
 * THE BUG THIS FIXES: locking a subject changed the strip but not the padlock,
 * and freezing changed the banner but not the Bulletin column — the screen
 * disagreed with itself until somebody reloaded the page. Every act that
 * writes goes through here, and everything the act can be seen in is re-read:
 * the council state, the frozen sheets, the minutes, the engine's numbers, and
 * the mark book itself, which is where the padlocks and the marks live.
 */
async function refresh() {
  await Promise.all([loadCouncil(), loadFrozen(), loadManifest(), loadSheet()]);
  if (!council.value?.blocked) await runPreview();
}

/** The mark book, re-read on its own — the padlocks are its data. */
async function loadSheet() {
  if (!yearId.value) return;
  sheet.value = await api.sheets.classe(classeId.value, yearId.value).catch(() => sheet.value);
}

/** The observation already minuted for a pupil, so the row can show it. */
const observationOf = computed(() => {
  const map = new Map<string, string>();
  for (const e of manifest.value?.entries ?? []) {
    if (e.kind === "OBSERVATION" && e.studentId && e.note) map.set(e.studentId, e.note);
  }
  return map;
});

/** Minute-book stamp: the day and the hour, which is what a PV records. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/*
 * ── DEUX PAGES, COMME UN CLASSEUR ──────────────────────────────────────────
 *
 * "Notes" and "Procès-verbal", switched at the foot of the grid the way a
 * spreadsheet switches sheets. The minutes are not a panel that appears
 * somewhere above the marks: they are the meeting's second page, and an
 * operator looking for "what did we change?" goes to the tab that says so.
 */
const page = ref("notes");

const PV_TAB: SheetTab = {
  id: "pv",
  label: "Procès-verbal",
  frozen: 1,
  identity: [],
  columns: [
    { key: "at", label: "Heure", width: 12 },
    { key: "kind", label: "Acte", width: 18 },
    { key: "about", label: "Objet", width: 24 },
    { key: "note", label: "Détail", width: 52 },
    { key: "by", label: "Par", width: 20 },
  ],
};

const pvRows = computed(() =>
  (manifest.value?.entries ?? []).map((e) => ({
    id: e.id,
    at: stamp(e.at),
    kind: MANIFEST_FR[e.kind] ?? e.kind,
    about: e.subject ?? e.student ?? "—",
    note: e.note ?? "—",
    by: e.by ?? "—",
  })),
);

/*
 * THE BUG THIS FIXES: clicking "Notes" showed the procès-verbal.
 *
 * The marks tab comes out of studentTabs with id "grades", the page state was
 * compared against "notes", and the tab strip writes the tab's OWN id back —
 * so selecting Notes set page to "grades", which matched neither branch and
 * fell through to the minutes. The page is renamed here, so the id the strip
 * emits is the id the template tests, and there is one name for it.
 */
const sheetPages = computed<SheetTab[]>(() => [
  ...(marksTab.value ? [{ ...marksTab.value, id: "notes", label: "Notes" }] : []),
  PV_TAB,
]);

/**
 * Why the minutes are empty, and what to do about it.
 *
 * A procès-verbal exists once the conseil has done something — the register is
 * opened by the first act, not by the calendar. So an empty page says which act
 * would open it rather than showing a blank grid and letting the operator
 * conclude the feature is broken.
 */
const pvBlocked = computed(() => {
  if (!periodId.value) return { title: "Aucune période choisie",
    detail: "Choisissez la période que le conseil délibère, en haut de l'écran." };
  if (!manifest.value) return { title: "Le conseil n'a pas encore siégé",
    detail: "Le procès-verbal s'ouvre au premier acte : remettez une matière depuis " +
      "le cadenas de son en-tête, ou écrivez une observation dans la colonne Conseil.",
  };
  if (!manifest.value.entries.length) return { title: "Registre vide",
    detail: "La séance est ouverte mais rien n'y a encore été inscrit." };
  return null;
});

/** Where the séance itself stands — not an act, a state. */
const SESSION_FR: Record<string, string> = {
  OPEN: "Séance ouverte",
  DELIBERATED: "Délibérée",
  CLOSED: "Séance close",
};

const MANIFEST_FR: Record<string, string> = {
  OPENED: "Conseil ouvert",
  SUBMITTED: "Matière remise",
  UNLOCKED: "Matière rouverte",
  MARK_CHANGED: "Note modifiée",
  DECISION: "Décision",
  OBSERVATION: "Observation",
  FROZEN: "Bulletins figés",
  UNFROZEN: "Bulletins rouverts",
  CLOSED: "Conseil clos",
};

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
  // The verdict was missing: a conseil could say "redouble", which is a ruling
  // about next September, but had no way to say the period was simply failed.
  { id: "NON_ADMIS", label: "Non admis" },
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
    await refresh();
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
  // NON_ADMIS, not REDOUBLE: the engine reads marks, and marks say whether the
  // period was passed. Whether the pupil sits the year again is the council's
  // to rule, in September's vocabulary, not an arithmetic consequence.
  return s.isPassing ? "ADMIS" : "NON_ADMIS";
}

/**
 * Subjects nobody has marked at all.
 *
 * They cannot be handed over — there is nothing to hand — and the conseil
 * counts them as zero for every pupil. Said out loud, because a subject worth
 * coefficient 4 silently scoring zero for the whole class is the kind of thing
 * a director wants to hear before the bulletins are frozen, not after.
 */
const unmarkedSubjects = computed(
  () => (council.value?.subjects ?? []).filter((x) => x.marks === 0).length,
);

/** Pupils the council has not ruled on yet — what step 2 is waiting for. */
const undecided = computed(() =>
  Math.max(0, roster.value.length - (council.value?.decided ?? 0)),
);
const deliberated = computed(() => roster.value.length > 0 && undecided.value === 0);

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
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Publication impossible.";
  } finally {
    issuing.value = false;
  }
}

onMounted(load);
// Marks in flight would be lost by leaving, by changing période, or by
// switching to the minutes — flush before any of the three.
onBeforeUnmount(() => void marks.flush());
watch(page, () => void marks.flush());
watch(yearId, () => void loadYearScoped());
/*
 * The council opens ready. Computing on arrival rather than behind a button:
 * the numbers are a READ, the meeting exists to look at them, and a screen that
 * shows nothing until you find the right control is a screen people leave.
 */
watch(periodId, async () => {
  await marks.flush();
  preview.value = null;
  issued.value = null;
  await refresh();
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
        <!--
          "Saisie des notes" and "Recalculer" are gone.
          The first is on the marks grid below, where somebody who wants to type
          is already looking. The second was a button asking the operator to
          re-run something the screen recomputes on arrival and after every act
          — a control whose only honest label would have been "try again".
        -->
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
      <div class="council-step" :class="{ 'is-done': !!council?.allSubmitted }">
        <span class="council-n">1</span>
        <div>
          <strong>Les notes remises</strong>
          <!-- Counted against the subjects that HAVE marks, which is what the
               freeze actually requires. Counting against every programmed
               subject read as "3/4 done" on a class that was ready, because
               the fourth had nothing to hand over and never would. -->
          <span v-if="council">
            {{ council.subjects.filter((x) => x.submitted).length }}/{{ council.marksIn.subjects }}
            matière(s) remise(s)
            <template v-if="council.unsubmitted">
              · {{ council.unsubmitted }} épreuve(s) encore ouverte(s)
            </template>
            <template v-else-if="unmarkedSubjects">
              · {{ unmarkedSubjects }} matière(s) sans note (comptée(s) 0)
            </template>
          </span>
          <span v-else>{{ roster.length }} élève(s)</span>
        </div>
      </div>
      <!-- THE BUG THIS FIXES: step 2 had no completed state at all, so the
           meeting's middle act stayed lit however many pupils were decided. It
           is done when every pupil on the roster has a decision on file. -->
      <div
        class="council-step"
        :class="{ 'is-done': deliberated, 'is-on': !!preview && !deliberated }"
      >
        <span class="council-n">2</span>
        <div>
          <strong>La délibération</strong>
          <span v-if="council && preview">
            {{ council.decided }}/{{ roster.length }} décision(s) prise(s)
            <template v-if="undecided"> · {{ undecided }} élève(s) sans décision</template>
          </span>
          <span v-else-if="preview">Moyennes, rangs et mentions — rien n'est écrit</span>
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
          <span v-else-if="drafts.length">
            {{ drafts.length }} bulletin(s) rouvert(s) — à figer de nouveau
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
      <template v-else>
        <!-- A mistake found after the freeze. Not "delete and redo": the sheets
             go back to draft, the marks move again, and the reason goes in the
             minutes — a documented correction rather than a silent rewrite. -->
        <button
          v-if="state.started"
          class="btn ghost council-go"
          type="button"
          :disabled="!!acting"
          @click="unfreezing = { reason: '' }"
        >Rouvrir les bulletins</button>
        <!-- Nothing left to freeze: the button that would say "figer les 0
             restant(s)" is not disabled, it is absent. -->
        <button
          v-if="!state.complete"
          class="btn primary"
          :class="{ 'council-go': !state.started }"
          type="button"
          :disabled="issuing || !preview || !council?.allSubmitted"
          :title="
            council && !council.allSubmitted
              ? 'Toutes les matières doivent être remises avant le gel'
              : undefined
          "
          @click="issue"
        >
          <span v-if="issuing" class="btn-spin" aria-hidden="true" />
          {{
            issuing ? "Publication…"
            : state.started ? `Figer les ${state.left} restant(s)`
            : "Figer les bulletins"
          }}
        </button>
      </template>
    </div>

    <NoCurrentPeriod
      v-if="noCurrent"
      what="le conseil de classe"
      :guessed="periods.find((p) => p.id === periodId)?.label ?? null"
    />
    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>
    <Alert v-if="marks.error.value" kind="error" @close="marks.error.value = null">
      {{ marks.error.value }}
    </Alert>
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



    <div v-if="loading" class="card"><div class="empty">Chargement…</div></div>

    <!--
      LE CLASSEUR DU CONSEIL — deux pages, une grille.

      Page « Notes » : le carnet de notes de la période, avec un cadenas par
      matière dans son en-tête (remettre / rouvrir) et, tout à droite, les trois
      colonnes que produit la séance — décision, observation, état du bulletin.
      Page « Procès-verbal » : le registre de ce qui s'est passé.

      Tout est là parce que tout se lit ensemble : décider du sort d'un élève en
      regardant sa moyenne dans un tableau et en cliquant dans un autre, ligne
      par ligne, était la vraie difficulté de cet écran.
    -->
    <div v-else-if="marksTab && marksRows.length" class="card is-grid council-marks">
      <div class="card-head">
        <span>
          {{ page === "pv" ? "Procès-verbal" : "Notes" }} —
          {{ periods.find((p) => p.id === periodId)?.label ?? "période" }}
        </span>
        <span class="unit-meta">
          <template v-if="page === 'notes' && council">
            {{ council.subjects.filter((x) => x.submitted).length }}/{{ council.marksIn.subjects }}
            matière(s) remise(s)
          </template>
          <template v-else-if="manifest">
            {{ SESSION_FR[manifest.session.status] ?? manifest.session.status }} ·
            {{ manifest.entries.length }} acte(s)
          </template>
        </span>
      </div>

      <DataSheet
        v-if="page === 'notes'"
        :tab="marksTab"
        :rows="marksRows"
        row-key="studentId"
        :title="`${classe?.name ?? ''} — conseil`"
        @group-act="onGroupAct"
        @act="onCellAct"
        @edit="marks.onEdit"
      />
      <DataSheet
        v-else-if="!pvBlocked"
        :tab="PV_TAB"
        :rows="pvRows"
        row-key="id"
        :title="`${classe?.name ?? ''} — procès-verbal`"
      />
      <!-- The minutes are not ready: say why, and name the act that opens them. -->
      <div v-else class="empty">
        <div class="empty-title">{{ pvBlocked.title }}</div>
        <div>{{ pvBlocked.detail }}</div>
        <div class="empty-actions">
          <button class="btn" type="button" @click="page = 'notes'">Aller aux notes</button>
        </div>
      </div>

      <SheetTabs v-model="page" :tabs="sheetPages">
        <template #end>
          <span v-if="acting" class="marksave">
            <span class="btn-spin" aria-hidden="true" />Enregistrement…
          </span>
          <!--
            Where the typing got to. Nobody presses save: the writes go out
            shortly after the keystrokes stop, and this is the receipt.

            "Saisir les notes" used to sit here and is gone: the marks of a
            reopened subject are typed in this grid now, and a button leading
            to another screen showing the same grid was one more place to look
            for something already under the cursor.
          -->
          <span v-else-if="marks.state.value !== 'idle'" class="marksave">
            <span v-if="marks.state.value === 'saving'" class="btn-spin" aria-hidden="true" />
            {{
              marks.state.value === "saving" ? "Enregistrement…"
              : marks.state.value === "dirty" ? "Modifications non enregistrées"
              : `Enregistré à ${marks.savedAt.value}`
            }}
          </span>
        </template>
      </SheetTabs>
    </div>

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
            :to="{ name: 'subjects' }"
          >Programmer les matières</RouterLink>
          <RouterLink
            v-else
            class="btn primary"
            :to="{ name: 'enroll' }"
          >Inscrire des élèves</RouterLink>
        </div>
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

    <!-- Reopening a subject: the reason is the point, so it is required. -->
    <ConfirmDialog
      v-if="unlocking"
      :title="`Rouvrir ${unlocking.name}`"
      :subtitle="classe?.name"
      confirm-label="Rouvrir"
      :busy="!!acting"
      :confirm-disabled="!unlocking.reason.trim()"
      @close="unlocking = null"
      @confirm="unlockSubject"
    >
      <p>
        Les notes de cette matière redeviennent modifiables. Le motif ci-dessous
        est inscrit au procès-verbal du conseil, avec votre nom et l'heure.
      </p>
      <textarea
        v-model="unlocking.reason"
        rows="3"
        placeholder="Motif — erreur de saisie sur la composition, note manquante…"
      />
    </ConfirmDialog>

    <!--
      La décision, présélectionnée sur ce que disent les notes.

      The council usually agrees with the engine; making that the default turns
      the common case into one click, and leaves the disagreement — which is the
      interesting one — exactly as visible.
    -->
    <ConfirmDialog
      v-if="deciding"
      :title="`Décision — ${deciding.name}`"
      :subtitle="classe?.name"
      confirm-label="Enregistrer"
      :busy="!!decidingId"
      @close="deciding = null"
      @confirm="saveDecision"
    >
      <p v-if="decidingRow">
        Moyenne {{ decidingRow.average ?? "—" }} · proposition du moteur :
        <strong>{{ decidingProposal }}</strong>
      </p>
      <div class="decide-list">
        <label v-for="d in DECISIONS" :key="d.id" class="decide-opt">
          <input v-model="deciding.kind" type="radio" :value="d.id" name="decision" />
          <span>{{ d.label }}</span>
        </label>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="observing"
      :title="`Observation — ${observing.name}`"
      :subtitle="classe?.name"
      confirm-label="Enregistrer"
      :busy="!!acting"
      :confirm-disabled="!observing.text.trim()"
      @close="observing = null"
      @confirm="saveObservation"
    >
      <p>Ce texte sera imprimé sur le bulletin de l'élève.</p>
      <textarea
        v-model="observing.text"
        rows="3"
        placeholder="Encouragements du conseil, avertissement de travail…"
      />
    </ConfirmDialog>

    <ConfirmDialog
      v-if="unfreezing"
      title="Rouvrir les bulletins figés"
      :subtitle="classe?.name"
      confirm-label="Rouvrir"
      danger
      :busy="!!acting"
      :confirm-disabled="!unfreezing.reason.trim()"
      @close="unfreezing = null"
      @confirm="unfreeze"
    >
      <p>
        Les bulletins repassent en brouillon et les notes redeviennent
        modifiables. Ceux déjà imprimés ou remis restent entre les mains des
        familles : le conseil devra les remplacer. Le motif est inscrit au
        procès-verbal.
      </p>
      <textarea
        v-model="unfreezing.reason"
        rows="3"
        placeholder="Motif — note d'EPS inversée entre deux élèves…"
      />
    </ConfirmDialog>
  </div>
</template>
