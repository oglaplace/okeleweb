<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import { ACTIONS, GROUPS, type ActionSpec } from "../../lib/actions";
import Icon from "../ui/Icon.vue";

/**
 * The whole catalogue, grouped — the Cloud-Console shape.
 *
 * Grouped by DOMAIN rather than by department, because a Brazzaville complex
 * does not have one department per group: the same censeur handles the
 * programme and the notes, and the économe handles finances alone. Grouping by
 * what the work IS survives a school that has three staff, and grouping by
 * department does not.
 *
 * Availability comes from `GET /people/capabilities` — the same conditions the
 * endpoints enforce — so an action is never offered when its form could only
 * fail. Blocked and not-yet-built actions are shown with their reason rather
 * than hidden: an empty group teaches nothing.
 */
const caps = ref<api.Capabilities | null>(null);
const open = ref<Set<string>>(new Set(["structure", "scolarite"]));

async function load() {
  try {
    caps.value = await api.people.capabilities();
  } catch {
    caps.value = null;
  }
}
onMounted(load);
defineExpose({ reload: load });

/** Why an action cannot be run yet, or null when it can. */
function blockedReason(a: ActionSpec): string | null {
  if (a.planned) return a.planned;
  const c = caps.value;
  if (!c) return null;

  if (a.id === "enroll" && !c.can.enrollStudent) {
    return c.academicYear ? "Créez d'abord une classe" : "Ouvrez d'abord une année scolaire";
  }
  if (a.id === "import-students" && !c.can.importStudents) return "Créez d'abord une classe";
  if (a.id === "add-staff" && !c.can.addStaff) return "Installez d'abord la structure";
  if (a.id === "import-staff" && !c.can.importStaff) return "Installez d'abord la structure";
  // Every scoped action needs at least one unit of a kind it targets.
  if (a.scope?.length && c.units === 0) return "Installez d'abord la structure";
  if (a.scope?.includes("CLASSE") && c.classes === 0) return "Créez d'abord une classe";
  if (a.scope?.includes("NIVEAU") && c.niveaux === 0) return "Installez d'abord la structure";
  return null;
}

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    actions: ACTIONS.filter((a) => a.group === g.id).map((a) => ({
      spec: a,
      blocked: blockedReason(a),
      to: a.route
        ? { name: a.route }
        : { name: "action", params: { id: a.id } },
    })),
  })),
);

function toggle(id: string) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}
</script>

<template>
  <div class="rail">
    <div v-for="g in groups" :key="g.id" class="rail-group">
      <button class="rail-head" type="button" :aria-expanded="open.has(g.id)" @click="toggle(g.id)">
        <Icon :name="g.icon" :size="14" class="rail-head-icon" />
        <span class="rail-head-label">{{ g.label }}</span>
        <Icon :name="open.has(g.id) ? 'chevronDown' : 'chevronRight'" :size="13" />
      </button>

      <div v-if="open.has(g.id)" class="rail-items">
        <component
          :is="a.blocked ? 'span' : RouterLink"
          v-for="a in g.actions"
          :key="a.spec.id"
          class="rail-item"
          :class="{ 'is-blocked': a.blocked }"
          :to="a.blocked ? undefined : a.to"
          :title="a.blocked ?? a.spec.summary"
        >
          <Icon :name="a.spec.icon" :size="14" class="rail-item-icon" />
          <span class="rail-item-text">
            <span>{{ a.spec.label }}</span>
            <span v-if="a.blocked" class="rail-why">{{ a.blocked }}</span>
          </span>
        </component>
      </div>
    </div>
  </div>
</template>
