<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { trailFor } from "../../lib/trail";
import { useNavStore } from "../../stores/nav";
import { useOrgStore } from "../../stores/org";
import Icon from "../ui/Icon.vue";

/**
 * The one trail in the console, and the way back out.
 *
 * Complete by construction: the action that got you here, then the structure
 * from the root down to the unit the action is aimed at — see lib/trail.ts.
 * Every segment is a link, so the trail is not only a label but the fastest
 * route up.
 *
 * The back control sits with it rather than in the page, because "where am I"
 * and "how do I leave" are the same question asked twice.
 */
const route = useRoute();
const router = useRouter();
const nav = useNavStore();
const org = useOrgStore();

// The ancestry comes from the shared tree; until it lands the trail is just
// its action segment, which is correct — merely shorter.
onMounted(() => void org.load());

const trail = computed(() => trailFor(route, { ancestors: (id) => org.ancestors(id) }));

/**
 * One level up, for when there is no history to go back through.
 *
 * The nearest crumb that is actually a destination, not simply the one before:
 * a group heading ("Programme") names a section of the rail and is not a page,
 * so stopping at it would leave the control pointing at nothing. Worst case
 * this walks all the way to the house, which is always somewhere.
 */
const parent = computed(() => {
  for (let i = trail.value.length - 2; i >= 0; i--) {
    if (trail.value[i]?.to) return trail.value[i]!.to!;
  }
  return null;
});

const canBack = computed(() => nav.canGoBack || parent.value !== null);

const backTitle = computed(() => {
  if (nav.canGoBack) return "Retour";
  for (let i = trail.value.length - 2; i >= 0; i--) {
    if (trail.value[i]?.to) return `Remonter vers ${trail.value[i]!.label}`;
  }
  return "Retour au tableau de bord";
});

function back() {
  if (nav.canGoBack) {
    router.back();
    return;
  }
  // Deep link, or the first screen of the session: there is nothing behind us,
  // so "back" means one level up the trail we are showing.
  void router.push(parent.value ?? { name: "dashboard" });
}
</script>

<template>
  <div class="crumbbar">
    <button
      v-if="canBack"
      class="crumb-back"
      type="button"
      :title="backTitle"
      :aria-label="backTitle"
      @click="back"
    >
      <Icon name="arrowLeft" :size="15" />
    </button>

    <nav class="crumbs" aria-label="Fil d'Ariane">
      <template v-for="(part, i) in trail" :key="i">
        <span v-if="i > 0" class="crumbs-sep" aria-hidden="true">›</span>

        <RouterLink
          v-if="part.to && i < trail.length - 1"
          class="crumbs-link"
          :class="{ 'is-home': part.home }"
          :to="part.to"
          :title="part.label"
        >
          <Icon v-if="part.home" name="home" :size="16" />
          <span v-else>{{ part.label }}</span>
        </RouterLink>

        <span v-else class="crumbs-here" :class="{ 'is-home': part.home }">
          <Icon v-if="part.home" name="home" :size="16" />
          <template v-else>{{ part.label }}</template>
        </span>
      </template>
    </nav>
  </div>
</template>
