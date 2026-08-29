<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import ModulePicker from "../../components/structure/ModulePicker.vue";

/**
 * Browses AND builds the recursive OrgUnit tree.
 *
 * It only browsed before, which made the console unusable on day one: a
 * director signed in, saw "Aucun élément à ce niveau", and had no control
 * anywhere on the screen that could create one. Two things were missing and
 * both are here now.
 *
 *   · The BUILDER, for an établissement that is nothing but a root. It installs
 *     the ministry's structure for the cycles the school actually runs, so the
 *     first hour is not spent typing in the six levels every collège has.
 *   · The CREATE form, for everything after that — a new classe in January, a
 *     série the school added, a département nobody anticipated.
 *
 * A level-by-level drill rather than an expanding tree: préscolaire is four
 * levels deep and a university seven, and a fully expanded seven-level tree of
 * a real complex is unreadable on the 1366×768 screens these offices run.
 */
const router = useRouter();
const busy = useBusyStore();

const crumbs = ref<api.OrgUnit[]>([]);
const units = ref<api.OrgUnit[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const state = ref<api.Completeness | null>(null);

const KIND_FR: Record<api.OrgUnitKind, string> = {
  COMPLEX: "Complexe",
  ORG_DIVISION: "Direction",
  DEPARTMENT: "Département",
  SCHOOL: "École",
  CYCLE: "Cycle",
  FACULTY: "Faculté",
  FILIERE: "Filière",
  PARCOURS: "Parcours",
  NIVEAU: "Niveau",
  CLASSE: "Classe",
};

const parentId = computed(() => crumbs.value.at(-1)?.id ?? null);
const parentName = computed(() => crumbs.value.at(-1)?.name ?? "la racine");

// ── the builder ─────────────────────────────────────────────────────────────
const building = ref(false);
const modules = ref<api.BlueprintModule[]>([]);
const preview = ref<api.ScaffoldPreview | null>(null);
const notice = ref<string | null>(null);

watch(
  modules,
  async (list) => {
    if (!list.length) {
      preview.value = null;
      return;
    }
    try {
      preview.value = await api.orgUnits.previewScaffold(list);
    } catch {
      preview.value = null;
    }
  },
  { immediate: true },
);

async function install() {
  if (!modules.value.length) return;
  error.value = null;
  try {
    const report = await busy.run(() => api.orgUnits.scaffold(modules.value), {
      title: "Installation de la structure",
      detail: "Création des écoles, cycles, niveaux, séries et périodes.",
    });
    notice.value =
      `${report.orgUnits} unité(s), ${report.series} série(s) et ` +
      `${report.periods} période(s) créées.` +
      (report.skipped ? ` ${report.skipped} déjà présente(s), laissée(s) intacte(s).` : "");
    building.value = false;
    modules.value = [];
    await refresh();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Installation impossible.";
  }
}

// ── creating one unit ───────────────────────────────────────────────────────
const creating = ref(false);
const allowedKinds = ref<api.OrgUnitKind[]>([]);
const form = ref({ kind: "" as api.OrgUnitKind | "", name: "", code: "" });
const createError = ref<string | null>(null);
const createBusy = ref(false);

async function openCreate() {
  createError.value = null;
  form.value = { kind: "", name: "", code: "" };
  try {
    // Asked, not assumed: ALLOWED_PARENTS is what the POST enforces, so a
    // client guessing from its own copy offers options the server refuses.
    allowedKinds.value = await api.orgUnits.allowedKinds(parentId.value);
    form.value.kind = allowedKinds.value[0] ?? "";
    creating.value = true;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

/** Codes appear on printed documents and must be unique among siblings. */
function suggestCode(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

watch(
  () => form.value.name,
  (v) => {
    if (!form.value.code) form.value.code = suggestCode(v);
  },
);

const canCreate = computed(
  () =>
    form.value.kind !== "" &&
    form.value.name.trim().length >= 2 &&
    form.value.code.trim().length >= 1 &&
    !createBusy.value,
);

async function submitCreate() {
  if (!canCreate.value) return;
  createBusy.value = true;
  createError.value = null;
  try {
    await busy.run(() =>
      api.orgUnits.create({
        parentId: parentId.value,
        kind: form.value.kind as api.OrgUnitKind,
        name: form.value.name.trim(),
        code: form.value.code.trim().toUpperCase(),
        rank: units.value.length + 1,
      }),
    );
    creating.value = false;
    await load(parentId.value);
    await refresh();
  } catch (e) {
    createError.value = e instanceof api.ApiError ? e.message : "Création impossible.";
  } finally {
    createBusy.value = false;
  }
}

// ── browsing ────────────────────────────────────────────────────────────────
async function load(id: string | null) {
  loading.value = true;
  error.value = null;
  try {
    units.value = await busy.run(() => api.orgUnits.children(id));
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
    units.value = [];
  } finally {
    loading.value = false;
  }
}

async function refresh() {
  try {
    state.value = await api.orgUnits.completeness();
  } catch {
    state.value = null;
  }
}

function open(unit: api.OrgUnit) {
  // A classe is a leaf in this browser — it opens its own page (roster,
  // bulletins) rather than drilling further.
  if (unit.kind === "CLASSE") {
    void router.push({ name: "classe", params: { id: unit.id } });
    return;
  }
  crumbs.value.push(unit);
  creating.value = false;
  void load(unit.id);
}

function goTo(index: number) {
  crumbs.value = crumbs.value.slice(0, index + 1);
  creating.value = false;
  void load(crumbs.value.at(-1)?.id ?? null);
}

function goRoot() {
  crumbs.value = [];
  creating.value = false;
  void load(null);
}

onMounted(async () => {
  await Promise.all([load(null), refresh()]);
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Structure</h1>
        <div class="page-sub">Écoles, cycles, niveaux et classes</div>
      </div>
      <div class="page-actions">
        <button
          v-if="state && !state.isEmpty && !building"
          class="btn"
          type="button"
          @click="building = true"
        >
          Ajouter un cycle
        </button>
        <button
          v-if="!creating && state && !state.isEmpty"
          class="btn primary"
          type="button"
          @click="openCreate"
        >
          Nouvel élément
        </button>
      </div>
    </div>

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <!-- Nothing but a root. Every other screen in the console is empty until
         this is answered, so it is the only thing on the page. -->
    <div v-if="state?.isEmpty && !building" class="card">
      <div class="empty">
        <div class="empty-title">Votre établissement n'a pas encore de structure</div>
        <div style="max-width: 56ch; margin: 0 auto">
          Rien ne peut encore être fait : ni inscrire un élève, ni saisir une note,
          ni éditer un bulletin. Installez la structure officielle des cycles que
          vous ouvrez — vous n'aurez ensuite qu'à créer vos classes et affecter
          votre personnel.
        </div>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="building = true">
            Installer la structure
          </button>
          <button class="btn" type="button" @click="openCreate">
            Construire moi-même
          </button>
        </div>
      </div>
    </div>

    <!-- The builder. Also reachable later, to add a cycle in January. -->
    <div v-if="building" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Structure officielle
        <button class="btn sm ghost" type="button" @click="building = false">Fermer</button>
      </div>
      <div class="card-body">
        <p class="fieldset-note">
          Ces structures suivent la réforme de janvier 2026 : primaire ramené à
          cinq ans avec un CP unique, CEP sur contrôle continu, secondaire en
          4 + 3 ans, LMD généralisé dans le supérieur. Cochez les cycles que votre
          établissement ouvre réellement.
        </p>
        <ModulePicker v-model="modules" />
        <div v-if="preview" class="preview">
          <div class="preview-item"><b>{{ preview.orgUnits }}</b> unités</div>
          <div class="preview-item"><b>{{ preview.levels }}</b> niveaux</div>
          <div class="preview-item"><b>{{ preview.series }}</b> séries</div>
          <div class="preview-item"><b>{{ preview.departments }}</b> services</div>
        </div>
      </div>
      <div class="card-foot">
        <span class="hint" style="margin-right: auto">
          Ce qui existe déjà est conservé — rien n'est remplacé.
        </span>
        <button class="btn primary" type="button" :disabled="!modules.length" @click="install">
          Installer
        </button>
      </div>
    </div>

    <nav v-if="!state?.isEmpty || building" class="tree-crumbs" aria-label="Chemin">
      <button type="button" @click="goRoot">Racine</button>
      <template v-for="(c, i) in crumbs" :key="c.id">
        <span aria-hidden="true">/</span>
        <button type="button" @click="goTo(i)">{{ c.name }}</button>
      </template>
    </nav>

    <!-- Create one unit here. Kinds come from the server, so the form can only
         offer what the tree will accept. -->
    <div v-if="creating" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Nouvel élément dans « {{ parentName }} »
        <button class="btn sm ghost" type="button" @click="creating = false">Annuler</button>
      </div>
      <div class="card-body">
        <div v-if="createError" class="form-error">{{ createError }}</div>
        <div v-if="!allowedKinds.length" class="hint">
          Rien ne peut être créé à ce niveau. Une classe est le dernier échelon de
          l'arbre.
        </div>
        <div v-else class="field-row">
          <div class="field">
            <label for="u-kind">Type</label>
            <select id="u-kind" v-model="form.kind">
              <option v-for="k in allowedKinds" :key="k" :value="k">{{ KIND_FR[k] }}</option>
            </select>
          </div>
          <div class="field">
            <label for="u-name">Nom</label>
            <input id="u-name" v-model="form.name" autocomplete="off" placeholder="6e A" />
          </div>
          <div class="field">
            <label for="u-code">Code</label>
            <input id="u-code" v-model="form.code" autocomplete="off" maxlength="8" placeholder="6EA" />
            <span class="hint">Sur les bulletins. Unique parmi les frères.</span>
          </div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn primary" type="button" :disabled="!canCreate" @click="submitCreate">
          <span v-if="createBusy" class="btn-spin" aria-hidden="true" />
          {{ createBusy ? "Création…" : "Créer" }}
        </button>
      </div>
    </div>

    <div v-if="!state?.isEmpty || building" class="card">
      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 45%" />
        <div class="skeleton" style="width: 65%" />
      </div>
      <div v-else-if="!units.length" class="empty">
        <div class="empty-title">Aucun élément à ce niveau</div>
        <div>Créez le premier depuis « Nouvel élément ».</div>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="openCreate">Nouvel élément</button>
        </div>
      </div>
      <button
        v-for="unit in units"
        v-else
        :key="unit.id"
        class="unit-row"
        type="button"
        @click="open(unit)"
      >
        <span>
          <span class="unit-name">{{ unit.name }}</span>
          <span class="unit-meta"> · {{ unit.code }}</span>
          <span v-if="unit.validTo" class="pill warn" style="margin-left: 8px">Fermé</span>
        </span>
        <span class="kind-tag">{{ KIND_FR[unit.kind] }}</span>
      </button>
    </div>

    <!-- Levels but no cohorts: the next real blocker after the structure lands. -->
    <div v-if="state?.needsClasses" class="card" style="margin-top: var(--s4)">
      <div class="card-body">
        <strong>Prochaine étape : les classes.</strong>
        <p style="margin: var(--s1) 0 0; color: var(--ink-2)">
          {{ state.levels }} niveaux sont en place mais aucune classe n'existe encore.
          Un élève s'inscrit dans une classe, pas dans un niveau — ouvrez au moins
          une classe par niveau que vous faites tourner cette année.
        </p>
      </div>
    </div>
  </div>
</template>
