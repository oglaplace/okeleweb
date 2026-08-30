<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../../components/structure/kinds";
import { useOrgStore } from "../../stores/org";
import ActionDialog from "../../components/actions/ActionDialog.vue";
import NodeActionBar from "../../components/console/NodeActionBar.vue";
import NodeMenuDialogs from "../../components/console/NodeMenuDialogs.vue";
import EnrollForm from "../../components/enrollment/EnrollForm.vue";
import DialogShell from "../../components/ui/DialogShell.vue";

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
 */
const route = useRoute();
const org = useOrgStore();
const id = computed(() => route.params.id as string);

const unit = ref<api.OrgUnit | null>(null);
const children = ref<api.OrgUnit[]>([]);
const roster = ref<api.RosterRow[] | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  roster.value = null;
  try {
    const [u, kids] = await Promise.all([
      api.orgUnits.get(id.value),
      api.orgUnits.children(id.value),
      org.load(),
    ]);
    unit.value = u;
    children.value = kids;

    // A leaf holds people, not units — so show them without a second click.
    if (u.kind === "CLASSE") {
      const years = await api.academics.years().catch(() => []);
      const year = years.find((y) => y.isCurrent) ?? years[0];
      if (year) {
        roster.value = await api.enrollment.roster(u.id, year.id).catch(() => []);
      }
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}
watch(id, load, { immediate: true });

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
async function onInlineDone(name: string) {
  inlineForm.value = null;
  notice.value = `${name} inscrit(e).`;
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

      <div class="grid-cards" style="margin-bottom: var(--s5)">
        <div class="stat">
          <div class="stat-label">Contient</div>
          <div class="stat-value">{{ children.length }}</div>
          <div class="stat-note">élément(s) direct(s)</div>
        </div>
        <div v-if="roster" class="stat">
          <div class="stat-label">Effectif</div>
          <div class="stat-value">{{ roster.length }}</div>
          <div class="stat-note">élève(s) inscrit(s)</div>
        </div>
        <div v-if="unit.capacity" class="stat">
          <div class="stat-label">Capacité</div>
          <div class="stat-value">{{ unit.capacity }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">État</div>
          <div class="stat-value" style="font-size: var(--t-h3)">
            {{ unit.validTo ? "Fermé" : "Actif" }}
          </div>
        </div>
      </div>

      <!-- A leaf holds people; everything else holds units. -->
      <div v-if="roster" class="card is-grid">
        <div class="card-head">
          Effectif
          <button class="btn sm" type="button" @click="inlineForm = 'enroll'">
            Inscrire un élève
          </button>
        </div>
        <div v-if="!roster.length" class="empty">
          <div class="empty-title">Aucun élève inscrit</div>
          <div>Cette classe existe mais personne n'y est encore inscrit.</div>
          <div class="empty-actions">
            <!-- Over the class, not away from it: the form opens with this
                 class already chosen and the roster refreshes underneath. -->
            <button class="btn primary" type="button" @click="inlineForm = 'enroll'">
              Inscrire un élève
            </button>
            <RouterLink class="btn" :to="{ name: 'import', query: { scope: unit.id } }">
              Importer une liste
            </RouterLink>
          </div>
        </div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="c-name">Élève</th>
                <th class="c-text">Matricule</th>
                <!-- The number a titulaire dials, on the screen where they
                     realise they need it. -->
                <th class="c-text">Tuteur</th>
                <th class="c-text">Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roster" :key="r.id">
                <td class="c-name">
                  {{ r.student.person.lastName.toUpperCase() }} {{ r.student.person.firstName }}
                </td>
                <td class="c-text">{{ r.student.matricule }}</td>
                <td class="c-text">
                  <template v-if="r.student.guardians?.[0]">
                    {{ r.student.guardians[0].guardian.lastName }}
                    <span class="cell-sub">{{ r.student.guardians[0].guardian.phone ?? "—" }}</span>
                  </template>
                  <span v-else class="cell-sub">Aucun tuteur</span>
                </td>
                <td class="c-text">
                  <span v-if="r.isRepeating" class="pill warn">Redoublant</span>
                  <span v-else class="pill ok">Inscrit</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="card is-grid">
        <div class="card-head">Contenu</div>
        <div v-if="!children.length" class="empty">
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
        <div v-else class="table-wrap">
          <table class="data">
            <thead><tr><th class="c-name">Nom</th><th class="c-text">Type</th></tr></thead>
            <tbody>
              <tr v-for="c in children" :key="c.id" class="is-clickable">
                <td class="c-name">
                  <RouterLink :to="{ name: 'unit', params: { id: c.id } }">{{ c.name }}</RouterLink>
                </td>
                <td class="c-text">{{ KIND_FR[c.kind] }}</td>
              </tr>
            </tbody>
          </table>
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
