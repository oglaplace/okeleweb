<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import Icon from "../ui/Icon.vue";

/**
 * "Bon à savoir", bottom-right.
 *
 * These used to sit inside the page as cards, among the controls — which made
 * them look like things you could act on, and they are not: they are the state
 * of the établissement, phrased as advice. Moved out of the working area
 * entirely and into a corner that can be dismissed, so the main column carries
 * only what the operator clicks.
 */
const caps = ref<api.Capabilities | null>(null);
const dismissed = ref(false);

onMounted(async () => {
  try {
    caps.value = await api.people.capabilities();
  } catch {
    caps.value = null;
  }
});

const hints = computed(() => {
  const c = caps.value;
  if (!c) return [];
  const out: string[] = [];
  if (!c.academicYear) {
    out.push("Aucune année scolaire en cours — rien ne peut y être rattaché.");
  }
  if (c.units === 0) {
    out.push("La structure est vide. Installez les cycles que vous ouvrez.");
  } else if (c.classes === 0) {
    out.push(
      `${c.niveaux} niveaux en place, aucune classe. Un élève s'inscrit dans une classe, pas dans un niveau.`,
    );
  }
  if (c.classes > 0 && c.staff === 0) {
    out.push("Aucun personnel enregistré. Les notes sont saisies par une personne affectée.");
  }
  if (c.classes > 0 && c.series === 0) {
    out.push("Aucune série. Les coefficients d'une 1ère C et d'une 1ère A ne diffèrent pas encore.");
  }
  return out;
});
</script>

<template>
  <aside v-if="hints.length && !dismissed" class="hints" aria-label="Bon à savoir">
    <div class="hints-head">
      <Icon name="bulb" :size="14" />
      <span>Bon à savoir</span>
      <button class="hints-x" type="button" aria-label="Masquer" @click="dismissed = true">×</button>
    </div>
    <ul class="hints-list">
      <li v-for="h in hints" :key="h">{{ h }}</li>
    </ul>
  </aside>
</template>
