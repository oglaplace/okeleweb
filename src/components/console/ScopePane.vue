<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../structure/kinds";
import { useOrgStore } from "../../stores/org";
import Explorer from "../structure/Explorer.vue";
import PaneShell from "./PaneShell.vue";
import Icon from "../ui/Icon.vue";

/**
 * "Où appliquer cette action" — in the structure column, not in the form.
 *
 * It used to be the first card of the action page, a flat list of candidates
 * stacked above the fields. Two things were wrong with that. A flat list drops
 * the hierarchy that gives a name its meaning — "6e A" is only unambiguous with
 * the school above it — and putting the question in the working column pushed
 * the actual form below the fold on every scoped action.
 *
 * Here it is the same column, the same tree and the same shell the structure
 * screen uses, so "where" is always answered in the same place on screen. The
 * answer goes in the URL rather than in a store: it survives a reload, it is
 * shareable, it puts the chosen node in the breadcrumb, and the browser's back
 * button walks the choices — which is what a navigation stack is for.
 */
const props = defineProps<{ spec: ActionSpec }>();

const route = useRoute();
const router = useRouter();
const org = useOrgStore();

onMounted(() => void org.load());

const kinds = computed(() => props.spec.scope ?? []);
const selected = computed(() => (typeof route.query.scope === "string" ? route.query.scope : null));
const candidates = computed(() => org.ofKind(kinds.value));

function pick(unit: api.TreeUnit) {
  // `replace`: choosing, then re-choosing, must not leave a trail of near
  // identical entries for the back button to walk through.
  void router.replace({ query: { ...route.query, scope: unit.id } });
}
</script>

<template>
  <PaneShell label="Où appliquer cette action">
    <template #head>
      <div class="pane-title">
        <Icon name="tree" :size="14" />
        <span>Où appliquer cette action</span>
      </div>
      <div class="pane-sub">
        {{ spec.label }} — {{ kinds.map((k) => KIND_FR[k]).join(", ") }}
      </div>
    </template>

    <div v-if="org.loading && !org.loaded" class="tnode-hint">Chargement…</div>

    <div v-else-if="!candidates.length" class="pane-empty">
      <strong>Rien à sélectionner.</strong>
      Cette action s'applique à : {{ kinds.map((k) => KIND_FR[k]).join(", ") }}. Aucune
      n'existe encore dans votre établissement.
      <RouterLink class="btn sm primary" :to="{ name: 'structure' }">Structure</RouterLink>
    </div>

    <Explorer
      v-else
      :units="org.units"
      :selected="selected"
      :pick-kinds="kinds"
      @select="pick"
    />
  </PaneShell>
</template>
