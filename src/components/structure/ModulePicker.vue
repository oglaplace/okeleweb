<script setup lang="ts">
import { computed } from "vue";
import type { BlueprintModule } from "../../lib/api";
import {
  MODULE_BASIS, MODULE_LABELS, MODULE_ORDER, MODULE_SUMMARIES,
} from "../../pages/platform/labels";

/**
 * Pick the structure an établissement comes with.
 *
 * Shared by the two places that ask the question, which are the same question
 * asked by different people: a platform operator at registration, and a
 * director staring at an empty console. Duplicating it would let the two drift
 * on the one field that matters — `basis`, which says whether a shape is the
 * ministry's or merely customary.
 */
const props = defineProps<{
  modelValue: BlueprintModule[];
  /** Already present in the tree; ticked, disabled, and labelled as installed. */
  installed?: BlueprintModule[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [BlueprintModule[]] }>();

const installedSet = computed(() => new Set(props.installed ?? []));

function toggle(module: BlueprintModule) {
  if (props.disabled || installedSet.value.has(module)) return;
  const next = props.modelValue.includes(module)
    ? props.modelValue.filter((m) => m !== module)
    : [...props.modelValue, module];
  // Catalogue order, not click order — the API rebuilds it anyway, and a stable
  // list keeps the preview from flickering as boxes are ticked.
  emit(
    "update:modelValue",
    MODULE_ORDER.filter((m) => next.includes(m)),
  );
}

const isOn = (m: BlueprintModule) =>
  props.modelValue.includes(m) || installedSet.value.has(m);
</script>

<template>
  <div class="choices is-tiles">
    <label
      v-for="m in MODULE_ORDER"
      :key="m"
      class="choice"
      :class="{ 'is-selected': isOn(m), 'is-locked': installedSet.has(m) }"
    >
      <input
        type="checkbox"
        :checked="isOn(m)"
        :disabled="disabled || installedSet.has(m)"
        @change="toggle(m)"
      />
      <span class="choice-name">
        {{ MODULE_LABELS[m] }}
        <span v-if="installedSet.has(m)" class="pill ok" style="margin-left: 6px">Installé</span>
      </span>
      <span class="choice-note">{{ MODULE_SUMMARIES[m] }}</span>
      <!-- The one field worth reading twice: whose rule this is. -->
      <span class="choice-basis">{{ MODULE_BASIS[m] }}</span>
    </label>
  </div>
</template>
