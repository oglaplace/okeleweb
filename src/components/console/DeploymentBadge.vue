<script setup lang="ts">
import { computed } from "vue";
import { useDeploymentStore } from "../../stores/deployment";

const dep = useDeploymentStore();

// State is encoded in the word AND the dot colour — office monitors are often
// washed out, and colour alone would not read.
const cls = computed(() => ({
  "is-offline": dep.unreachable,
  "is-readonly": !dep.unreachable && Boolean(dep.info?.tenant) && !dep.writable,
  "is-edge": !dep.unreachable && dep.mode === "EDGE",
}));

const title = computed(() => {
  if (dep.unreachable) return "Aucune réponse du serveur";
  const where = dep.mode === "EDGE" ? "serveur de l'établissement" : "serveur distant";
  const tier =
    dep.tier === "SOVEREIGN" ? "Autonome" : dep.tier === "RESILIENT" ? "Résilient" : "Connecté";
  return `Formule ${tier} — connecté au ${where}`;
});
</script>

<template>
  <span class="badge" :class="cls" :title="title">
    <span class="badge-dot" aria-hidden="true" />
    {{ dep.badge }}
  </span>
</template>
