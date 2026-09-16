<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import { allowed, byId } from "../../lib/actions";
import { useAuthStore } from "../../stores/auth";
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

/**
 * CE QUI EST À MOI DE FAIRE — et j'avais tranché l'inverse.
 *
 * La liste montrait TOUTES les constatations à tout le monde, en n'enlevant
 * que le bouton « Corriger », au motif qu'une école à qui il manque ses
 * coefficients en manque pour tout le monde: chacun saurait pourquoi les
 * bulletins sont bloqués et à qui le dire.
 *
 * En usage c'est faux dans l'autre sens. L'enseignant de 6e A ouvre une pastille
 * qui annonce « action requise », y lit huit lignes dont aucune ne le concerne
 * et dont aucune ne lui est ouverte, et cesse de l'ouvrir. Une boîte de
 * réception qu'on n'ouvre plus ne prévient plus de rien — y compris le jour où
 * elle porte enfin quelque chose pour vous.
 *
 * Donc: ce que je peux faire. `allowed()` lit les permissions que l'action
 * exige, c'est-à-dire la même règle que le rail d'actions et que l'API —
 * une constatation sans action rattachée reste visible pour ceux qui
 * administrent, puisqu'eux seuls peuvent y répondre par autre chose qu'un lien.
 */
const mine = computed(() => {
  const all = state.value?.findings ?? [];
  if (auth.isComplexAdmin) return all;
  return all.filter((f) => mayFix(f.action));
});

const count = computed(() => mine.value.length);
const blocking = computed(
  () => mine.value.filter((f) => f.severity === "BLOCKING").length,
);

/** Ce qui reste chez les autres: dit une fois, sans le détailler. */
const elsewhere = computed(
  () => (state.value?.findings.length ?? 0) - count.value,
);

/** Where a finding's action lives — a screen of its own, or the generic form. */
function actionTo(actionId: string) {
  const spec = byId(actionId);
  if (!spec) return { name: "dashboard" };
  return spec.route ? { name: spec.route } : { name: "action", params: { id: actionId } };
}

/**
 * "Corriger" only if you actually can.
 *
 * Readiness is complex-wide — the same findings reach everybody, because a
 * school missing its coefficients is missing them for all of us. But the fix
 * is not everybody's: sending a comptable to "définir un coefficient" is a
 * link to a screen the rail deliberately hid from them, and the door they
 * arrive at is locked. The finding still shows, so they know why the bulletins
 * are stuck and whom to tell; only the button goes.
 */
const auth = useAuthStore();
function mayFix(actionId: string | null | undefined): boolean {
  if (!actionId) return false;
  const spec = byId(actionId);
  return Boolean(spec && allowed(spec, auth.canAny));
}

const STATUS_FR: Record<api.Readiness["status"], string> = {
  READY: "Prêt",
  DEGRADED: "Opérationnel",
  BLOCKED: "Action requise",
};

/*
 * Le titre parle de MA liste.
 *
 * `state.status` décrit l'établissement entier: annoncer « action requise » à
 * quelqu'un dont la liste est vide l'envoie chercher ce qu'il n'a pas.
 */
const headline = computed(() => {
  if (!state.value) return "Évaluation…";
  if (!count.value) return "Rien à faire de votre côté";
  return blocking.value > 0 ? STATUS_FR.BLOCKED : STATUS_FR.DEGRADED;
});
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
        <span class="inbox-title">{{ state ? headline : "Évaluation…" }}</span>
        <button class="hints-x" type="button" aria-label="Fermer" @click="open = false">×</button>
      </div>

      <div v-if="!state" class="inbox-empty">Évaluation de l'établissement…</div>

      <div v-else-if="!count" class="inbox-empty">
        <strong v-if="!state.findings.length">Tout est en place.</strong>
        <strong v-else>Rien qui vous revienne.</strong>
        <p style="margin: 4px 0 0">
          <template v-if="!state.findings.length">
            Structure, année, périodes, matières et coefficients : rien ne bloque.
          </template>
          <template v-else>
            {{ elsewhere }} point(s) restent à régler par l'administration de
            l'établissement.
          </template>
        </p>
      </div>

      <ul v-else class="inbox-list">
        <li
          v-for="f in mine"
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
            v-if="f.action && mayFix(f.action)"
            class="inbox-item-go"
            :to="actionTo(f.action)"
            @click="open = false"
          >
            {{ byId(f.action)?.label ?? "Corriger" }} <Icon name="chevronRight" :size="12" />
          </RouterLink>
        </li>
      </ul>

      <!-- Dit, mais pas détaillé: savoir qu'il reste du travail ailleurs évite
           de croire l'école prête; le lire ligne à ligne ne sert personne. -->
      <div v-if="count && elsewhere > 0" class="inbox-foot">
        {{ elsewhere }} autre(s) point(s) relèvent de l'administration.
      </div>
    </div>
  </div>
</template>
