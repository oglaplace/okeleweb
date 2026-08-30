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
  childrenTab, flattenStudentRow, staffTabs, studentTabs, type SheetTab,
} from "../../components/sheet/columns";

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

    if (u.kind === "CLASSE") {
      years.value = await api.academics.years().catch(() => []);
      yearId.value =
        yearId.value ?? (years.value.find((y) => y.isCurrent) ?? years.value[0])?.id ?? null;
      await loadSheet();
    } else {
      // Everything else holds units — and, often, people posted to it.
      staff.value = await api.sheets.staff(u.id).then((r) => r.rows).catch(() => []);
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}
watch(id, load, { immediate: true });

/** The sheet alone — a year change must not reload the whole page. */
async function loadSheet() {
  if (!unit.value || unit.value.kind !== "CLASSE" || !yearId.value) return;
  sheet.value = await api.sheets.classe(unit.value.id, yearId.value).catch(() => null);
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
const tab = ref("general");

const tabs = computed<SheetTab[]>(() => {
  if (sheet.value) return studentTabs(sheet.value);
  // A school has children AND staff; both are sheets of the same workbook.
  return [
    ...(children.value.length ? [childrenTab()] : []),
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

const rowKey = computed(() => (sheet.value && tab.value !== "children" ? "studentId" : "id"));

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
  <div>
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

      <div class="grid-cards" style="margin-bottom: var(--s4)">
        <div v-if="sheet" class="stat">
          <div class="stat-label">Effectif</div>
          <div class="stat-value">{{ sheet.rows.length }}</div>
          <div class="stat-note">élève(s) inscrit(s)</div>
        </div>
        <div v-else class="stat">
          <div class="stat-label">Contient</div>
          <div class="stat-value">{{ children.length }}</div>
          <div class="stat-note">élément(s) direct(s)</div>
        </div>
        <div v-if="sheet" class="stat">
          <div class="stat-label">Impayés</div>
          <div class="stat-value">{{ moneyFmt(totalDue) }}</div>
          <div class="stat-note">XAF, année en cours</div>
        </div>
        <div v-if="unit.capacity" class="stat">
          <div class="stat-label">Capacité</div>
          <div class="stat-value">{{ unit.capacity }}</div>
          <div class="stat-note">
            {{ sheet ? `${unit.capacity - sheet.rows.length} place(s) libre(s)` : "places" }}
          </div>
        </div>
        <div v-if="!sheet && staff.length" class="stat">
          <div class="stat-label">Personnel</div>
          <div class="stat-value">{{ staff.length }}</div>
          <div class="stat-note">affecté(s) ici</div>
        </div>
        <div class="stat">
          <div class="stat-label">État</div>
          <div class="stat-value" style="font-size: var(--t-h3)">
            {{ unit.validTo ? "Fermé" : "Actif" }}
          </div>
        </div>
      </div>

      <!--
        The sheet. One set of rows, and tabs at the foot for which columns are
        over them — the shape schools already keep this data in.
      -->
      <template v-if="activeTab">
        <DataSheet
          :tab="activeTab"
          :rows="sheetRows"
          :row-key="rowKey"
          :clickable="tab === 'children'"
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

        <div v-if="activeTab.empty" class="hint" style="margin-top: var(--s2)">
          {{ activeTab.empty }}
        </div>

        <!-- Why a column set is empty, straight from the API rather than left
             for the operator to work out from blank cells. -->
        <div v-if="sheet?.notes.length" class="sheet-notes">
          <span v-for="(n, i) in sheet.notes" :key="i" class="sheet-note">{{ n }}</span>
        </div>
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
