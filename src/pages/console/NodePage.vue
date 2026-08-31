<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../../components/structure/kinds";
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
  type SheetTab,
} from "../../components/sheet/columns";
import TimetableGrid from "../../components/sheet/TimetableGrid.vue";

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
const id = computed(() => route.params.id as string);

const unit = ref<api.OrgUnit | null>(null);
const children = ref<api.OrgUnit[]>([]);
const sheet = ref<api.StudentSheet | null>(null);
const staff = ref<api.StaffSheetRow[]>([]);
/** The programme of a NIVEAU — what is taught here, and at what weight. */
const programme = ref<api.NiveauSheet | null>(null);
/** The calendar of a CYCLE or SCHOOL. */
const periods = ref<api.PeriodSheet | null>(null);
/** The weekly grid of a CLASSE, and what a builder needs to extend it. */
const grid = ref<api.TimetableSlot[]>([]);
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
  grid.value = [];

  if (u.kind === "CLASSE") {
    const [s, g] = await Promise.all([
      api.sheets.classe(u.id, yearId.value).catch(() => null),
      api.timetable.forClasse(u.id, yearId.value).catch(() => null),
    ]);
    sheet.value = s;
    grid.value = g?.slots ?? [];
    await loadBuilderOptions();
    return;
  }

  if (u.kind === "NIVEAU") {
    programme.value = await api.sheets.niveau(u.id, yearId.value).catch(() => null);
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

/** The empty timetable's button: show the builder before any slot exists. */
const startGrid = ref(false);

function onRun(payload: { spec: ActionSpec }) {
  if (payload.spec.inline) {
    inlineForm.value = payload.spec.inline;
    return;
  }
  runSpec.value = payload.spec;
}

function onRunDone() {
  notice.value = `${runSpec.value?.label} — effectué.`;
  void load();
}

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

const tabs = computed<SheetTab[]>(() => {
  // A classe: its pupils under four column sets, plus its week.
  if (sheet.value) return [...studentTabs(sheet.value), TIMETABLE_TAB];

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
  if (tab.value === "children") return childRows.value as unknown as Record<string, unknown>[];
  if (tab.value === "periods") return (periods.value?.rows ?? []) as unknown as Record<string, unknown>[];
  if (tab.value === "programme" || tab.value === "coefficients") {
    return (programme.value?.rows ?? []) as unknown as Record<string, unknown>[];
  }
  if (sheet.value) return sheet.value.rows.map(flattenStudentRow);
  return staff.value as unknown as Record<string, unknown>[];
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

// Moving node or tab puts the builder away: it is a state of THIS empty grid.
watch([id, tab], () => (startGrid.value = false));

/** A child row is a destination; a pupil row is not (yet). */
function onPick(row: Record<string, unknown>) {
  if (tab.value !== "children") return;
  void router.push({ name: "unit", params: { id: String(row.id) } });
}

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

    <div v-else-if="error" class="form-error">{{ error }}</div>

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

      <div class="page-head">
        <div>
          <h1 class="page-title">{{ unit.name }}</h1>
          <div class="page-sub">
            {{ KIND_FR[unit.kind] }} · code {{ unit.code }}
            <span v-if="unit.validTo"> · fermé</span>
          </div>
        </div>
      </div>

      <div v-if="notice" class="form-ok">{{ notice }}</div>

      <!--
        Four cards became one strip.
        Each card was 100px of chrome for one number, and the sheet under them
        is what the page is for — every pixel spent above it is a row nobody
        can see. The numbers are unchanged; the frame around them is gone.
      -->
      <div class="statbar">
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
      <template v-if="activeTab?.id === 'timetable' && unit.kind === 'CLASSE' && yearId">
        <div v-if="!grid.length && !offerings.length" class="card">
          <div class="empty">
            <div class="empty-title">Aucune matière programmée</div>
            <div style="max-width: 56ch; margin: 0 auto">
              Un créneau porte une matière du niveau, et
              {{ org.byId(unit.parentId)?.name ?? "ce niveau" }} n'en a aucune pour
              l'année en cours. Programmez-en une d'abord.
            </div>
            <div class="empty-actions">
              <RouterLink
                class="btn primary"
                :to="{ name: 'action', params: { id: 'create-offering' }, query: { scope: unit.parentId } }"
              >
                Programmer une matière
              </RouterLink>
            </div>
          </div>
        </div>

        <div v-else-if="!grid.length" class="card">
          <div class="empty">
            <div class="empty-title">Aucun emploi du temps</div>
            <div style="max-width: 56ch; margin: 0 auto">
              Sans créneau il n'y a pas de séance, et sans séance il n'y a pas
              d'appel — l'assiduité de cette classe ne peut pas être tenue.
            </div>
            <div class="empty-actions">
              <button class="btn primary" type="button" @click="startGrid = true">
                Construire l'emploi du temps
              </button>
            </div>
          </div>
        </div>

        <TimetableGrid
          v-if="grid.length || startGrid"
          :classe-id="unit.id"
          :academic-year-id="yearId"
          :slots="grid"
          :offerings="offerings"
          :staff="teachers"
          :siblings="siblings"
          @changed="loadSheet"
        />

        <SheetTabs v-model="tab" :tabs="tabs">
          <template #end>
            <select
              v-if="years.length > 1"
              v-model="yearId"
              class="btn sm"
              aria-label="Année scolaire"
            >
              <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
            </select>
          </template>
        </SheetTabs>
      </template>

      <template v-else-if="activeTab">
        <DataSheet
          :tab="activeTab"
          :rows="sheetRows"
          :row-key="rowKey"
          :clickable="tab === 'children'"
          :title="unit.name"
          @pick="onPick"
        />

        <SheetTabs v-model="tab" :tabs="tabs">
          <template #end>
            <select
              v-if="sheet && years.length > 1"
              v-model="yearId"
              class="btn sm"
              aria-label="Année scolaire"
            >
              <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
            </select>
            <button
              v-if="sheet"
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
        :unit="unit"
        @close="runSpec = null"
        @done="onRunDone"
      />

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
