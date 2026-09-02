<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import { byId, type ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../../components/structure/kinds";
import { useBusyStore } from "../../stores/busy";
import { useOrgStore } from "../../stores/org";
import ActionDialog from "../../components/actions/ActionDialog.vue";
import NodeActionBar from "../../components/console/NodeActionBar.vue";
import NodeMenuDialogs from "../../components/console/NodeMenuDialogs.vue";
import EnrollForm from "../../components/enrollment/EnrollForm.vue";
import DialogShell from "../../components/ui/DialogShell.vue";
import DataSheet from "../../components/sheet/DataSheet.vue";
import SheetTabs from "../../components/sheet/SheetTabs.vue";
import {
  childrenTab, flattenStudentRow, niveauTabs, periodTab, staffTabs, studentTabs,
  subjectTabs, type SheetColumn, type SheetTab,
} from "../../components/sheet/columns";
import TimetableGrid from "../../components/sheet/TimetableGrid.vue";
import Alert from "../../components/ui/Alert.vue";

/**
 * One unit: what it is, what it holds, and everything that can be done to it.
 *
 * SIMPLIFIED, on a leaf especially. There was a breadcrumb here duplicating the
 * one in the topbar, and a card of forty action tiles that pushed the actual
 * contents of the class — the pupils — below the fold. Now the trail is global
 * (see lib/trail.ts) and the actions are a menu bar above the content, which is
 * the honest weighting: you come here to look at a class and occasionally to
 * act on it.
 *
 * Every action that is a form opens HERE, over this page, with this node as its
 * scope. Nothing about "add a subject to 6e" should involve leaving 6e.
 *
 * AND THE CONTENT IS A SHEET. A class is forty pupils and, depending on who is
 * looking, forty columns: identity for the secretary, balances for the économe,
 * marks for the conseil, absences for the surveillant. Those were four screens
 * and a manual join; here they are one grid with tabs at the foot, over one set
 * of rows. See components/sheet — and the API's /sheets/classe, which assembles
 * all of it in one read.
 */
const route = useRoute();
const router = useRouter();
const org = useOrgStore();
const busy = useBusyStore();
const id = computed(() => route.params.id as string);

const unit = ref<api.OrgUnit | null>(null);
const children = ref<api.OrgUnit[]>([]);
const sheet = ref<api.StudentSheet | null>(null);
const staff = ref<api.StaffSheetRow[]>([]);
/** The programme of a NIVEAU — what is taught here, and at what weight. */
const programme = ref<api.NiveauSheet | null>(null);
/** One subject of that programme, opened from it. */
const subject = ref<api.SubjectSheet | null>(null);
/** The calendar of a CYCLE or SCHOOL. */
const periods = ref<api.PeriodSheet | null>(null);
/** The weekly grid of a CLASSE, and what a builder needs to extend it. */
const grid = ref<api.TimetableSlot[]>([]);
/** Whether this week is on the wall or still only ours — see the API. */
const gridPublished = ref(false);
const gridPublishedAt = ref<string | null>(null);
/** Which release the public reads, and whether the draft has moved past it. */
const gridVersion = ref<number | null>(null);
const gridPending = ref(false);
/** True when the API handed us a week nobody else can see — i.e. we may edit it. */
const gridIsDraft = ref(false);
const offerings = ref<{ id: string; subject: { id: string; code: string; name: string } }[]>([]);
const siblings = ref<{ id: string; name: string }[]>([]);
const teachers = ref<{ id: string; label: string }[]>([]);
const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  sheet.value = null;
  staff.value = [];
  try {
    const [u, kids] = await Promise.all([
      api.orgUnits.get(id.value),
      api.orgUnits.children(id.value),
      org.load(),
    ]);
    unit.value = u;
    children.value = kids;

    years.value = await api.academics.years().catch(() => []);
    yearId.value =
      yearId.value ?? (years.value.find((y) => y.isCurrent) ?? years.value[0])?.id ?? null;

    if (u.kind === "CLASSE") {
      await loadSheet();
    } else {
      // Everything else holds units — and, often, people posted to it.
      staff.value = await api.sheets.staff(u.id).then((r) => r.rows).catch(() => []);
      await loadSheet();
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}
watch(id, load, { immediate: true });

/**
 * Whatever this KIND of node is a sheet of — and only that.
 *
 * A classe is pupils and a week; a niveau is a programme; a cycle is a
 * calendar. Loading all three for every node would be three requests to draw
 * one, and two of them would always be empty by construction.
 */
async function loadSheet() {
  const u = unit.value;
  if (!u || !yearId.value) return;
  programme.value = null;
  periods.value = null;

  if (u.kind === "CLASSE") {
    const [s, g] = await Promise.all([
      api.sheets.classe(u.id, yearId.value).catch(() => null),
      api.timetable.forClasse(u.id, yearId.value).catch(() => null),
    ]);
    sheet.value = s;
    // Assigned when it lands, never blanked first: emptying it here made the
    // whole week vanish and redraw on any reload of the page — a change of one
    // mark repainting the timetable tab.
    grid.value = g?.slots ?? [];
    gridPublished.value = g?.published ?? false;
    gridPublishedAt.value = g?.publishedAt ?? null;
    gridIsDraft.value = g?.isDraft ?? false;
    gridVersion.value = g?.version ?? null;
    gridPending.value = g?.hasUnpublishedChanges ?? false;
    await loadBuilderOptions();
    return;
  }

  grid.value = [];

  if (u.kind === "NIVEAU") {
    programme.value = await api.sheets.niveau(u.id, yearId.value).catch(() => null);
    // A subject drilled into stays open across a reload — it is in the URL.
    subject.value = subjectId.value
      ? await api.sheets.subject(u.id, subjectId.value, yearId.value).catch(() => null)
      : null;
    return;
  }

  // Périodes hang off a school or a cycle — never off a classe.
  if (u.kind === "CYCLE" || u.kind === "SCHOOL" || u.kind === "FACULTY") {
    periods.value = await api.sheets.periods(u.id, yearId.value).catch(() => null);
  }
}

/**
 * What the builder offers: the niveau's subjects, its other classes, the staff.
 *
 * Offerings come from the NIVEAU because that is where a course is programmed —
 * asking the classe would be asking the wrong row, and is exactly the mistake
 * the timetable dialog explains when there are none.
 */
async function loadBuilderOptions() {
  const u = unit.value;
  if (!u || !yearId.value) return;
  const niveauId = u.parentId;
  if (!niveauId) return;

  const [offs, kids, people] = await Promise.all([
    api.academics.offerings(niveauId, yearId.value).catch(() => []),
    api.orgUnits.children(niveauId).catch(() => []),
    api.people.staff().catch(() => []),
  ]);
  offerings.value = offs.map((o) => ({ id: o.id, subject: o.subject }));
  siblings.value = kids
    .filter((c) => c.kind === "CLASSE" && c.id !== u.id)
    .map((c) => ({ id: c.id, name: c.name }));
  teachers.value = people.map((person) => ({
    id: person.id,
    label: `${person.lastName} ${person.firstName}`,
  }));
}
watch(yearId, () => {
  if (!loading.value) void loadSheet();
});

// ── acting in place ─────────────────────────────────────────────────────────
/** A structural operation on this node: add a child, rename, close, reopen. */
const menuAction = ref<"add" | "rename" | "close" | "reopen" | null>(null);
/** A registry action, run over this page. */
const runSpec = ref<ActionSpec | null>(null);

/**
 * The action rich enough to have its own form, opened in place.
 *
 * Enrolling is done WHILE looking at a class list. Leaving for a page, filling
 * it in, and coming back to a roster that has to be reloaded to show the pupil
 * you just added is three steps where one will do — so the form opens over the
 * class, and closing it refreshes what is underneath.
 */
const inlineForm = ref<"enroll" | null>(null);


function onRun(payload: { spec: ActionSpec }) {
  if (payload.spec.inline) {
    inlineForm.value = payload.spec.inline;
    return;
  }
  runSpec.value = payload.spec;
}

/** Adds an evaluation to this classe and période, from the sheet itself. */
function openAssessment(subjectId?: string) {
  const spec = byId("create-assessment");
  if (!spec) return;
  const offering = subjectId
    ? offerings.value.find((o) => o.subject.id === subjectId)
    : undefined;
  assessmentPrefill.value = {
    academicYearId: yearId.value ?? "",
    ...(periodId.value ? { periodId: periodId.value } : {}),
    ...(offering ? { courseOfferingId: offering.id } : {}),
  };
  runSpec.value = spec;
}

function onRunDone() {
  notice.value = `${runSpec.value?.label} — effectué.`;
  void loadSheet();
}

/**
 * A button in a subject's own column header — see SheetGroup.action.
 *
 * The one place an evaluation can be created from where it will appear: the
 * form opens knowing the classe, the période and the matière, so it asks only
 * what it cannot know — the type, the intitulé and the barème.
 */
function onGroupAct(key: string) {
  const [kind, id] = key.split(":");
  if (kind === "assessment") { openAssessment(id); return; }

  /**
   * The coefficient, set from the sheet where its absence is noticed.
   *
   * It belongs to the NIVEAU — the curriculum lives there, not on a cohort —
   * so the dialog opens scoped to the parent rather than to this classe. That
   * indirection is the whole reason it used to be somewhere else, and it is
   * not a reason a titulaire should have to care about: they are looking at a
   * column of marks that will not be weighted, and this is where they are.
   */
  if (kind === "coefficient" && id && unit.value?.parentId) {
    void flushMarks();
    coefficientPrefill.value = {
      academicYearId: yearId.value ?? "",
      subjectId: id,
    };
    coefficientUnit.value = org.byId(unit.value.parentId);
    runSpec.value = byId("set-coefficient") ?? null;
  }
}

/**
 * The unit a dialog runs against, when it is not this page's own.
 *
 * Only the coefficient needs it so far: everything else on a classe acts on the
 * classe. Null means "use the node we are standing on".
 */
const coefficientUnit = ref<api.TreeUnit | null>(null);

/** The overlay closed after a save: show what changed, not a stale list. */
async function onInlineDone(result: { name: string }) {
  inlineForm.value = null;
  notice.value = `${result.name} inscrit(e).`;
  await load();
}

async function onStructureDone(changed: boolean) {
  const was = menuAction.value;
  menuAction.value = null;
  if (!changed) return;
  notice.value =
    was === "add" ? "Élément créé." : was === "rename" ? "Renommé." : "État mis à jour.";
  await org.load(true);
  await load();
}

/** The tree row for this node, for the dialogs that want a TreeUnit. */
const treeUnit = computed(() => org.byId(id.value));

// ── the sheet ───────────────────────────────────────────────────────────────
/**
 * Which face of this node is open.
 *
 * Seeded from the URL so an action can point at one — "emploi du temps" in the
 * rail lands on the grid, not on the pupil list with the grid one click away.
 */
const tab = ref(typeof route.query.tab === "string" ? route.query.tab : "general");
watch(
  () => route.query.tab,
  (t) => {
    if (typeof t === "string" && t) tab.value = t;
  },
);

const TIMETABLE_TAB: SheetTab = { id: "timetable", label: "Emploi du temps" };

/**
 * Which subject of the programme is open, from the URL.
 *
 * A query rather than component state: the back button is how anyone leaves a
 * drill-down, and a subject sheet you cannot link to is one you cannot send to
 * the teacher it is about.
 */
const subjectId = computed(() =>
  typeof route.query.subject === "string" ? route.query.subject : null,
);
watch(subjectId, () => void loadSheet());

/**
 * Which période the Notes tab is showing.
 *
 * A selector rather than every période side by side: three trimestres × six
 * subjects × three evaluations is fifty-four columns, and a conseil sits on one
 * trimestre at a time.
 */
const periodId = ref<string | null>(null);
watch(sheet, (s) => {
  if (!s?.periods.length) {
    periodId.value = null;
    return;
  }
  if (s.periods.some((p) => p.id === periodId.value)) return;

  /*
   * The période with something in it, not simply the last one.
   *
   * Opening on the last was the first guess and it opened on an empty grid all
   * through Trimestre 1 — the trimestre nobody has marked yet is exactly the
   * one nobody wants to look at. The last période that HAS evaluations is the
   * one a teacher was working in.
   */
  const withMarks = [...s.periods].reverse().find((p) => p.assessments.length);
  periodId.value = (withMarks ?? s.periods[0]!).id;
});

const tabs = computed<SheetTab[]>(() => {
  // A classe: its pupils under four column sets, plus its week.
  if (sheet.value) {
    return [
      ...studentTabs(sheet.value, { periodId: periodId.value, editable: canEnterMarks.value }),
      TIMETABLE_TAB,
    ];
  }

  // A subject opened from the programme replaces the tab strip with its own:
  // it is a drill-down, and offering the level's other sheets beside it invites
  // the operator to lose their place.
  if (subject.value) return subjectTabs(subject.value);

  return [
    ...(children.value.length ? [childrenTab()] : []),
    // A niveau is where the curriculum lives, so its sheet is the programme.
    ...(programme.value ? niveauTabs(programme.value) : []),
    // A cycle or a school owns the calendar the whole level is cut into.
    ...(periods.value ? [periodTab()] : []),
    ...(staff.value.length ? staffTabs() : []),
  ];
});

const childRows = computed(() =>
  children.value.map((c) => ({
    ...c,
    kindLabel: KIND_FR[c.kind],
    state: c.validTo ? "Fermé" : "Actif",
  })),
);

/** Flattened once per load, not per render: the grade grid is a nested map. */
const sheetRows = computed<Record<string, unknown>[]>(() => {
  if (subject.value) return subject.value.rows;
  if (tab.value === "children") return childRows.value as unknown as Record<string, unknown>[];
  if (tab.value === "periods") return (periods.value?.rows ?? []) as unknown as Record<string, unknown>[];
  if (tab.value === "programme" || tab.value === "coefficients") {
    return (programme.value?.rows ?? []) as unknown as Record<string, unknown>[];
  }
  if (sheet.value) {
    const rows = sheet.value.rows.map(flattenStudentRow);
    if (!markOverrides.value.size) return rows;
    // What was typed wins over what was loaded, until the reload catches up —
    // and the subject averages are recomputed from it as it is typed.
    return rows.map((row) => {
      const out = { ...row };
      for (const [key, value] of markOverrides.value) {
        const [column, studentId] = key.split("|");
        if (studentId === row.studentId && column) out[column] = value;
      }
      return withLiveAverages(out);
    });
  }
  return staff.value as unknown as Record<string, unknown>[];
});

/**
 * The subject averages, recomputed from what is on screen.
 *
 * A mark typed into the sheet has to move the Moy. beside it, or the column
 * is a number that lags a save behind and quietly contradicts the cells it is
 * the average of. The server sends the same figure and wins the moment the
 * reload lands — this only fills the seconds in between.
 *
 * The rule is the API's, deliberately duplicated rather than approximated: each
 * mark scaled to /20 by its OWN barème, absences and blanks skipped entirely
 * because an absence is not a zero, two decimals. If the two ever disagree the
 * cell will visibly jump when the save returns, which is the failure mode worth
 * having — a silent divergence would be the other one.
 */
function withLiveAverages(row: Record<string, unknown>): Record<string, unknown> {
  const period = sheet.value?.periods.find((p) => p.id === periodId.value);
  if (!period) return row;

  const out = { ...row };
  for (const subject of sheet.value?.subjects ?? []) {
    const evaluations = period.assessments.filter((a) => a.subjectId === subject.id);
    if (!evaluations.length) continue;

    let sum = 0;
    let n = 0;
    for (const a of evaluations) {
      const value = out[`e:${a.id}`];
      // 'abs' and null alike: neither is a score, and averaging either in
      // would invent a grade the pupil never got.
      if (typeof value !== "number") continue;
      sum += (value / (a.max || 20)) * 20;
      n += 1;
    }
    out[`g:${period.id}:${subject.id}`] = n ? Math.round((sum / n) * 100) / 100 : null;
  }
  return out;
}

/**
 * Whether this période can still be typed into at all.
 *
 * A locked période is the council's, not the teacher's — see the API, which
 * refuses the write regardless. Deciding it here as well is what stops the
 * grid from offering forty inputs that would each fail.
 */
const canEnterMarks = computed(() => {
  const period = sheet.value?.periods.find((p) => p.id === periodId.value);
  return !!period && !period.locked;
});

const activeTab = computed(
  () => tabs.value.find((t) => t.id === tab.value) ?? tabs.value[0] ?? null,
);

// A tab set that changed under us (classe → division) must not leave the strip
// pointing at a tab that no longer exists.
watch(tabs, (list) => {
  if (list.length && !list.some((t) => t.id === tab.value)) tab.value = list[0]!.id;
});

const rowKey = computed(() =>
  sheet.value && tab.value !== "children" && tab.value !== "timetable" ? "studentId" : "id",
);


/**
 * A row is a destination.
 *
 * A child unit opens its own page; a PUPIL opens their bulletin, which is the
 * document every other column on this sheet is an ingredient of. Clicking a
 * name and being told nothing was the gap — a teacher looking at 8.50 in maths
 * wants the rest of the picture, and the rest of the picture is a bulletin.
 */
function onPick(row: Record<string, unknown>) {
  if (tab.value === "children") {
    void router.push({ name: "unit", params: { id: String(row.id) } });
    return;
  }
  if (!sheet.value || !row.studentId) return;
  void flushMarks();
  void router.push({
    name: "bulletin",
    params: { id: String(row.studentId) },
    query: {
      ...(periodId.value ? { period: periodId.value } : {}),
      from: unit.value?.id ?? "",
    },
  });
}

/**
 * A button in an evaluation's own column header.
 *
 * Everything that belongs to the evaluation rather than to a pupil: rename it,
 * change its barème, hand it over, take it back, remove it.
 */
function onHeaderAct(key: string) {
  const [kind, id] = key.split(":");
  if (kind !== "assessment" || !id) return;
  const period = sheet.value?.periods.find((p) => p.id === periodId.value);
  const found = period?.assessments.find((a) => a.id === id);
  if (!found) return;
  void flushMarks();
  editing.value = { ...found, title: found.label, maxScore: found.max };
}

/** The evaluation whose editor is open, if any. */
const editing = ref<(api.SheetAssessment & { title: string; maxScore: number }) | null>(null);
const editingBusy = ref(false);
const confirmDelete = ref(false);

async function runOnAssessment(work: () => Promise<unknown>, done: string) {
  if (!editing.value) return;
  editingBusy.value = true;
  markError.value = null;
  try {
    await busy.run(work);
    editing.value = null;
    confirmDelete.value = false;
    notice.value = done;
    await loadSheet();
  } catch (e) {
    markError.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    editingBusy.value = false;
  }
}

/**
 * A cell that is a control was used.
 *
 * Two cases, both on the programme sheet: the subject NAME opens that subject's
 * marks, and an empty COEFFICIENT offers to fill itself. The second is the more
 * interesting one — everything the form needs except the number is already
 * known from where the operator is standing, so it is prefilled and the dialog
 * asks one question.
 */
function onAct(payload: { row: Record<string, unknown>; column: SheetColumn }) {
  const { row, column } = payload;

  if (column.key === "name" && unit.value?.kind === "NIVEAU") {
    void router.push({
      name: "unit",
      params: { id: unit.value.id },
      query: { subject: String(row.subjectId) },
    });
    return;
  }

  if (column.key === "coefficient" || column.key.startsWith("coef:")) {
    const spec = byId("set-coefficient");
    if (!spec || !unit.value) return;
    // Everything the niveau and the row already answer, answered.
    coefficientPrefill.value = {
      academicYearId: yearId.value ?? "",
      subjectId: String(row.subjectId),
      ...(column.key.startsWith("coef:") ? { serieId: column.key.slice(5) } : {}),
    };
    runSpec.value = spec;
  }
}

// ── typing marks into the sheet ─────────────────────────────────────────────
/**
 * Marks are entered in the grid, and saved without being asked to.
 *
 * The model is the timetable's: the artefact on screen IS the editor. A
 * teacher with a paper mark list types down a column and never reaches for a
 * button; the writes are batched per evaluation and go out shortly after the
 * typing stops, and the strip at the foot says where they got to.
 *
 * Overrides are held here rather than pushed into `sheet` so a failed save
 * cannot leave the grid showing a mark the server refused.
 */
const markOverrides = ref<Map<string, number | "abs" | null>>(new Map());
/** assessmentId → studentId → what to write. */
const pending = new Map<string, Map<string, api.MarkEntry>>();
const markState = ref<"idle" | "dirty" | "saving" | "saved">("idle");
const markSavedAt = ref<string | null>(null);
const markError = ref<string | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * What the operator typed, as a mark.
 *
 * "a" is absent, and that matters more than it looks: absence is not zero, and
 * a teacher who has to leave the keyboard to tick a box will type 0 instead.
 * Returns null for text that is not yet a mark — a lone "-" mid-typing — so
 * nothing is written until it means something.
 */
function parseMark(raw: string): { entry: Omit<api.MarkEntry, "studentId">; shown: number | "abs" | null } | null {
  const text = raw.trim().toLowerCase().replace(",", ".");
  if (text === "") return { entry: { score: null, isAbsent: false }, shown: null };
  if (["a", "ab", "abs", "absent"].includes(text)) {
    return { entry: { score: null, isAbsent: true }, shown: "abs" };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return { entry: { score: value, isAbsent: false }, shown: value };
}

function onEdit(payload: { rowKey: string; column: SheetColumn; raw: string }) {
  const { rowKey, column, raw } = payload;
  if (!column.edit) return;
  const parsed = parseMark(raw);
  if (!parsed) return;

  // The barème is refused server-side too; catching it here means the teacher
  // is told at the cell rather than after the column has been sent.
  if (typeof parsed.shown === "number" && parsed.shown > column.edit.max) {
    markError.value = `${parsed.shown} dépasse le barème de ${column.edit.max}.`;
    return;
  }
  markError.value = null;

  markOverrides.value = new Map(markOverrides.value).set(`${column.key}|${rowKey}`, parsed.shown);

  const byStudent = pending.get(column.edit.assessmentId) ?? new Map<string, api.MarkEntry>();
  byStudent.set(rowKey, { studentId: rowKey, ...parsed.entry });
  pending.set(column.edit.assessmentId, byStudent);

  markState.value = "dirty";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushMarks(), 700);
}

/** Sends everything typed since the last flush, one call per evaluation. */
async function flushMarks() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pending.size) return;

  const batch: { assessmentId: string; entries: api.MarkEntry[] }[] = [...pending.entries()].map(
    ([assessmentId, rows]) => ({ assessmentId, entries: [...rows.values()] }),
  );
  pending.clear();
  markState.value = "saving";
  try {
    for (const { assessmentId, entries } of batch) {
      await api.grading.saveMarks(assessmentId, entries);
    }
    markState.value = "saved";
    markSavedAt.value = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    // Quietly re-read so the subject averages catch up. Rows keep their keys,
    // so this repaints cells and nothing else.
    const u = unit.value;
    if (u && yearId.value) {
      const fresh = await api.sheets.classe(u.id, yearId.value).catch(() => null);
      if (fresh) {
        sheet.value = fresh;
        markOverrides.value = new Map();
      }
    }
  } catch (e) {
    markState.value = "dirty";
    markError.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  }
}

/** Leaving with marks in flight would lose them. */
onBeforeUnmount(() => void flushMarks());
watch(tab, () => void flushMarks());

/** Values the coefficient dialog opens with — see onAct. */
const coefficientPrefill = ref<Record<string, string>>({});
/** Values the "add an evaluation" dialog opens with. */
const assessmentPrefill = ref<Record<string, string>>({});

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const moneyFmt = (v: number) => XAF.format(v);

/** What the class owes, which is the number an économe opens this page for. */
const totalDue = computed(() =>
  (sheet.value?.rows ?? []).reduce((sum, r) => sum + Math.max(0, r.balanceXaf), 0),
);
</script>

<template>
  <div class="nodepage" :class="{ 'has-sheet': !!activeTab }">
    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 35%" /><div class="skeleton" style="width: 60%" />
    </div></div>

    <!-- The load failed: this banner is the whole page, so it has no
         close button — there is nothing behind it to reveal. -->
    <Alert v-else-if="error" :closable="false">{{ error }}</Alert>

    <template v-else-if="unit">
      <!--
        The toolbar belongs to the whole work column, not to this page's reading
        width, so it is teleported into the strip the layout renders above the
        padded content. The trail that says where "here" is lives in the topbar
        and is not repeated.
      -->
      <Teleport to="#node-toolbar">
        <NodeActionBar :unit="unit" @run="onRun" @structure="(a) => (menuAction = a)" />
      </Teleport>

      <!--
        ONE LINE: what this node is, and its numbers.

        The heading was 21px with a subtitle under it, then a stat bar with its
        own rule below that, then a row of note pills — 159px of chrome,
        measured, above a grid that is the entire reason for the page. On a
        768px laptop that is twenty pupils nobody can see. Nothing was dropped
        except an explanation of a button that explains itself; the heading
        simply stopped being a poster.
      -->
      <div class="nodebar">
        <div class="nodebar-id">
          <h1 class="nodebar-title">{{ unit.name }}</h1>
          <span class="nodebar-kind">
            {{ KIND_FR[unit.kind] }} · {{ unit.code }}
            <template v-if="unit.validTo"> · fermé</template>
          </span>
        </div>

        <div class="nodebar-stats">
          <div v-if="sheet" class="statbar-item">
            <span class="statbar-label">Effectif</span>
            <span class="statbar-value">{{ sheet.rows.length }}</span>
          </div>
          <div v-else class="statbar-item">
            <span class="statbar-label">Contient</span>
            <span class="statbar-value">{{ children.length }}</span>
          </div>
          <div v-if="sheet" class="statbar-item">
            <span class="statbar-label">Impayés</span>
            <span class="statbar-value" :class="{ 'is-warn': totalDue > 0 }">
              {{ moneyFmt(totalDue) }} XAF
            </span>
          </div>
          <div v-if="unit.capacity" class="statbar-item">
            <span class="statbar-label">Capacité</span>
            <span class="statbar-value">
              {{ unit.capacity }}
              <span v-if="sheet" class="statbar-note">
                · {{ unit.capacity - sheet.rows.length }} libre(s)
              </span>
            </span>
          </div>
          <div v-if="!sheet && staff.length" class="statbar-item">
            <span class="statbar-label">Personnel</span>
            <span class="statbar-value">{{ staff.length }}</span>
          </div>
          <div class="statbar-item">
            <span class="statbar-label">État</span>
            <span class="statbar-value">{{ unit.validTo ? "Fermé" : "Actif" }}</span>
          </div>
        </div>
      </div>

      <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
      <Alert v-if="markError" kind="error" @close="markError = null">{{ markError }}</Alert>

      <!--
        A drill-down says what it is and how to leave.
        The browser's back button works — the subject is in the URL — but a
        screen whose only exit is browser chrome is a screen people feel stuck
        in, and the heading above still says "Sixième".
      -->
      <div v-if="subject" class="sheet-notes">
        <RouterLink
          class="btn sm ghost"
          :to="{ name: 'unit', params: { id: unit.id } }"
        >
          ← Programme
        </RouterLink>
        <span class="sheet-note">
          {{ subject.subject.name }} — {{ subject.rows.length }} élève(s) du niveau,
          toutes classes confondues
        </span>
      </div>

      <!-- Why a column set is empty, straight from the API rather than left
           for the operator to work out from blank cells. Above the grid, not
           below: below, they pushed the tab strip — the control they are
           telling you to use — past the bottom of the window. -->
      <div v-if="sheet?.notes.length" class="sheet-notes">
        <span v-for="(n, i) in sheet.notes" :key="i" class="sheet-note">{{ n }}</span>
      </div>

      <!--
        The sheet. One set of rows, and tabs at the foot for which columns are
        over them — the shape schools already keep this data in.
      -->
      <div v-if="activeTab?.empty" class="hint" style="margin-bottom: var(--s2)">
        {{ activeTab.empty }}
      </div>

      <!--
        The week is not a row sheet. Time down, days across, and an empty cell
        that IS the button — see TimetableGrid. It shares the tab strip because
        it is another face of the same class, not another screen.
      -->
      <!--
        The week. No "create a timetable" prompt: an empty grid IS the create
        screen, and a door in front of an open door only costs a click. The one
        thing worth saying up front is when there is nothing to place.
      -->
      <template v-if="activeTab?.id === 'timetable' && unit.kind === 'CLASSE' && yearId">
        <!--
          A week we were not given rather than a week that is empty.
          The API sends no slots at all to a caller who cannot draw the grid
          until someone publishes it — see TimetablePublication — and an empty
          grid with no explanation reads as "this class has no lessons", which
          is a different and much more alarming statement.
        -->
        <div v-if="!gridPublished && !gridIsDraft" class="sheet-notes">
          <span class="sheet-note">
            Emploi du temps non publié — il n'est visible que par les personnes
            qui le préparent.
          </span>
        </div>

        <div v-else-if="!offerings.length" class="sheet-notes">
          <span class="sheet-note">
            Aucune matière programmée sur
            {{ org.byId(unit.parentId)?.name ?? "ce niveau" }} — un créneau porte une
            matière du niveau.
          </span>
          <RouterLink
            class="btn sm"
            :to="{ name: 'action', params: { id: 'create-offering' }, query: { scope: unit.parentId } }"
          >
            Programmer une matière
          </RouterLink>
        </div>

        <!--
          The grid hands back the week it now holds, and this stores it.
          It used to emit "something changed" and this reloaded the class —
          which blanked the week, refetched forty pupils and their marks, and
          redrew every lesson, all to record one créneau.
        -->
        <TimetableGrid
          :classe-id="unit.id"
          :academic-year-id="yearId"
          :slots="grid"
          :offerings="offerings"
          :staff="teachers"
          :siblings="siblings"
          :published="gridPublished"
          :published-at="gridPublishedAt"
          :version="gridVersion"
          :has-unpublished-changes="gridPending"
          :readonly="!gridPublished && !gridIsDraft"
          @changed="(slots) => (grid = slots)"
          @published="
            (v) => {
              gridPublished = v;
              gridPublishedAt = v ? new Date().toISOString() : null;
              gridVersion = v ? (gridVersion ?? 0) + 1 : null;
              gridPending = false;
              notice = v
                ? `Version ${gridVersion} publiée — c'est celle que voient les enseignants et les familles.`
                : 'Emploi du temps retiré — plus personne ne le voit.';
            }
          "
        />

        <SheetTabs v-model="tab" :tabs="tabs">
          <template #end>
            <label v-if="years.length > 1" class="sheet-pick">
              <span>Année</span>
              <select v-model="yearId" aria-label="Année scolaire">
                <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
            </label>
          </template>
        </SheetTabs>
      </template>

      <template v-else-if="activeTab">
        <DataSheet
          :tab="activeTab"
          :rows="sheetRows"
          :row-key="rowKey"
          :clickable="tab === 'children' || (!!sheet && tab !== 'timetable')"
          :title="subject ? `${unit.name} — ${subject.subject.code}` : unit.name"
          @pick="onPick"
          @act="onAct"
          @group-act="onGroupAct"
          @header-act="onHeaderAct"
          @edit="onEdit"
        />

        <SheetTabs v-model="tab" :tabs="tabs">
          <template #end>
            <!--
              The Notes tab is one période at a time; this is which one. Named,
              because two bare dropdowns side by side in a strip of buttons say
              nothing about which is the période and which the année.
            -->
            <label v-if="sheet && tab === 'grades' && sheet.periods.length" class="sheet-pick">
              <span>Période</span>
              <select v-model="periodId" aria-label="Période">
                <option v-for="p in sheet.periods" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </label>
            <!--
              Where the typing got to. Nobody presses save: the writes go out
              shortly after the keystrokes stop, and this is the receipt.
            -->
            <span v-if="sheet && tab === 'grades' && markState !== 'idle'" class="marksave">
              <span v-if="markState === 'saving'" class="btn-spin" aria-hidden="true" />
              {{
                markState === "saving"
                  ? "Enregistrement…"
                  : markState === "dirty"
                    ? "Modifications non enregistrées"
                    : `Enregistré à ${markSavedAt}`
              }}
            </span>
            <button
              v-if="sheet && tab === 'grades' && periodId"
              class="btn sm"
              type="button"
              title="Choisir la matière dans le formulaire — ou utiliser le ＋ de la matière voulue"
              @click="openAssessment()"
            >
              Nouvelle évaluation
            </button>
            <label v-if="sheet && years.length > 1" class="sheet-pick">
              <span>Année</span>
              <select v-model="yearId" aria-label="Année scolaire">
                <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
            </label>
            <button
              v-if="sheet && tab !== 'grades'"
              class="btn sm"
              type="button"
              @click="inlineForm = 'enroll'"
            >
              Inscrire un élève
            </button>
          </template>
        </SheetTabs>


      </template>

      <!-- No sheet applies: nothing is under this node and nobody is posted
           to it. There is one thing to offer, so offer only that. -->
      <div v-else class="card">
        <div class="empty">
          <div class="empty-title">Vide</div>
          <div>Rien sous ce {{ KIND_FR[unit.kind].toLowerCase() }} pour l'instant.</div>
          <div class="empty-actions">
            <!-- IN PLACE. This was a link to the Structure screen, which threw
                 away the node you were standing on and offered to create one at
                 the root — the opposite of what the button says. -->
            <button class="btn primary" type="button" @click="menuAction = 'add'">
              Ajouter un élément
            </button>
          </div>
        </div>
      </div>

      <NodeMenuDialogs
        :unit="treeUnit"
        :action="menuAction"
        @done="onStructureDone"
      />

      <ActionDialog
        v-if="runSpec"
        :spec="runSpec"
        :unit="coefficientUnit ?? unit"
        :prefill="{ ...coefficientPrefill, ...assessmentPrefill }"
        @close="
          ((runSpec = null),
          (coefficientPrefill = {}),
          (assessmentPrefill = {}),
          (coefficientUnit = null))
        "
        @done="onRunDone"
      />

      <!--
        One evaluation: its name, its barème, and where it stands.

        Opened from the column's own header, because that is the only place on
        screen that IS the evaluation. The three buttons are the three states it
        can move between — and which of them appear is decided by the state it
        is in, not by permissions the client is guessing at.
      -->
      <DialogShell
        v-if="editing"
        :title="editing.label"
        :subtitle="`${unit.name} · ${sheet?.periods.find((p) => p.id === periodId)?.label ?? ''}`"
        :detail="
          editing.published
            ? 'Publiée par le conseil : les bulletins la citent, elle ne bouge plus.'
            : editing.submitted
              ? 'Remise. Rouvrez-la pour corriger une note.'
              : 'Saisie ouverte — les notes se tapent directement dans la feuille.'
        "
        icon="fileText"
        @close="((editing = null), (confirmDelete = false))"
      >
        <Alert v-if="markError" kind="error" @close="markError = null">{{ markError }}</Alert>

        <template v-if="!editing.published && !editing.submitted">
          <div class="field-row">
            <div class="field is-wide">
              <label for="ev-title">Intitulé</label>
              <input id="ev-title" v-model="editing.title" autocomplete="off" placeholder="Devoir n°1" />
            </div>
            <div class="field">
              <label for="ev-max">Barème</label>
              <input id="ev-max" v-model.number="editing.maxScore" type="number" min="1" max="100" />
            </div>
          </div>
        </template>

        <div v-else class="statbar" style="margin: 0; border: none; padding: 0">
          <div class="statbar-item">
            <span class="statbar-label">Barème</span>
            <span class="statbar-value">{{ editing.max }}</span>
          </div>
          <div class="statbar-item">
            <span class="statbar-label">État</span>
            <span class="statbar-value">{{ editing.published ? "Publiée" : "Remise" }}</span>
          </div>
        </div>

        <p v-if="confirmDelete" class="dialog-text">
          Supprimer cette évaluation efface aussi <strong>toutes ses notes</strong>.
          Cette action ne peut pas être annulée.
        </p>

        <div class="form-actions dialog-actions">
          <button
            v-if="!editing.published"
            class="btn sm danger ghost"
            type="button"
            :disabled="editingBusy"
            @click="
              confirmDelete
                ? runOnAssessment(
                    () => api.grading.deleteAssessment(editing!.id, true),
                    'Évaluation supprimée.',
                  )
                : (confirmDelete = true)
            "
          >
            {{ confirmDelete ? "Confirmer la suppression" : "Supprimer" }}
          </button>
          <div class="sheet-bar-fill" />
          <button class="btn ghost" type="button" @click="((editing = null), (confirmDelete = false))">
            Fermer
          </button>
          <button
            v-if="editing.submitted && !editing.published"
            class="btn"
            type="button"
            :disabled="editingBusy"
            @click="runOnAssessment(() => api.grading.reopenAssessment(editing!.id), 'Évaluation rouverte.')"
          >
            Rouvrir la saisie
          </button>
          <button
            v-if="!editing.submitted && !editing.published"
            class="btn"
            type="button"
            :disabled="editingBusy"
            title="Toutes les notes doivent être saisies, absences comprises."
            @click="runOnAssessment(() => api.grading.submitAssessment(editing!.id), 'Notes remises.')"
          >
            Remettre les notes
          </button>
          <button
            v-if="!editing.submitted && !editing.published"
            class="btn primary"
            type="button"
            :disabled="editingBusy"
            @click="
              runOnAssessment(
                () =>
                  api.grading.updateAssessment(editing!.id, {
                    title: editing!.title,
                    maxScore: editing!.maxScore,
                  }),
                'Évaluation modifiée.',
              )
            "
          >
            <span v-if="editingBusy" class="btn-spin" aria-hidden="true" />
            Enregistrer
          </button>
        </div>
      </DialogShell>

      <DialogShell
        v-if="inlineForm === 'enroll'"
        title="Inscrire un élève"
        :subtitle="`${KIND_FR[unit.kind]} · ${unit.name}`"
        detail="L'élève, ses tuteurs et son inscription sont créés ensemble."
        icon="userPlus"
        wide
        @close="inlineForm = null"
      >
        <EnrollForm :fixed-classe="unit.id" @enrolled="onInlineDone">
          <template #cancel>
            <button class="btn ghost" type="button" @click="inlineForm = null">Annuler</button>
          </template>
        </EnrollForm>
      </DialogShell>
    </template>
  </div>
</template>
