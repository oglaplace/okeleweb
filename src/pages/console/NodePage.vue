<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import { ACTIONS, GROUPS } from "../../lib/actions";
import { KIND_FR } from "../../components/structure/kinds";
import Icon from "../../components/ui/Icon.vue";

/**
 * One unit: what it is, what it holds, and everything that can be done to it.
 *
 * This merges two screens that were separate and should never have been. The
 * summary panel said what a node WAS; the class view said what it CONTAINED;
 * and neither said what you could DO with it, so reaching "saisir les notes for
 * 6e A" meant going back to the rail, picking the action, and finding 6e A
 * again in a scope list you had just been looking at.
 *
 * The applicable actions come from the same registry the rail reads, filtered
 * by this node's kind — so an action added there appears here with no work, and
 * one that cannot target a classe is never offered on one.
 */
const route = useRoute();
const id = computed(() => route.params.id as string);

const unit = ref<api.OrgUnit | null>(null);
const path = ref<api.OrgUnit[]>([]);
const children = ref<api.OrgUnit[]>([]);
const roster = ref<api.RosterRow[] | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  roster.value = null;
  try {
    const [u, chain, kids] = await Promise.all([
      api.orgUnits.get(id.value),
      api.orgUnits.ancestors(id.value),
      api.orgUnits.children(id.value),
    ]);
    unit.value = u;
    // ancestors() is root-first and includes self; the tail is this node.
    path.value = chain.slice(0, -1);
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

/** Every registry action whose declared scope includes this node's kind. */
const applicable = computed(() => {
  const kind = unit.value?.kind;
  if (!kind) return [];
  return GROUPS.map((g) => ({
    ...g,
    actions: ACTIONS.filter((a) => !a.planned && a.group === g.id && a.scope?.includes(kind)),
  })).filter((g) => g.actions.length > 0);
});

/** Carries the scope through, so the action page skips its first step. */
function actionTo(actionId: string, actionRoute?: string) {
  if (actionRoute) {
    return actionRoute === "classe" || actionRoute === "marks" || actionRoute === "bulletins"
      ? { name: actionRoute, params: { id: id.value } }
      : { name: actionRoute };
  }
  return { name: "action", params: { id: actionId }, query: { scope: id.value } };
}
</script>

<template>
  <div>
    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 35%" /><div class="skeleton" style="width: 60%" />
    </div></div>

    <div v-else-if="error" class="form-error">{{ error }}</div>

    <template v-else-if="unit">
      <div class="page-head">
        <div>
          <nav class="crumbs" style="margin-bottom: 4px">
            <template v-for="(p, i) in path" :key="p.id">
              <RouterLink class="crumbs-link" :to="{ name: 'unit', params: { id: p.id } }">
                {{ p.name }}
              </RouterLink>
              <span class="crumbs-sep" aria-hidden="true">›</span>
              <template v-if="i === path.length - 1" />
            </template>
            <span class="crumbs-here">{{ unit.name }}</span>
          </nav>
          <h1 class="page-title">{{ unit.name }}</h1>
          <div class="page-sub">{{ KIND_FR[unit.kind] }} · code {{ unit.code }}</div>
        </div>
      </div>

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

      <!-- Everything doable here, from the same registry the rail reads. -->
      <div v-if="applicable.length" class="card" style="margin-bottom: var(--s4)">
        <div class="card-head">Actions sur « {{ unit.name }} »</div>
        <div class="card-body stack">
          <div v-for="g in applicable" :key="g.id">
            <div class="nav-group" style="padding-left: 0">{{ g.label }}</div>
            <div class="node-actions">
              <RouterLink
                v-for="a in g.actions"
                :key="a.id"
                class="node-action"
                :to="actionTo(a.id, a.route)"
                :title="a.summary"
              >
                <Icon :name="a.icon" :size="15" />
                <span>{{ a.label }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <!-- A leaf holds people; everything else holds units. -->
      <div v-if="roster" class="card is-grid">
        <div class="card-head">
          Effectif
          <RouterLink class="btn sm" :to="{ name: 'enroll' }">Inscrire un élève</RouterLink>
        </div>
        <div v-if="!roster.length" class="empty">
          <div class="empty-title">Aucun élève inscrit</div>
          <div>Cette classe existe mais personne n'y est encore inscrit.</div>
          <div class="empty-actions">
            <RouterLink class="btn primary" :to="{ name: 'enroll' }">Inscrire un élève</RouterLink>
            <RouterLink class="btn" :to="{ name: 'import' }">Importer une liste</RouterLink>
          </div>
        </div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="c-name">Élève</th>
                <th class="c-text">Matricule</th>
                <th class="c-text">Série</th>
                <th class="c-text">Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roster" :key="r.id">
                <td class="c-name">
                  {{ r.student.person.lastName.toUpperCase() }} {{ r.student.person.firstName }}
                </td>
                <td class="c-text">{{ r.student.matricule }}</td>
                <td class="c-text">{{ r.serie?.code ?? "—" }}</td>
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
            <RouterLink class="btn primary" :to="{ name: 'structure' }">Ajouter un élément</RouterLink>
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
    </template>
  </div>
</template>
