<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import { KIND_FR, KIND_SHORT } from "./kinds";

/**
 * One node of the structure tree, and its children when opened.
 *
 * Children are fetched on FIRST EXPAND, never up front. A complex is thirty-odd
 * units before a single class exists and several hundred after a term of
 * enrolment; walking the whole tree to render a sidebar would mean one request
 * per node on every page load, over a connection that is metered.
 *
 * The component recurses into itself. Depth is bounded by the domain — seven
 * levels is the deepest legal tree — so there is no runaway to guard against
 * here; `MAX_TREE_DEPTH` on the server guards the data.
 */
const props = defineProps<{ unit: api.OrgUnit; depth: number }>();

const router = useRouter();
const open = ref(false);
const children = ref<api.OrgUnit[] | null>(null);
const loading = ref(false);

/** A classe is a leaf in this tree: it has its own page, not sub-units. */
const isLeaf = props.unit.kind === "CLASSE";

async function toggle() {
  if (isLeaf) {
    void router.push({ name: "classe", params: { id: props.unit.id } });
    return;
  }
  open.value = !open.value;
  if (open.value && children.value === null) {
    loading.value = true;
    try {
      children.value = await api.orgUnits.children(props.unit.id);
    } catch {
      children.value = [];
    } finally {
      loading.value = false;
    }
  }
}
</script>

<template>
  <div class="tnode">
    <button
      class="tnode-row"
      type="button"
      :style="{ paddingLeft: `${8 + depth * 13}px` }"
      :aria-expanded="isLeaf ? undefined : open"
      :title="unit.name"
      @click="toggle"
    >
      <span class="tnode-twist" aria-hidden="true">
        {{ isLeaf ? "·" : open ? "▾" : "▸" }}
      </span>
      <span class="tnode-name">{{ unit.name }}</span>
      <span class="tnode-kind">{{ KIND_SHORT[unit.kind] }}</span>
    </button>

    <div v-if="open">
      <div v-if="loading" class="tnode-hint" :style="{ paddingLeft: `${21 + depth * 13}px` }">
        Chargement…
      </div>
      <div
        v-else-if="children && !children.length"
        class="tnode-hint"
        :style="{ paddingLeft: `${21 + depth * 13}px` }"
      >
        Vide — rien sous ce {{ KIND_FR[unit.kind].toLowerCase() }}.
      </div>
      <TreeNode
        v-for="child in children ?? []"
        v-else
        :key="child.id"
        :unit="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
