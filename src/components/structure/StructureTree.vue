<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as api from "../../lib/api";
import TreeNode from "./TreeNode.vue";

/**
 * The complex, as a file tree, in the rail.
 *
 * The structure page browses one level at a time — right for a 1366×768 screen
 * where a seven-level expansion is unreadable. But navigating between two
 * classes in different cycles meant walking back up to the root and down again,
 * every time. The tree in the rail is the other half: always present, always
 * showing where you are in the complex, and one click from any classe.
 */
const roots = ref<api.OrgUnit[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    roots.value = await api.orgUnits.children(null);
  } catch {
    roots.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
defineExpose({ reload: load });
</script>

<template>
  <div class="tree">
    <div v-if="loading" class="tnode-hint">Chargement…</div>
    <div v-else-if="!roots.length" class="tnode-hint">
      Aucune structure. Installez-la depuis la page Structure.
    </div>
    <TreeNode v-for="unit in roots" v-else :key="unit.id" :unit="unit" :depth="0" />
  </div>
</template>
