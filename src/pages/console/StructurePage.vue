<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";

/**
 * Browses the recursive OrgUnit tree one level at a time.
 *
 * A level-by-level drill rather than an expanding tree: préscolaire is four
 * levels deep and a university seven, and a fully expanded seven-level tree of
 * a real complex is unreadable on the 1366×768 screens these offices run.
 */
const router = useRouter();

const crumbs = ref<api.OrgUnit[]>([]);
const units = ref<api.OrgUnit[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

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

async function load(parentId: string | null) {
  loading.value = true;
  error.value = null;
  try {
    units.value = await api.orgUnits.children(parentId);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
    units.value = [];
  } finally {
    loading.value = false;
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
  void load(unit.id);
}

function goTo(index: number) {
  crumbs.value = crumbs.value.slice(0, index + 1);
  const last = crumbs.value[crumbs.value.length - 1];
  void load(last ? last.id : null);
}

function goRoot() {
  crumbs.value = [];
  void load(null);
}

onMounted(() => void load(null));
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Structure</h1>
        <div class="page-sub">Écoles, cycles, niveaux et classes</div>
      </div>
    </div>

    <nav class="tree-crumbs" aria-label="Chemin">
      <button type="button" @click="goRoot">Racine</button>
      <template v-for="(c, i) in crumbs" :key="c.id">
        <span aria-hidden="true">/</span>
        <button type="button" @click="goTo(i)">{{ c.name }}</button>
      </template>
    </nav>

    <div class="card">
      <div v-if="loading" class="empty">Chargement…</div>
      <div v-else-if="error" class="empty">{{ error }}</div>
      <div v-else-if="!units.length" class="empty">
        Aucun élément à ce niveau.
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
  </div>
</template>
