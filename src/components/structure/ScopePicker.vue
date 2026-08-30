<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type * as api from "../../lib/api";
import { useOrgStore } from "../../stores/org";
import { KIND_FR } from "./kinds";
import Icon from "../ui/Icon.vue";

/**
 * "Which part of the établissement does this apply to?"
 *
 * Filtered by the action's declared target kinds: an action that creates a
 * devoir offers classes and nothing else, because offering a cycle would let
 * the operator build a request the API can only refuse.
 *
 * NARROW SCREENS ONLY. On a normal console this question is answered in the
 * structure column, in the same tree everything else is picked from — see
 * components/console/ScopePane.vue. Below 1100px there is no room for that
 * column, and this flat list is what remains: less context, but it fits.
 */
const props = defineProps<{ kinds: api.OrgUnitKind[]; modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const org = useOrgStore();
const q = ref("");
const loading = computed(() => org.loading && !org.loaded);

onMounted(() => void org.load());

/** Path for each candidate — "6e A" alone is ambiguous across two schools. */
const candidates = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return org
    .ofKind(props.kinds)
    .map((u) => ({ ...u, path: org.pathOf(u.id) }))
    .filter(
      (u) =>
        !needle ||
        u.name.toLowerCase().includes(needle) ||
        u.code.toLowerCase().includes(needle) ||
        u.path.toLowerCase().includes(needle),
    );
});
</script>

<template>
  <div>
    <div v-if="loading" class="skeleton" style="width: 50%" />

    <div v-else-if="!candidates.length && !q" class="empty">
      <div class="empty-title">Rien à sélectionner</div>
      <div>
        Cette action s'applique à : {{ kinds.map((k) => KIND_FR[k]).join(", ") }}.
        Aucune n'existe encore dans votre établissement.
      </div>
      <div class="empty-actions">
        <RouterLink class="btn primary" :to="{ name: 'structure' }">Structure</RouterLink>
      </div>
    </div>

    <template v-else>
      <div class="scope-search">
        <Icon name="search" :size="15" />
        <input v-model="q" type="search" placeholder="Filtrer…" aria-label="Filtrer" />
      </div>

      <div class="scope-list">
        <button
          v-for="u in candidates"
          :key="u.id"
          class="scope-item"
          :class="{ 'is-picked': modelValue === u.id }"
          type="button"
          @click="emit('update:modelValue', u.id)"
        >
          <span class="scope-text">
            <span class="scope-name">{{ u.name }}</span>
            <span class="scope-path">{{ u.path || "Racine" }}</span>
          </span>
          <span class="kind-tag">{{ KIND_FR[u.kind] }}</span>
        </button>
        <div v-if="!candidates.length" class="tnode-hint">Aucun résultat pour « {{ q }} ».</div>
      </div>
    </template>
  </div>
</template>
