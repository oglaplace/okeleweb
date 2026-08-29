<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import { byId, type ActionField, type ActionSpec } from "../../lib/actions";
import { useBusyStore } from "../../stores/busy";
import ScopePicker from "../../components/structure/ScopePicker.vue";
import Icon from "../../components/ui/Icon.vue";

/**
 * One screen for every declarative action.
 *
 * The pattern, made real: pick the OrgUnit the action applies to, then fill the
 * fields it declared. Thirty hand-written pages would have drifted from each
 * other within a month; here, adding an action is a data change in
 * lib/actions.ts and the scope step, the option loading, the validation, the
 * busy overlay and the error handling come for free.
 */
const route = useRoute();
const router = useRouter();
const busy = useBusyStore();

const spec = computed<ActionSpec | undefined>(() => byId(route.params.id as string));

const scopeId = ref<string | null>(null);
const values = ref<Record<string, string>>({});
const options = ref<Record<string, { value: string; label: string }[]>>({});
const working = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

/** Fields whose options depend on the chosen scope must reload when it moves. */
const SCOPE_BOUND = new Set(["periodsOfScope", "offeringsOfScope"]);

function resetDefaults() {
  const next: Record<string, string> = {};
  for (const f of spec.value?.fields ?? []) {
    if (f.default !== undefined) next[f.key] = String(f.default);
  }
  values.value = next;
}

/** Resolves every select's options. Sources are named, not URLs, so a field
 *  declares intent and this decides how to satisfy it. */
async function loadOptions() {
  const fields = spec.value?.fields ?? [];
  const out: Record<string, { value: string; label: string }[]> = {};

  for (const f of fields) {
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
        if (!scopeId.value || !year) { out[f.key] = []; continue; }
        // Périodes hang off a SCHOOL, so a classe has to walk up to find them.
        const chain = await api.orgUnits.ancestors(scopeId.value);
        for (const unit of [...chain].reverse()) {
          const rows = await api.academics.periods(unit.id, year).catch(() => []);
          if (rows.length) {
            out[f.key] = rows.map((r) => ({ value: r.id, label: r.label }));
            break;
          }
        }
        out[f.key] ??= [];
      } else if (f.source === "offeringsOfScope") {
        const year = values.value.academicYearId;
        if (!scopeId.value || !year) { out[f.key] = []; continue; }
        // Offerings hang off the NIVEAU above the classe.
        const chain = await api.orgUnits.ancestors(scopeId.value);
        const niveau = [...chain].reverse().find((u) => u.kind === "NIVEAU");
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
  spec,
  () => {
    scopeId.value = null;
    error.value = null;
    notice.value = null;
    resetDefaults();
    void loadOptions();
  },
  { immediate: true },
);

// Reloading only the scope-bound sources keeps a scope change cheap.
watch([scopeId, () => values.value.academicYearId], () => {
  if ((spec.value?.fields ?? []).some((f) => f.source && SCOPE_BOUND.has(f.source))) {
    void loadOptions();
  }
});

onMounted(() => {
  // An action with a screen of its own never renders this page.
  if (spec.value?.route) void router.replace({ name: spec.value.route });
});

const needsScope = computed(() => (spec.value?.scope?.length ?? 0) > 0);
const scopeSatisfied = computed(() => !needsScope.value || scopeId.value !== null);

const canSubmit = computed(() => {
  if (!spec.value?.submit || working.value || !scopeSatisfied.value) return false;
  return (spec.value.fields ?? []).every(
    (f) => !f.required || (values.value[f.key] ?? "").toString().trim().length > 0,
  );
});

async function submit() {
  if (!canSubmit.value || !spec.value?.submit) return;
  working.value = true;
  error.value = null;
  try {
    await busy.run(() => spec.value!.submit!(scopeId.value, values.value), {
      title: spec.value.label,
      detail: "Enregistrement en cours. Ne fermez pas cette page.",
    });
    notice.value = `${spec.value.label} — effectué.`;
    resetDefaults();
    await loadOptions();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Action impossible.";
  } finally {
    working.value = false;
  }
}

const isCheckbox = (f: ActionField) => f.type === "checkbox";
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

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <!-- Declared, not built. Said plainly rather than shown as a broken form. -->
    <div v-if="spec.planned" class="card">
      <div class="card-body">
        <strong>Pas encore disponible.</strong>
        <p style="margin: var(--s1) 0 0; color: var(--ink-2)">{{ spec.planned }}</p>
      </div>
    </div>

    <template v-else>
      <div v-if="needsScope" class="card" style="margin-bottom: var(--s4)">
        <div class="card-head">1 · Où appliquer cette action</div>
        <div class="card-body">
          <ScopePicker v-model="scopeId" :kinds="spec.scope ?? []" />
        </div>
      </div>

      <form class="card" @submit.prevent="submit">
        <div class="card-head">
          {{ needsScope ? "2 · " : "" }}Détails
        </div>
        <div class="card-body">
          <div v-if="needsScope && !scopeId" class="hint">
            Choisissez d'abord l'unité concernée ci-dessus.
          </div>

          <template v-else>
            <div v-if="!spec.fields?.length" class="hint">
              Aucun paramètre — cette action s'exécute telle quelle.
            </div>
            <div v-else class="field-row">
              <div v-for="f in spec.fields" :key="f.key" class="field">
                <label :for="`f-${f.key}`">
                  {{ f.label }}<span v-if="f.required" aria-hidden="true"> *</span>
                </label>

                <select
                  v-if="f.type === 'select'"
                  :id="`f-${f.key}`"
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
                    :id="`f-${f.key}`"
                    type="checkbox"
                    :checked="values[f.key] === 'true'"
                    @change="values[f.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
                  />
                  Oui
                </label>

                <input
                  v-else
                  :id="`f-${f.key}`"
                  v-model="values[f.key]"
                  :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
                  :placeholder="f.hint ?? ''"
                  autocomplete="off"
                />

                <span v-if="f.hint && f.type !== 'text'" class="hint">{{ f.hint }}</span>
              </div>
            </div>
          </template>
        </div>

        <div class="card-foot">
          <button class="btn primary" type="submit" :disabled="!canSubmit">
            <span v-if="working" class="btn-spin" aria-hidden="true" />
            {{ working ? "Enregistrement…" : spec.label }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>
