<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import type { ActionSpec } from "../../lib/actions";
import { useOrgStore } from "../../stores/org";
import Explorer from "../structure/Explorer.vue";
import ActionDialog from "../actions/ActionDialog.vue";
import NodeMenuDialogs from "./NodeMenuDialogs.vue";
import PaneShell from "./PaneShell.vue";

/**
 * The organisation tree, as its own column between the rail and the content.
 *
 * It was inside the Structure page, which meant it existed only there — and the
 * tree is the thing you navigate BY, not a screen you visit. Here it is present
 * for every action: pick a classe on the left, act on it on the right.
 *
 * The dialogs are owned HERE rather than by the rows, because the tree is a
 * pure renderer: a modal attached to a node that the next reload removes would
 * be left pointing at nothing.
 */
const props = defineProps<{ selected: string | null }>();
const emit = defineEmits<{ select: [api.TreeUnit] }>();

const router = useRouter();
const org = useOrgStore();

onMounted(() => void org.load());
defineExpose({ reload: () => org.load(true) });

/** The node the ⋯ menu is acting on, and which structural operation. */
const menuUnit = ref<api.TreeUnit | null>(null);
const menuAction = ref<"add" | "rename" | "close" | "reopen" | null>(null);

/** A registry action chosen on a row — the form opens over the tree. */
const runUnit = ref<api.TreeUnit | null>(null);
const runSpec = ref<ActionSpec | null>(null);

function onMenu(payload: { unit: api.TreeUnit; action: string }) {
  // "Ouvrir" never arrives here: the tree treats it as a selection, so it
  // clears a running search the same way clicking the row does.
  menuUnit.value = payload.unit;
  menuAction.value = payload.action as "add" | "rename" | "close" | "reopen";
}

function onRun(payload: { unit: api.TreeUnit; spec: ActionSpec }) {
  runUnit.value = payload.unit;
  runSpec.value = payload.spec;
}

async function onDialogDone(changed: boolean) {
  menuUnit.value = null;
  menuAction.value = null;
  if (changed) await org.load(true);
}

function pick(unit: api.TreeUnit) {
  emit("select", unit);
  // EVERY node opens its own view, leaf or not. Selecting without navigating
  // was the old behaviour and it meant a classe told you nothing until you
  // found a second control to open it with.
  void router.push({ name: "unit", params: { id: unit.id } });
}
</script>

<template>
  <PaneShell label="Organisation">
    <div v-if="org.loading && !org.loaded" class="tnode-hint">Chargement…</div>
    <Explorer
      v-else
      :units="org.units"
      :selected="props.selected"
      @select="pick"
      @menu="onMenu"
      @run="onRun"
    />

    <NodeMenuDialogs :unit="menuUnit" :action="menuAction" @done="onDialogDone" />

    <ActionDialog
      v-if="runSpec && runUnit"
      :spec="runSpec"
      :unit="runUnit"
      @close="((runSpec = null), (runUnit = null))"
      @done="org.load(true)"
    />
  </PaneShell>
</template>
