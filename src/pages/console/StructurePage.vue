<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { useAuthStore } from "../../stores/auth";
import ModulePicker from "../../components/structure/ModulePicker.vue";
import UpgradeDialog from "../../components/structure/UpgradeDialog.vue";
import Icon from "../../components/ui/Icon.vue";
import { KIND_FR } from "../../components/structure/kinds";
import Alert from "../../components/ui/Alert.vue";
import { useBanner } from "../../lib/banner";

/**
 * Structure: what the établissement is made of, and how to add to it.
 *
 * The tree is NOT here any more. It lives in the organisation pane beside this
 * screen, which is present for exactly the routes where the tree is the
 * subject — so keeping a second copy in the page meant two trees side by side,
 * each with its own selection and its own idea of what was expanded.
 *
 * What remains is everything the tree cannot do: install the official
 * structure, create a unit, and see the shape of the whole thing at a glance.
 * Selecting a node in the pane opens its own page.
 */
const busy = useBusyStore();

/**
 * Qui peut voir les OUTILS de structure.
 *
 * Deliberately not the page: the tree is how a teacher reaches the class they
 * teach, and a console that hides the way in is a console that cannot be used.
 * What `structure.write` gates is everything that reshapes the établissement,
 * and the composition summary — an inventory of the whole complex is not a
 * route to anything, it is a thing you are shown because you administer it.
 */
const mayEdit = computed(() => useAuthStore().can("structure.write"));

const units = ref<api.TreeUnit[]>([]);
const state = ref<api.Completeness | null>(null);
const loading = ref(true);
const { notice, error } = useBanner();

/**
 * MES CLASSES ET MES MATIÈRES — ce que cet écran dit à un enseignant.
 *
 * Sans `structure.write`, il ne restait ici qu'un titre et la phrase
 * « l'arborescence est à gauche » : une page qui ne répond à rien. Or la
 * question que pose un enseignant en cliquant sur « Structure » est
 * précisément « qu'est-ce que je tiens », et le produit connaît la réponse
 * depuis qu'on rattache les enseignements.
 *
 * L'arbre de gauche est déjà borné à sa portée côté serveur (voir
 * orgUnitsService.visibleIds) : il n'y voit que ses classes et la branche qui
 * les nomme. Ceci est l'autre moitié — la liste, avec les matières, que
 * l'arbre ne peut pas montrer parce qu'une matière n'est pas un nœud.
 */
const myLoad = ref<api.TeachingLoad[]>([]);

/** Groupées par classe, comme une charge se lit. */
const myClasses = computed(() => {
  const groups = new Map<string, {
    name: string; niveau: string; subjects: string[]; whole: boolean
  }>();
  for (const row of myLoad.value) {
    const entry = groups.get(row.classeId)
      ?? { name: row.classeName, niveau: row.niveau, subjects: [], whole: false };
    if (row.wholeClasse) entry.whole = true;
    else entry.subjects.push(row.subject);
    groups.set(row.classeId, entry);
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g }));
});

async function reload() {
  loading.value = true;
  try {
    const [tree, completeness, load] = await Promise.all([
      busy.run(() => api.orgUnits.tree()),
      // Les outils de structure seulement: inutile de le demander à qui ne
      // peut pas s'en servir, et l'API le refuserait.
      mayEdit.value ? api.orgUnits.completeness().catch(() => null) : null,
      api.teaching.mine().then((r) => r.assignments).catch(() => []),
    ]);
    units.value = tree;
    state.value = completeness;
    myLoad.value = load;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

/** A count per kind — the shape of the établissement in one line each. */
const byKind = computed(() => {
  const counts = new Map<api.OrgUnitKind, number>();
  for (const u of units.value) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
});

const roots = computed(() => units.value.filter((u) => u.parentId === null));

// ── creating a unit at the root ─────────────────────────────────────────────
const creating = ref(false);
const allowedKinds = ref<api.OrgUnitKind[]>([]);
const form = ref({ kind: "" as api.OrgUnitKind | "", name: "", code: "" });
const createBusy = ref(false);
const createError = ref<string | null>(null);

async function openCreate() {
  createError.value = null;
  form.value = { kind: "", name: "", code: "" };
  try {
    // Asked, not assumed: ALLOWED_PARENTS is what the POST enforces.
    allowedKinds.value = await api.orgUnits.allowedKinds(null);
    form.value.kind = allowedKinds.value[0] ?? "";
    creating.value = true;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  }
}

watch(
  () => form.value.name,
  (v) => {
    if (!form.value.code) {
      form.value.code = v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
    }
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
        parentId: null,
        kind: form.value.kind as api.OrgUnitKind,
        name: form.value.name.trim(),
        code: form.value.code.trim().toUpperCase(),
        rank: roots.value.length + 1,
      }),
    );
    creating.value = false;
    await reload();
  } catch (e) {
    createError.value = e instanceof api.ApiError ? e.message : "Création impossible.";
  } finally {
    createBusy.value = false;
  }
}

// ── installing a blueprint ──────────────────────────────────────────────────
const building = ref(false);
const modules = ref<api.BlueprintModule[]>([]);
const preview = ref<api.ScaffoldPreview | null>(null);

watch(
  modules,
  async (list) => {
    preview.value = list.length
      ? await api.orgUnits.previewScaffold(list).catch(() => null)
      : null;
  },
  { immediate: true },
);

/**
 * Adds what is missing — after showing the operator what that is.
 *
 * Needed because the module picker DISABLES installed modules — correctly, to
 * stop an operator ticking a cycle they already have and being told "0 créées,
 * 8 déjà présentes". But that also blocks the one case where re-running is
 * exactly right: a complex created before the official subjects, the course
 * offerings or the exercice comptable existed.
 *
 * It used to apply the lot on one click. The scaffold is idempotent so nothing
 * was ever damaged, but "add everything missing" bundles three missing classes
 * with two hundred course offerings, and those are not the same decision. The
 * dialog asks; this only reports what came of it.
 */
const upgrading = ref(false);

function onUpgraded(report: api.ScaffoldReport) {
  upgrading.value = false;
  notice.value =
    report.orgUnits + report.subjects + report.offerings + report.fiscalYears === 0
      ? "Rien à ajouter : l'établissement est déjà à jour."
      : `${report.subjects} matière(s), ${report.offerings} programmation(s), ` +
        `${report.orgUnits} unité(s) et ${report.fiscalYears} exercice(s) ajoutés.`;
  void reload();
}

async function install() {
  if (!modules.value.length) return;
  try {
    const report = await busy.run(() => api.orgUnits.scaffold(modules.value), {
      title: "Installation de la structure",
      detail: "Écoles, cycles, niveaux, classes, matières, séries et périodes.",
    });
    notice.value =
      `${report.orgUnits} unité(s), ${report.subjects} matière(s) et ` +
      `${report.offerings} programmation(s) créées` +
      (report.skipped ? `, ${report.skipped} déjà présente(s).` : ".");
    building.value = false;
    modules.value = [];
    await reload();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Installation impossible.";
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><Icon name="tree" :size="19" /> Structure</h1>
        <div class="page-sub">
          <template v-if="mayEdit">
            L'arborescence est à gauche. Sélectionnez-y une unité pour la consulter,
            ou ajoutez-en une ici.
          </template>
          <template v-else>
            Ce que vous enseignez, et où. L'arborescence à gauche ne montre que
            vos classes.
          </template>
        </div>
      </div>
      <!-- L'ARBRE RESTE NAVIGABLE, les OUTILS non.
           A teacher reaches their classe through this tree, so hiding the page
           would hide the way in. What goes is everything that RESHAPES it —
           "mettre à niveau", "structure type", "nouvel élément" — plus the
           composition summary, which is an inventory of the établissement
           rather than a route to anything. -->
      <div v-if="mayEdit" class="page-actions">
        <button
          v-if="(state?.installedModules?.length ?? 0) > 0"
          class="btn"
          type="button"
          title="Montre ce qui manque par rapport à la structure officielle des cycles installés, et vous laisse choisir."
          @click="upgrading = true"
        >
          <Icon name="check" /> Mettre à niveau
        </button>
        <button class="btn" type="button" @click="building = !building">
          <Icon name="layers" /> Structure type
        </button>
        <button class="btn primary" type="button" @click="openCreate">
          <Icon name="plus" /> Nouvel élément
        </button>
      </div>
    </div>

    <UpgradeDialog v-if="upgrading" @close="upgrading = false" @applied="onUpgraded" />

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <!-- The tree in the pane stays put while this is open: installing a cycle
         must not make the operator lose their place in the structure. -->
    <div v-if="building" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Structure officielle
        <button class="btn sm ghost" type="button" @click="building = false">Fermer</button>
      </div>
      <div class="card-body">
        <p class="fieldset-note">
          Réforme de janvier 2026 : primaire à cinq ans avec un CP unique, CEP sur
          contrôle continu, secondaire en 4 + 3 ans, LMD généralisé. Chaque niveau
          reçoit une classe et les matières des examens nationaux du cycle — CEPE,
          BEPC, baccalauréat. Les coefficients restent à définir : ils dépendent de
          la série, et c'est la seule chose que nous ne devinons pas à votre place.
        </p>
        <ModulePicker v-model="modules" :installed="state?.installedModules ?? []" />
        <div v-if="preview" class="preview">
          <div class="preview-item"><b>{{ preview.orgUnits }}</b> unités</div>
          <div class="preview-item"><b>{{ preview.levels }}</b> niveaux</div>
          <div class="preview-item"><b>{{ preview.classes }}</b> classes</div>
          <div class="preview-item"><b>{{ preview.subjects }}</b> matières</div>
          <div class="preview-item"><b>{{ preview.series }}</b> séries</div>
        </div>
      </div>
      <div class="card-foot">
        <span class="hint" style="margin-right: auto">
          Ce qui existe déjà est conservé.
        </span>
        <button class="btn primary" type="button" :disabled="!modules.length" @click="install">
          Installer
        </button>
      </div>
    </div>

    <div v-if="creating" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Nouvel élément à la racine
        <button class="btn sm ghost" type="button" @click="creating = false">Annuler</button>
      </div>
      <div class="card-body">
        <Alert v-if="createError" kind="error" @close="createError = null">{{ createError }}</Alert>
        <div v-if="!allowedKinds.length" class="hint">
          Rien ne peut être créé à la racine : le complexe existe déjà. Sélectionnez
          une unité dans l'arborescence pour y ajouter un élément.
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
            <input id="u-name" v-model="form.name" autocomplete="off" />
          </div>
          <div class="field">
            <label for="u-code">Code</label>
            <input id="u-code" v-model="form.code" autocomplete="off" maxlength="8" />
          </div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn primary" type="button" :disabled="!canCreate" @click="submitCreate">
          <span v-if="createBusy" class="btn-spin" aria-hidden="true" />
          Créer
        </button>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 60%" />
    </div></div>

    <!-- ── mes classes ──────────────────────────────────────────────────── -->
    <!--
      Pour qui n'administre pas la structure, c'est TOUT l'écran — et c'était
      une page vide. Les matières viennent avec, parce que l'arbre ne peut pas
      les porter: une matière n'est pas un nœud.
    -->
    <div v-else-if="!mayEdit" class="card">
      <div class="card-head">
        Mes enseignements
        <span class="unit-meta">{{ myClasses.length }} classe(s)</span>
      </div>

      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 45%" /><div class="skeleton" style="width: 60%" />
      </div>

      <div v-else-if="!myClasses.length" class="empty">
        <div class="empty-title">Aucun enseignement rattaché</div>
        <div>
          Tant que rien ne vous est rattaché, vous ne pouvez saisir aucune note
          ni faire aucun appel. Demandez-le à la direction.
        </div>
      </div>

      <div v-else class="card-body">
        <div v-for="c in myClasses" :key="c.id" class="teach-group">
          <div class="teach-group-head">
            <RouterLink :to="{ name: 'unit', params: { id: c.id } }">
              {{ c.niveau }} · {{ c.name }}
            </RouterLink>
          </div>
          <div class="teach-chips">
            <!-- Le titulaire tient la classe, pas une liste de matières: on
                 écrit ce qui est vrai plutôt qu'une énumération qui serait
                 périmée à la prochaine matière ajoutée. -->
            <span v-if="c.whole" class="teach-chip">Toutes les matières</span>
            <span v-for="sub in c.subjects" :key="sub" class="teach-chip">{{ sub }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Après « mes enseignements » : un enseignant sans classe voit un arbre
         vide, et « votre établissement n'a pas de structure » est alors une
         affirmation sur l'école là où c'est un fait sur lui. -->
    <div v-else-if="!units.length" class="card">
      <div class="empty">
        <div class="empty-title">Votre établissement n'a pas encore de structure</div>
        <div style="max-width: 56ch; margin: 0 auto">
          Rien ne peut être fait : ni inscrire un élève, ni saisir une note, ni éditer
          un bulletin. Installez la structure officielle des cycles que vous ouvrez.
        </div>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="building = true">
            Installer la structure
          </button>
          <button class="btn" type="button" @click="openCreate">Construire moi-même</button>
        </div>
      </div>
    </div>

    <!-- The shape of the whole thing, which the tree shows one branch at a
         time and this shows at a glance. An inventory of the établissement is
         not a route to anything, so it goes with the tools rather than with
         the tree. -->
    <div v-else-if="mayEdit" class="card">
      <div class="card-head">Composition</div>
      <div class="card-body">
        <div class="grid-cards">
          <div v-for="[kind, n] in byKind" :key="kind" class="stat">
            <div class="stat-label">{{ KIND_FR[kind] }}</div>
            <div class="stat-value">{{ n }}</div>
          </div>
        </div>
      </div>
      <div class="card-foot">
        <span class="hint" style="margin-right: auto">
          {{ units.length }} unité(s) au total.
        </span>
      </div>
    </div>
  </div>
</template>
