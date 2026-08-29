<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { byId, GROUPS } from "../../lib/actions";
import { useAuthStore } from "../../stores/auth";

/**
 * Where you are in the console, always.
 *
 * Derived from the route rather than pushed by each page: a trail that a screen
 * has to remember to set is a trail that is wrong on the screen that forgot.
 * The établissement is always the root, because everything in this console
 * happens inside one.
 */
const route = useRoute();
const auth = useAuthStore();

const trail = computed(() => {
  const parts: { label: string; to?: { name: string } }[] = [
    { label: auth.profile?.complexName ?? "Établissement", to: { name: "dashboard" } },
  ];

  if (route.name === "action") {
    const spec = byId(route.params.id as string);
    if (spec) {
      parts.push({ label: GROUPS.find((g) => g.id === spec.group)?.label ?? "Actions" });
      parts.push({ label: spec.label });
    }
    return parts;
  }

  const NAMED: Record<string, string[]> = {
    dashboard: [],
    structure: ["Établissement", "Structure"],
    unit: ["Établissement", "Structure"],
    enroll: ["Scolarité", "Inscrire un élève"],
    import: ["Scolarité", "Importer"],
    staff: ["Personnel"],
    classe: ["Scolarité", "Classe"],
    marks: ["Notes & bulletins", "Saisie des notes"],
    bulletins: ["Notes & bulletins", "Bulletins"],
  };
  for (const label of NAMED[String(route.name)] ?? []) parts.push({ label });
  return parts;
});
</script>

<template>
  <nav class="crumbs" aria-label="Fil d'Ariane">
    <template v-for="(part, i) in trail" :key="i">
      <span v-if="i > 0" class="crumbs-sep" aria-hidden="true">›</span>
      <RouterLink v-if="part.to && i < trail.length - 1" class="crumbs-link" :to="part.to">
        {{ part.label }}
      </RouterLink>
      <span v-else class="crumbs-here">{{ part.label }}</span>
    </template>
  </nav>
</template>
