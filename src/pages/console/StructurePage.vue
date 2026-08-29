<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import Explorer from "../../components/structure/Explorer.vue";
import ModulePicker from "../../components/structure/ModulePicker.vue";
import Icon from "../../components/ui/Icon.vue";
import { KIND_FR } from "../../components/structure/kinds";

/**
 * The explorer: the whole tree on the left, the selected unit on the right.
 *
 * This replaces a level-by-level drill where reaching 6e B meant four clicks
 * down and four back up. The tree is now permanent — it stays put while a
 * cycle is installed or a unit created beside it, so the operator never loses
 * their place in the structure they are editing.
 */
const router = useRouter();
const busy = useBusyStore();

const units = ref<api.TreeUnit[]>([]);
const selected = ref<api.TreeUnit | null>(null);
const state = ref<api.Completeness | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function reload() {
  loading.value = true;
  try {
    const [tree, completeness] = await Promise.all([
      busy.run(() => api.orgUnits.tree()),
      api.orgUnits.completeness().catch(() => null),
    ]);
    units.value = tree;
    state.value = completeness;
    if (selected.value) {
      selected.value = tree.find((u) => u.id === selected.value!.id) ?? null;
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

/** Root-first path of the selected node. */
const path = computed(() => {
  if (!selected.value) return [];
  const byId = new Map(units.value.map((u) => [u.id, u]));
  const parts: api.TreeUnit[] = [];
  let cursor: string | null = selected.value.id;
  for (let i = 0; cursor && i < 12; i++) {
    const u = byId.get(cursor);
    if (!u) break;
    parts.unshift(u);
    cursor = u.parentId;
  }
  return parts;
});

const children = computed(() =>
  selected.value ? units.value.filter((u) => u.parentId === selected.value!.id) : [],
);

// ── creating a unit under the selection ─────────────────────────────────────
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
    allowedKinds.value = await api.orgUnits.allowedKinds(selected.value?.id ?? null);
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
        parentId: selected.value?.id ?? null,
        kind: form.value.kind as api.OrgUnitKind,
        name: form.value.name.trim(),
        code: form.value.code.trim().toUpperCase(),
        rank: children.value.length + 1,
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

async function install() {
  if (!modules.value.length) return;
  try {
    const report = await busy.run(() => api.orgUnits.scaffold(modules.value), {
      title: "Installation de la structure",
      detail: "Écoles, cycles, niveaux, classes, séries et périodes.",
    });
    notice.value =
      `${report.orgUnits} unité(s) créée(s)` +
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
          L'établissement au complet. Sélectionnez une unité pour la consulter ou y
          ajouter des éléments.
        </div>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="building = !building">
          <Icon name="layers" /> Structure type
        </button>
        <button class="btn primary" type="button" @click="openCreate">
          <Icon name="plus" /> Nouvel élément
        </button>
      </div>
    </div>

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <!-- The tree stays put while this is open: installing a cycle must not
         make the operator lose their place in the structure. -->
    <div v-if="building" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Structure officielle
        <button class="btn sm ghost" type="button" @click="building = false">Fermer</button>
      </div>
      <div class="card-body">
        <p class="fieldset-note">
          Réforme de janvier 2026 : primaire à cinq ans avec un CP unique, CEP sur
          contrôle continu, secondaire en 4 + 3 ans, LMD généralisé. Une classe est
          ouverte à chaque niveau, du préscolaire au lycée technique.
        </p>
        <!-- `installed` was built and never wired. Without it the picker
             offered a module the tenant already had, the operator ticked it,
             and the scaffold correctly skipped every row — reporting "0 créées,
             8 déjà présentes" and showing names they had never typed. -->
        <ModulePicker v-model="modules" :installed="state?.installedModules ?? []" />
        <div v-if="preview" class="preview">
          <div class="preview-item"><b>{{ preview.orgUnits }}</b> unités</div>
          <div class="preview-item"><b>{{ preview.levels }}</b> niveaux</div>
          <div class="preview-item"><b>{{ preview.classes }}</b> classes</div>
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

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 60%" />
    </div></div>

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

    <!-- Tree left, selection right. The tree never moves. -->
    <div v-else class="split">
      <div class="card is-grid split-tree">
        <Explorer
          :units="units"
          :selected="selected?.id ?? null"
          @select="(u) => { selected = u; creating = false; }"
        />
      </div>

      <div class="split-detail">
        <div v-if="creating" class="card" style="margin-bottom: var(--s4)">
          <div class="card-head">
            Nouvel élément dans « {{ selected?.name ?? 'la racine' }} »
            <button class="btn sm ghost" type="button" @click="creating = false">Annuler</button>
          </div>
          <div class="card-body">
            <div v-if="createError" class="form-error">{{ createError }}</div>
            <div v-if="!allowedKinds.length" class="hint">
              Rien ne peut être créé ici — une classe est le dernier échelon.
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
                <input id="u-name" v-model="form.name" autocomplete="off" placeholder="6e B" />
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

        <div v-if="!selected" class="card">
          <div class="empty">
            <div class="empty-title">Aucune unité sélectionnée</div>
            <div>Choisissez une unité dans l'arborescence pour voir ce qu'elle contient.</div>
          </div>
        </div>

        <div v-else class="card">
          <div class="card-head">
            {{ selected.name }}
            <span class="kind-tag">{{ KIND_FR[selected.kind] }}</span>
          </div>
          <div class="card-body">
            <nav class="crumbs" style="margin-bottom: var(--s3)">
              <template v-for="(p, i) in path" :key="p.id">
                <span v-if="i > 0" class="crumbs-sep" aria-hidden="true">›</span>
                <button class="crumbs-link" type="button" @click="selected = p">{{ p.name }}</button>
              </template>
            </nav>

            <div class="grid-cards">
              <div class="stat">
                <div class="stat-label">Code</div>
                <div class="stat-value" style="font-size: var(--t-h3)">{{ selected.code }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Contient</div>
                <div class="stat-value">{{ children.length }}</div>
                <div class="stat-note">élément(s) direct(s)</div>
              </div>
              <div class="stat">
                <div class="stat-label">État</div>
                <div class="stat-value" style="font-size: var(--t-h3)">
                  {{ selected.validTo ? "Fermé" : "Actif" }}
                </div>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <RouterLink
              v-if="selected.kind === 'CLASSE'"
              class="btn"
              :to="{ name: 'classe', params: { id: selected.id } }"
            >Ouvrir la classe</RouterLink>
            <button class="btn primary" type="button" @click="openCreate">
              <Icon name="plus" /> Ajouter ici
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
