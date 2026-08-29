<script setup lang="ts">
import { computed, ref } from "vue";
import * as api from "../../lib/api";
import { KIND_FR } from "./kinds";
import Icon from "../ui/Icon.vue";

/**
 * The tree, as a file explorer, in the main content.
 *
 * It moved out of the sidebar for a reason: at 244px a seven-level tree is all
 * ellipsis, and the rail's job is navigation, not inspection. Here it has room
 * for the path, the code and the kind, and the panel beside it shows what the
 * selected node actually is.
 *
 * The whole tree arrives in ONE request and is filtered client-side; search
 * therefore costs nothing per keystroke, which is the difference between a box
 * people use and one they avoid on a metered connection. `GET /org-units/search`
 * exists for the same query server-side and is used when the tree is large
 * enough that shipping it all would be the wrong trade — not yet, at a few
 * hundred units.
 */
const props = defineProps<{ units: api.TreeUnit[]; selected: string | null }>();
const emit = defineEmits<{ select: [api.TreeUnit] }>();

const q = ref("");
const collapsed = ref<Set<string>>(new Set());

const childrenOf = computed(() => {
  const map = new Map<string | null, api.TreeUnit[]>();
  for (const u of props.units) {
    const key = u.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(u);
  }
  return map;
});

/** Ids that match the query, plus every ancestor — so a hit stays reachable. */
const visible = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return null;

  const byId = new Map(props.units.map((u) => [u.id, u]));
  const keep = new Set<string>();
  for (const u of props.units) {
    if (
      u.name.toLowerCase().includes(needle) ||
      u.code.toLowerCase().includes(needle)
    ) {
      keep.add(u.id);
      let cursor = u.parentId;
      for (let i = 0; cursor && i < 12; i++) {
        keep.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
  }
  return keep;
});

/** Flattened render list, honouring collapse and the search filter. */
const rows = computed(() => {
  const out: { unit: api.TreeUnit; depth: number; hasChildren: boolean }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const u of childrenOf.value.get(parentId) ?? []) {
      if (visible.value && !visible.value.has(u.id)) continue;
      const kids = childrenOf.value.get(u.id) ?? [];
      out.push({ unit: u, depth, hasChildren: kids.length > 0 });
      // A search result is always expanded: hiding the hit behind a collapsed
      // parent would defeat searching for it.
      if (kids.length && (visible.value || !collapsed.value.has(u.id))) {
        walk(u.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
});

function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

const matches = computed(() => (visible.value ? rows.value.length : props.units.length));
</script>

<template>
  <div class="explorer">
    <div class="explorer-search">
      <Icon name="search" :size="15" />
      <input
        v-model="q"
        type="search"
        placeholder="Rechercher une unité…"
        aria-label="Rechercher une unité"
      />
    </div>

    <div class="explorer-tree">
      <div v-if="!units.length" class="tnode-hint">Aucune unité.</div>
      <div v-else-if="!rows.length" class="tnode-hint">Aucun résultat pour « {{ q }} ».</div>

      <div
        v-for="row in rows"
        :key="row.unit.id"
        class="ex-row"
        :class="{ 'is-selected': selected === row.unit.id }"
        :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
      >
        <button
          v-if="row.hasChildren"
          class="ex-twist"
          type="button"
          :aria-label="collapsed.has(row.unit.id) ? 'Déplier' : 'Replier'"
          @click.stop="toggle(row.unit.id)"
        >
          <Icon :name="collapsed.has(row.unit.id) ? 'chevronRight' : 'chevronDown'" :size="13" />
        </button>
        <span v-else class="ex-twist ex-twist-leaf" aria-hidden="true" />

        <button class="ex-label" type="button" @click="emit('select', row.unit)">
          <Icon
            :name="row.hasChildren ? 'folder' : 'fileText'"
            :size="14"
            class="ex-icon"
          />
          <span class="ex-name">{{ row.unit.name }}</span>
          <span class="ex-code">{{ row.unit.code }}</span>
          <span class="kind-tag">{{ KIND_FR[row.unit.kind] }}</span>
        </button>
      </div>
    </div>

    <div class="explorer-foot">{{ matches }} unité(s)</div>
  </div>
</template>
