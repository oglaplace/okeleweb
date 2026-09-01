<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";
import type { ActionField, ActionSpec } from "../../lib/actions";
import { useBusyStore } from "../../stores/busy";
import { useOrgStore } from "../../stores/org";
import { KIND_FR } from "../structure/kinds";
import Alert from "../ui/Alert.vue";

/**
 * The fields of one action, wherever it was triggered from.
 *
 * This is the half of an action that does not care HOW it was reached: the same
 * form serves the full page (reached from the rail, scope picked in the left
 * pane) and the dialog that opens in place over the tree. Splitting it out is
 * what makes "the form pops right there" possible without a second
 * implementation of option loading, validation and error handling that would
 * drift from the first.
 *
 * The scope is a prop, never a question asked here — by the time these fields
 * render, WHERE has already been answered.
 */
const props = defineProps<{
  spec: ActionSpec;
  scopeId: string | null;
  /** Values the caller already knows — see ActionDialog.prefill. */
  prefill?: Record<string, string>;
}>();
const emit = defineEmits<{ done: [] }>();

const busy = useBusyStore();
const org = useOrgStore();

const values = ref<Record<string, string>>({});
const options = ref<Record<string, { value: string; label: string }[]>>({});
/**
 * The selects are still being filled.
 *
 * "Ajouter un devoir" opens with four dropdowns whose contents come from three
 * chained requests — the years, then the périodes of this classe's cycle, then
 * the offerings of its niveau — and on a Brazzaville connection that is a
 * second or more. Until now the form simply rendered empty: identical to
 * "there are no périodes", which is a real and very different state. An
 * operator who reads it that way goes off to create one that already exists.
 */
const loadingOptions = ref(false);
const working = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

/** Fields whose options depend on the chosen scope must reload when it moves. */
const SCOPE_BOUND = new Set(["periodsOfScope", "offeringsOfScope", "assessmentTypes"]);

function resetDefaults() {
  const next: Record<string, string> = {};
  for (const f of props.spec.fields ?? []) {
    if (f.default !== undefined) next[f.key] = String(f.default);
  }
  // Prefill wins over the declared default: the caller knows where the operator
  // is standing, and the registry only knows what is usually true.
  values.value = { ...next, ...(props.prefill ?? {}) };
}

/**
 * Resolves every select's options. Sources are named, not URLs, so a field
 * declares intent and this decides how to satisfy it.
 */
async function loadOptions() {
  const out: Record<string, { value: string; label: string }[]> = {};
  loadingOptions.value = true;
  try {
    await resolveOptions(out);
  } finally {
    loadingOptions.value = false;
  }
  options.value = { ...options.value, ...out };
}

async function resolveOptions(out: Record<string, { value: string; label: string }[]>) {

  for (const f of props.spec.fields ?? []) {
    if (!f.source) continue;
    try {
      if (f.source === "years") {
        const rows = await api.academics.years();
        out[f.key] = rows.map((r) => ({ value: r.id, label: r.label }));
        // Default to the current year — it is right nine times in ten.
        const current = rows.find((r) => r.isCurrent);
        if (current && !values.value[f.key]) values.value[f.key] = current.id;
      } else if (f.source === "subjects") {
        out[f.key] = (await api.academics.subjects()).map((r) => ({
          value: r.id, label: `${r.code} — ${r.name}`,
        }));
      } else if (f.source === "assessmentTypes") {
        /*
         * The types usable WHERE this action is being run.
         *
         * The list was complex-wide, so a teacher creating an évaluation in the
         * primaire chose from the lycée's kinds as well as their own. Passing
         * the scope narrows it to the complex's shared types plus this branch's;
         * with no scope it stays the whole catalogue, which is what a settings
         * screen wants.
         */
        out[f.key] = (await api.academics.assessmentTypes(props.scopeId)).map((r) => ({
          value: r.id, label: r.name,
        }));
      } else if (f.source === "feeTypes") {
        out[f.key] = (await api.finance.feeTypes()).map((r) => ({
          value: r.id, label: r.name,
        }));
      } else if (f.source === "series") {
        // No list endpoint; the tree carries none either. Left empty rather
        // than faked — the field is optional wherever it appears.
        out[f.key] = [];
      } else if (f.source === "periodsOfScope") {
        const year = values.value.academicYearId;
        if (!props.scopeId || !year) { out[f.key] = []; continue; }
        // Périodes hang off a SCHOOL, so a classe has to walk up to find them.
        // The walk is over the tree the console already holds.
        for (const unit of [...org.ancestors(props.scopeId)].reverse()) {
          const rows = await api.academics.periods(unit.id, year).catch(() => []);
          if (rows.length) {
            out[f.key] = rows.map((r) => ({ value: r.id, label: r.label }));
            break;
          }
        }
        out[f.key] ??= [];
      } else if (f.source === "offeringsOfScope") {
        const year = values.value.academicYearId;
        if (!props.scopeId || !year) { out[f.key] = []; continue; }
        // Offerings hang off the NIVEAU above the classe.
        const niveau = [...org.ancestors(props.scopeId)].reverse().find((u) => u.kind === "NIVEAU");
        out[f.key] = niveau
          ? (await api.academics.offerings(niveau.id, year).catch(() => [])).map((r) => ({
              value: r.id, label: `${r.subject.code} — ${r.subject.name}`,
            }))
          : [];
      }
    } catch {
      out[f.key] = [];
    }
  }
}

/**
 * Why a select is empty, when it is.
 *
 * An empty dropdown and a dropdown that failed to load look identical, and
 * both look like "there are none" — which sends an operator off to create a
 * période that already exists. Every scope-bound source can legitimately come
 * back empty, so each one gets a sentence rather than a blank.
 */
const EMPTY_REASON: Record<string, string> = {
  years: "Aucune année scolaire ouverte.",
  periodsOfScope: "Aucune période définie pour cette année sur ce cycle.",
  offeringsOfScope: "Aucune matière programmée sur ce niveau.",
  assessmentTypes: "Aucun type d'évaluation — créez-en un d'abord.",
  subjects: "Aucune matière au catalogue.",
  feeTypes: "Aucun type de frais.",
};
function emptyReason(f: ActionField): string | null {
  if (loadingOptions.value || !f.source) return null;
  const list = f.options ?? options.value[f.key];
  if (list === undefined || list.length) return null;
  return EMPTY_REASON[f.source] ?? "Aucun choix disponible.";
}

watch(
  () => props.spec.id,
  async () => {
    error.value = null;
    notice.value = null;
    resetDefaults();
    /*
     * Raised BEFORE the tree load, not only around the options.
     *
     * The first version wrapped `loadOptions` alone, and the harness caught it:
     * on a slow connection the form still rendered blank for the whole of
     * `org.load()` — which is the FIRST half of the wait, since the ancestor
     * walks that find this classe's périodes and offerings cannot start until
     * the tree is there. Half an indicator is worse than none: it promises a
     * ready form during the part where it is emptiest.
     */
    loadingOptions.value = true;
    await org.load().catch(() => {});
    await loadOptions();
  },
  { immediate: true },
);

// Reloading only the scope-bound sources keeps a scope change cheap.
watch([() => props.scopeId, () => values.value.academicYearId], () => {
  if ((props.spec.fields ?? []).some((f) => f.source && SCOPE_BOUND.has(f.source))) {
    void loadOptions();
  }
});

const canSubmit = computed(() => {
  if (!props.spec.submit || working.value || loadingOptions.value) return false;
  // `scopeOptional` marks an action whose row CARRIES its scope as a nullable
  // column — pinned to a cycle, or to nothing and therefore to the complex.
  if ((props.spec.scope?.length ?? 0) > 0 && !props.scopeId && !props.spec.scopeOptional) {
    return false;
  }
  return (props.spec.fields ?? []).every(
    (f) => !f.required || (values.value[f.key] ?? "").toString().trim().length > 0,
  );
});

async function submit() {
  if (!canSubmit.value || !props.spec.submit) return;
  working.value = true;
  error.value = null;
  try {
    await busy.run(() => props.spec.submit!(props.scopeId, values.value), {
      title: props.spec.label,
      detail: "Enregistrement en cours. Ne fermez pas cette page.",
    });
    notice.value = `${props.spec.label} — effectué.`;
    resetDefaults();
    await loadOptions();
    emit("done");
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Action impossible.";
  } finally {
    working.value = false;
  }
}

const isCheckbox = (f: ActionField) => f.type === "checkbox";

// ── the units multi-select ──────────────────────────────────────────────────
const unitOptions = (f: ActionField) => org.ofKind(f.kinds ?? []).filter((u) => !u.validTo);
const picked = (key: string) => (values.value[key] ?? "").split(",").filter(Boolean);

function toggleUnit(key: string, id: string) {
  const next = new Set(picked(key));
  if (next.has(id)) next.delete(id);
  else next.add(id);
  values.value = { ...values.value, [key]: [...next].join(",") };
}
defineExpose({ submit, canSubmit });
</script>

<template>
  <form class="action-form" @submit.prevent="submit">
    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="!spec.fields?.length" class="hint">
      Aucun paramètre — cette action s'exécute telle quelle.
    </div>

    <!-- Named, not a bare spinner: it says which fields are waiting, so an
         empty dropdown reads as "not yet" rather than as "none exist". -->
    <div v-else-if="loadingOptions" class="form-loading" role="status">
      <span class="btn-spin" aria-hidden="true" />
      Chargement des choix disponibles…
    </div>

    <div v-if="spec.fields?.length" class="field-row" :class="{ 'is-loading': loadingOptions }">
      <div
        v-for="f in spec.fields"
        :key="f.key"
        class="field"
        :class="{ 'is-wide': f.type === 'units' }"
      >
        <label :for="`f-${spec.id}-${f.key}`">
          {{ f.label }}<span v-if="f.required" aria-hidden="true"> *</span>
        </label>

        <select
          v-if="f.type === 'select'"
          :id="`f-${spec.id}-${f.key}`"
          v-model="values[f.key]"
          :disabled="loadingOptions"
        >
          <option value="">—</option>
          <option
            v-for="o in f.options ?? options[f.key] ?? []"
            :key="o.value"
            :value="o.value"
          >{{ o.label }}</option>
        </select>

        <!--
          A list, not a choice. An academic year covers several cycles, and a
          multi-select is the one shape the declarative form could not express;
          the value stays a comma-joined string so `submit` reads it like any
          other field.
        -->
        <div v-else-if="f.type === 'units'" class="unitpick">
          <label
            v-for="u in unitOptions(f)"
            :key="u.id"
            class="unitpick-row"
            :class="{ 'is-picked': picked(f.key).includes(u.id) }"
          >
            <input
              type="checkbox"
              :checked="picked(f.key).includes(u.id)"
              @change="toggleUnit(f.key, u.id)"
            />
            <span class="unitpick-name">{{ u.name }}</span>
            <span class="unitpick-path">{{ org.pathOf(u.id) || KIND_FR[u.kind] }}</span>
          </label>
          <div v-if="!unitOptions(f).length" class="tnode-hint">
            Aucune unité éligible — installez d'abord la structure.
          </div>
        </div>

        <label v-else-if="isCheckbox(f)" class="toggle">
          <input
            :id="`f-${spec.id}-${f.key}`"
            type="checkbox"
            :checked="values[f.key] === 'true'"
            @change="values[f.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
          />
          Oui
        </label>

        <input
          v-else
          :id="`f-${spec.id}-${f.key}`"
          v-model="values[f.key]"
          :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
          :placeholder="f.hint ?? ''"
          autocomplete="off"
        />

        <!-- Said out loud rather than left as a blank dropdown. -->
        <span v-if="emptyReason(f)" class="hint is-warn">{{ emptyReason(f) }}</span>
        <span v-else-if="f.hint && f.type !== 'text'" class="hint">{{ f.hint }}</span>
      </div>
    </div>

    <div class="form-actions">
      <slot name="cancel" />
      <button class="btn primary" type="submit" :disabled="!canSubmit">
        <span v-if="working" class="btn-spin" aria-hidden="true" />
        {{ working ? "Enregistrement…" : loadingOptions ? "Chargement…" : spec.label }}
      </button>
    </div>
  </form>
</template>
