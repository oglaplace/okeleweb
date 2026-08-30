<script setup lang="ts">
import { computed } from "vue";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { KIND_FR } from "../structure/kinds";
import ActionForm from "./ActionForm.vue";
import Icon from "../ui/Icon.vue";

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
const props = defineProps<{ spec: ActionSpec; unit: api.OrgUnit | api.TreeUnit }>();
const emit = defineEmits<{ close: []; done: [] }>();

const subtitle = computed(
  () => `${KIND_FR[props.unit.kind]} · ${props.unit.name}`,
);

function onDone() {
  emit("done");
  emit("close");
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="scrim-card action-dialog">
      <div class="action-dialog-head">
        <div class="action-dialog-title">
          <Icon :name="spec.icon" :size="17" />
          <span>{{ spec.label }}</span>
        </div>
        <button class="btn sm ghost" type="button" @click="emit('close')">Fermer</button>
      </div>

      <!-- The node is stated, not asked: this is what makes it "in place". -->
      <div class="action-dialog-scope">
        <span class="kind-tag">{{ subtitle }}</span>
        <span class="hint">{{ spec.summary }}</span>
      </div>

      <div v-if="spec.planned" class="hint" style="margin-top: var(--s3)">
        <strong>Pas encore disponible.</strong> {{ spec.planned }}
      </div>

      <ActionForm v-else :spec="spec" :scope-id="unit.id" @done="onDone">
        <template #cancel>
          <button class="btn ghost" type="button" @click="emit('close')">Annuler</button>
        </template>
      </ActionForm>
    </div>
  </div>
</template>
