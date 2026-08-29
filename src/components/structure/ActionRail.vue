<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";

/**
 * The things a director does, without walking the tree to find them.
 *
 * Every entry is DERIVED from what the complex contains, not listed
 * unconditionally. "Inscrire un élève" is not an action until a classe exists
 * to enrol them into and a year exists to enrol them for; offering it anyway
 * produces a form whose last field is empty and whose submit button always
 * fails, which is worse than not offering it. When an action is unavailable the
 * rail says what is missing and links to the screen that fixes it.
 *
 * The availability rules live on the server (`GET /people/capabilities`) rather
 * than here, because they are the same conditions the endpoints enforce.
 */
const caps = ref<api.Capabilities | null>(null);

async function load() {
  try {
    caps.value = await api.people.capabilities();
  } catch {
    caps.value = null;
  }
}
onMounted(load);
defineExpose({ reload: load });

interface Action {
  label: string;
  to: { name: string };
  ready: boolean;
  /** Why it is unavailable — shown in place of the action. */
  blocked?: string;
}

const actions = computed<Action[]>(() => {
  const c = caps.value;
  if (!c) return [];
  return [
    {
      label: "Inscrire un élève",
      to: { name: "enroll" },
      ready: c.can.enrollStudent,
      blocked: !c.academicYear
        ? "Aucune année scolaire en cours"
        : "Créez d'abord une classe",
    },
    {
      label: "Importer des élèves",
      to: { name: "import" },
      ready: c.can.importStudents,
      blocked: "Créez d'abord une classe",
    },
    {
      label: "Ajouter un personnel",
      to: { name: "staff" },
      ready: c.can.addStaff,
      blocked: "Installez d'abord la structure",
    },
    {
      label: "Affecter un enseignant",
      to: { name: "staff" },
      ready: c.can.assignStaff,
      blocked: "Ajoutez d'abord un personnel",
    },
    {
      label: "Importer du personnel",
      to: { name: "import" },
      ready: c.can.importStaff,
      blocked: "Installez d'abord la structure",
    },
    {
      label: "Créer une classe",
      to: { name: "structure" },
      ready: c.can.createClasse,
      blocked: "Installez d'abord la structure",
    },
  ];
});
</script>

<template>
  <div class="rail">
    <RouterLink
      v-for="a in actions.filter((x) => x.ready)"
      :key="a.label"
      class="rail-item"
      :to="a.to"
    >
      {{ a.label }}
    </RouterLink>

    <!-- Not hidden: a director whose rail is empty needs to know why, and the
         reason is always something they can go and do. -->
    <RouterLink
      v-for="a in actions.filter((x) => !x.ready)"
      :key="`x-${a.label}`"
      class="rail-item is-blocked"
      :to="{ name: 'structure' }"
      :title="a.blocked"
    >
      {{ a.label }}
      <span class="rail-why">{{ a.blocked }}</span>
    </RouterLink>
  </div>
</template>
