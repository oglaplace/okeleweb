<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import { byId } from "../../lib/actions";
import Icon from "../ui/Icon.vue";

/**
 * What is stopping this établissement from running.
 *
 * Evaluated on sign-in and on every navigation, and shown as a count in the
 * topbar — because the alternative is what this replaces: a director discovers
 * that no coefficient is set in the week the bulletins are due, when the
 * grading engine refuses and there is no time left to fix it.
 *
 * BLOCKING first, always, and the server sorts them so the rule lives in one
 * place. The distinction is not cosmetic: blocking means an operation the
 * school performs every term cannot complete, warning means it runs and
 * something normal is missing. Mixing them would make the list a wall of
 * complaints nobody reads.
 *
 * Every finding links to the action that fixes it. An inbox that says what is
 * wrong but not where to go is a list of grievances.
 */
const route = useRoute();
const state = ref<api.Readiness | null>(null);
const open = ref(false);

async function load() {
  try {
    state.value = await api.readiness();
  } catch {
    state.value = null;
  }
}
onMounted(load);
watch(() => route.fullPath, load);

const count = computed(() => state.value?.findings.length ?? 0);
const blocking = computed(() => state.value?.blocking ?? 0);

/** Where a finding's action lives — a screen of its own, or the generic form. */
function actionTo(actionId: string) {
  const spec = byId(actionId);
  if (!spec) return { name: "dashboard" };
  return spec.route ? { name: spec.route } : { name: "action", params: { id: actionId } };
}

const STATUS_FR: Record<api.Readiness["status"], string> = {
  READY: "Prêt",
  DEGRADED: "Opérationnel",
  BLOCKED: "Action requise",
};
</script>

<template>
  <div class="inbox-wrap">
    <button
      class="btn ghost icon inbox-trigger"
      type="button"
      :aria-expanded="open"
      :aria-label="`Boîte de réception — ${count} élément(s)`"
      :title="state ? STATUS_FR[state.status] : 'Boîte de réception'"
      @click="open = !open"
    >
      <Icon name="bulb" :size="16" />
      <span
        v-if="count"
        class="inbox-badge"
        :class="{ 'is-blocking': blocking > 0 }"
      >{{ count }}</span>
    </button>

    <!-- Click-away scrim: a popover you can only close with the same button is
         a popover people leave open. -->
    <div v-if="open" class="inbox-scrim" @click="open = false" />

    <div v-if="open" class="inbox" role="dialog" aria-label="État de l'établissement">
      <div class="inbox-head">
        <span
          class="inbox-dot"
          :class="{
            'is-blocked': state?.status === 'BLOCKED',
            'is-degraded': state?.status === 'DEGRADED',
          }"
          aria-hidden="true"
        />
        <span class="inbox-title">{{ state ? STATUS_FR[state.status] : "Évaluation…" }}</span>
        <button class="hints-x" type="button" aria-label="Fermer" @click="open = false">×</button>
      </div>

      <div v-if="!state" class="inbox-empty">Évaluation de l'établissement…</div>

      <div v-else-if="!state.findings.length" class="inbox-empty">
        <strong>Tout est en place.</strong>
        <p style="margin: 4px 0 0">
          Structure, année, périodes, matières et coefficients : rien ne bloque.
        </p>
      </div>

      <ul v-else class="inbox-list">
        <li
          v-for="f in state.findings"
          :key="f.id"
          class="inbox-item"
          :class="{ 'is-blocking': f.severity === 'BLOCKING' }"
        >
          <div class="inbox-item-head">
            <span class="pill" :class="f.severity === 'BLOCKING' ? 'danger' : 'warn'">
              {{ f.severity === "BLOCKING" ? "Action requise" : "Avertissement" }}
            </span>
            <span class="inbox-item-title">{{ f.title }}</span>
          </div>
          <p class="inbox-item-detail">{{ f.detail }}</p>
          <RouterLink
            v-if="f.action"
            class="inbox-item-go"
            :to="actionTo(f.action)"
            @click="open = false"
          >
            {{ byId(f.action)?.label ?? "Corriger" }} <Icon name="chevronRight" :size="12" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
