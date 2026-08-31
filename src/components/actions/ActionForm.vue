<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";
import type { ActionField, ActionSpec } from "../../lib/actions";
import { useBusyStore } from "../../stores/busy";
import { useOrgStore } from "../../stores/org";

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
const working = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

/** Fields whose options depend on the chosen scope must reload when it moves. */
const SCOPE_BOUND = new Set(["periodsOfScope", "offeringsOfScope"]);

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
        out[f.key] = (await api.academics.assessmentTypes()).map((r) => ({
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
  options.value = { ...options.value, ...out };
}

watch(
  () => props.spec.id,
  async () => {
    error.value = null;
    notice.value = null;
    resetDefaults();
    // The ancestor walks above are synchronous over the shared tree, which has
    // to be there before the scope-bound sources are resolved.
    await org.load();
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
  if (!props.spec.submit || working.value) return false;
  if ((props.spec.scope?.length ?? 0) > 0 && !props.scopeId) return false;
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
defineExpose({ submit, canSubmit });
</script>

<template>
  <form class="action-form" @submit.prevent="submit">
    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <div v-if="!spec.fields?.length" class="hint">
      Aucun paramètre — cette action s'exécute telle quelle.
    </div>

    <div v-else class="field-row">
      <div v-for="f in spec.fields" :key="f.key" class="field">
        <label :for="`f-${spec.id}-${f.key}`">
          {{ f.label }}<span v-if="f.required" aria-hidden="true"> *</span>
        </label>

        <select
          v-if="f.type === 'select'"
          :id="`f-${spec.id}-${f.key}`"
          v-model="values[f.key]"
        >
          <option value="">—</option>
          <option
            v-for="o in f.options ?? options[f.key] ?? []"
            :key="o.value"
            :value="o.value"
          >{{ o.label }}</option>
        </select>

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

        <span v-if="f.hint && f.type !== 'text'" class="hint">{{ f.hint }}</span>
      </div>
    </div>

    <div class="form-actions">
      <slot name="cancel" />
      <button class="btn primary" type="submit" :disabled="!canSubmit">
        <span v-if="working" class="btn-spin" aria-hidden="true" />
        {{ working ? "Enregistrement…" : spec.label }}
      </button>
    </div>
  </form>
</template>
