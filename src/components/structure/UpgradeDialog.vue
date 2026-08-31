<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import DialogShell from "../ui/DialogShell.vue";
import Alert from "../ui/Alert.vue";

/**
 * "Mettre à niveau" — as a list you read, not a button you trust.
 *
 * It used to apply every installed module and report a total afterwards. The
 * scaffold is idempotent so nothing was ever damaged, but the operator was
 * agreeing to something they could not see: a complex created before the
 * official subjects existed is one click from three missing classes AND two
 * hundred course offerings, and those are very different decisions.
 *
 * So the server computes the plan first — by running the scaffold and rolling
 * it back, which is why the list cannot be wrong about itself — and this shows
 * it, grouped, with everything ticked. Untick what you do not want.
 */
const emit = defineEmits<{ close: []; applied: [report: api.ScaffoldReport] }>();

const busy = useBusyStore();
const loading = ref(true);
const error = ref<string | null>(null);
const items = ref<api.PlanItem[]>([]);
const modules = ref<api.BlueprintModule[]>([]);
const chosen = ref<Set<string>>(new Set());
const working = ref(false);

const KIND_FR: Record<api.PlanItem["kind"], string> = {
  UNIT: "Unités",
  SUBJECT: "Matières",
  OFFERING: "Programmations",
  SERIE: "Séries",
  PERIOD: "Périodes",
  FISCAL_YEAR: "Comptabilité",
};

/** Grouped by what the row IS: a director decides by category, not by row. */
const groups = computed(() => {
  const order: api.PlanItem["kind"][] = [
    "UNIT", "SUBJECT", "OFFERING", "SERIE", "PERIOD", "FISCAL_YEAR",
  ];
  return order
    .map((kind) => ({ kind, label: KIND_FR[kind], rows: items.value.filter((i) => i.kind === kind) }))
    .filter((g) => g.rows.length > 0);
});

const allChosen = computed(() => chosen.value.size === items.value.length && items.value.length > 0);

onMounted(async () => {
  try {
    const plan = await api.orgUnits.planScaffold();
    items.value = plan.items;
    modules.value = plan.modules;
    // Everything ticked: the common case is "yes, all of it", and a dialog that
    // opens with nothing selected makes the common case the most work.
    chosen.value = new Set(plan.items.map((i) => i.key));
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Analyse impossible.";
  } finally {
    loading.value = false;
  }
});

function toggle(key: string) {
  const next = new Set(chosen.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  chosen.value = next;
}

function toggleGroup(kind: api.PlanItem["kind"]) {
  const rows = items.value.filter((i) => i.kind === kind).map((i) => i.key);
  const next = new Set(chosen.value);
  const allOn = rows.every((k) => next.has(k));
  for (const k of rows) {
    if (allOn) next.delete(k);
    else next.add(k);
  }
  chosen.value = next;
}

function toggleAll() {
  chosen.value = allChosen.value ? new Set() : new Set(items.value.map((i) => i.key));
}

async function apply() {
  if (!chosen.value.size) return;
  working.value = true;
  error.value = null;
  try {
    const report = await busy.run(
      () => api.orgUnits.scaffold(modules.value, [...chosen.value]),
      {
        title: "Mise à niveau",
        detail: `${chosen.value.size} élément(s). Ne fermez pas cette page.`,
      },
    );
    emit("applied", report);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Mise à niveau impossible.";
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <DialogShell
    title="Mettre à niveau"
    detail="Ce qui manque par rapport à la structure officielle des cycles installés. Rien n'est remplacé."
    icon="check"
    wide
    @close="emit('close')"
  >
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="stack">
      <div class="skeleton" style="width: 45%" /><div class="skeleton" style="width: 70%" />
    </div>

    <div v-else-if="!items.length" class="empty">
      <div class="empty-title">Rien à ajouter</div>
      <div>
        L'établissement est déjà conforme à la structure officielle des cycles
        qu'il a installés.
      </div>
    </div>

    <template v-else>
      <div class="plan-head">
        <label class="toggle">
          <input type="checkbox" :checked="allChosen" @change="toggleAll" />
          Tout sélectionner
        </label>
        <span class="hint">{{ chosen.size }} / {{ items.length }} sélectionné(s)</span>
      </div>

      <div class="plan-list">
        <div v-for="g in groups" :key="g.kind" class="plan-group">
          <button class="plan-group-head" type="button" @click="toggleGroup(g.kind)">
            <span>{{ g.label }}</span>
            <span class="plan-count">{{ g.rows.length }}</span>
          </button>
          <label v-for="row in g.rows" :key="row.key" class="plan-row">
            <input
              type="checkbox"
              :checked="chosen.has(row.key)"
              @change="toggle(row.key)"
            />
            <span class="plan-label">{{ row.label }}</span>
            <span class="plan-detail">{{ row.detail }}</span>
          </label>
        </div>
      </div>
    </template>

    <div class="form-actions dialog-actions">
      <button class="btn ghost" type="button" @click="emit('close')">Annuler</button>
      <button
        class="btn primary"
        type="button"
        :disabled="!chosen.size || working || loading"
        @click="apply"
      >
        <span v-if="working" class="btn-spin" aria-hidden="true" />
        Ajouter {{ chosen.size }} élément(s)
      </button>
    </div>
  </DialogShell>
</template>
