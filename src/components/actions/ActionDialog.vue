<script setup lang="ts">
import { computed } from "vue";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../structure/kinds";
import ActionForm from "./ActionForm.vue";
import DialogShell from "../ui/DialogShell.vue";

/**
 * An action, run where it was triggered.
 *
 * This exists because of a specific complaint that was entirely fair:
 * "programmer une matière" on a niveau used to LEAVE the tree, open a page, and
 * ask which niveau — the one thing the operator had just told it by clicking.
 * Answering a question you have already been told the answer to is how a tool
 * teaches people that clicking carefully does not matter.
 *
 * So: triggered on a node, the form opens over that node with the scope fixed
 * and the node named in the title. Triggered from the rail, where nothing is
 * selected, the full page asks — see pages/console/ActionPage.vue.
 */
const props = defineProps<{
  spec: ActionSpec;
  unit: api.OrgUnit | api.TreeUnit;
  /**
   * Field values the caller already knows.
   *
   * The point of opening a form from a cell: the niveau, the year and the
   * subject are all answered by WHERE the operator clicked, so asking for them
   * again would be asking them to retype what they just pointed at.
   */
  prefill?: Record<string, string>;
}>();
const emit = defineEmits<{ close: []; done: [] }>();

const subtitle = computed(() => `${KIND_FR[props.unit.kind]} · ${props.unit.name}`);

function onDone() {
  emit("done");
  emit("close");
}
</script>

<template>
  <DialogShell
    :title="spec.label"
    :subtitle="subtitle"
    :detail="spec.summary"
    :icon="spec.icon"
    @close="emit('close')"
  >
    <div v-if="spec.planned" class="hint">
      <strong>Pas encore disponible.</strong> {{ spec.planned }}
    </div>

    <ActionForm v-else :spec="spec" :scope-id="unit.id" :prefill="prefill" @done="onDone">
      <template #cancel>
        <button class="btn ghost" type="button" @click="emit('close')">Annuler</button>
      </template>
    </ActionForm>
  </DialogShell>
</template>
