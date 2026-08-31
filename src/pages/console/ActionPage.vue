<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { byId, ROUTE_NEEDS_UNIT, type ActionSpec } from "../../lib/actions";
import { useOrgStore } from "../../stores/org";
import { KIND_FR } from "../../components/structure/kinds";
import ActionForm from "../../components/actions/ActionForm.vue";
import ScopePicker from "../../components/structure/ScopePicker.vue";
import Icon from "../../components/ui/Icon.vue";

/**
 * One screen for every declarative action reached from the rail.
 *
 * The pattern, made real: the OrgUnit the action applies to, then the fields it
 * declared. Thirty hand-written pages would have drifted from each other within
 * a month; here, adding an action is a data change in lib/actions.ts and the
 * scope step, the option loading, the validation, the busy overlay and the
 * error handling come for free.
 *
 * WHERE the scope question is asked changed: it is the second column now, not a
 * card stacked above the form — see components/console/ScopePane.vue. This page
 * only reads the answer, out of the URL, so a reload or a shared link lands on
 * the same action pointed at the same unit. The in-page picker below survives
 * for one case only: viewports too narrow for three columns, where the pane is
 * not rendered at all.
 */
const route = useRoute();
const router = useRouter();
const org = useOrgStore();

const spec = computed<ActionSpec | undefined>(() => byId(route.params.id as string));

const scopeId = computed(() => (typeof route.query.scope === "string" ? route.query.scope : null));
const scopeUnit = computed(() => org.byId(scopeId.value));

const needsScope = computed(() => (spec.value?.scope?.length ?? 0) > 0);
const scopeSatisfied = computed(() => !needsScope.value || scopeId.value !== null);

function setScope(id: string | null) {
  void router.replace({ query: id ? { ...route.query, scope: id } : {} });
}

onMounted(() => void org.load());

/**
 * An action with a screen of its own never renders this page — it forwards,
 * CARRYING the scope. Dropping it here was the bug that made "inscrire un
 * élève" on a class land on an empty enrolment form.
 *
 * A screen that IS about one unit waits for that unit first: the pane on the
 * left asks, this forwards as soon as it is answered. Forwarding without it
 * would throw "Missing required param" and take the console down with it.
 */
watch(
  [spec, scopeId],
  ([s, unit]) => {
    if (!s?.route) return;
    if (ROUTE_NEEDS_UNIT.has(s.route)) {
      if (unit) {
        void router.replace({
          name: s.route,
          params: { id: unit },
          ...(s.tab ? { query: { tab: s.tab } } : {}),
        });
      }
      return;
    }
    void router.replace({ name: s.route, ...(unit ? { query: { scope: unit } } : {}) });
  },
  { immediate: true },
);

/** True while we are waiting for the pane to name the unit to forward to. */
const awaitingUnit = computed(
  () => Boolean(spec.value?.route) && ROUTE_NEEDS_UNIT.has(spec.value!.route!) && !scopeId.value,
);
</script>

<template>
  <div v-if="!spec" class="card">
    <div class="empty">
      <div class="empty-title">Action inconnue</div>
      <div class="empty-actions">
        <RouterLink class="btn primary" :to="{ name: 'dashboard' }">Tableau de bord</RouterLink>
      </div>
    </div>
  </div>

  <div v-else>
    <div class="page-head">
      <div>
        <h1 class="page-title">
          <Icon :name="spec.icon" :size="19" /> {{ spec.label }}
        </h1>
        <div class="page-sub">{{ spec.summary }}</div>
      </div>
    </div>

    <!-- Declared, not built. Said plainly rather than shown as a broken form. -->
    <div v-if="spec.planned" class="card">
      <div class="card-body">
        <strong>Pas encore disponible.</strong>
        <p style="margin: var(--s1) 0 0; color: var(--ink-2)">{{ spec.planned }}</p>
      </div>
    </div>

    <template v-else>
      <!-- Below three columns the pane does not exist, so the question has to
           be asked here or it cannot be asked at all. -->
      <div v-if="needsScope" class="card scope-fallback" style="margin-bottom: var(--s4)">
        <div class="card-head">Où appliquer cette action</div>
        <div class="card-body">
          <ScopePicker
            :model-value="scopeId"
            :kinds="spec.scope ?? []"
            @update:model-value="setScope"
          />
        </div>
      </div>

      <div v-if="awaitingUnit" class="card">
        <div class="card-body">
          <div class="empty">
            <div class="empty-title">Quelle classe ?</div>
            <div style="max-width: 52ch; margin: 0 auto">
              Choisissez-la dans l'arborescence<span class="wide-only">, à gauche</span>.
              {{ spec.label }} s'ouvrira directement dessus.
            </div>
          </div>
        </div>
      </div>

      <div v-else class="card">
        <div class="card-head">
          <span>{{ spec.label }}</span>
          <!-- The target, stated where the form is: a submit button whose
               effect depends on a selection made in another column must say
               what that selection currently is. -->
          <span v-if="scopeUnit" class="kind-tag">
            {{ KIND_FR[scopeUnit.kind] }} · {{ scopeUnit.name }}
          </span>
        </div>
        <div class="card-body">
          <div v-if="!scopeSatisfied" class="empty">
            <div class="empty-title">Choisissez l'unité concernée</div>
            <div style="max-width: 52ch; margin: 0 auto">
              Cette action s'applique à :
              {{ (spec.scope ?? []).map((k) => KIND_FR[k]).join(", ") }}. Sélectionnez-la
              dans l'arborescence<span class="wide-only">, à gauche</span><span
                class="narrow-only"
              > ci-dessus</span>.
            </div>
          </div>

          <ActionForm v-else :spec="spec" :scope-id="scopeId" />
        </div>
      </div>
    </template>
  </div>
</template>
