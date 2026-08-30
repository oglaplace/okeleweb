<script setup lang="ts">
import type { SheetTab } from "./columns";

/**
 * The sheet tabs, at the bottom, where a spreadsheet puts them.
 *
 * Bottom rather than top on purpose. These do not navigate — every tab is the
 * same rows — so putting them where a page's navigation lives would say the
 * wrong thing. At the foot of the grid they read as what they are: which face
 * of this data you are looking at.
 */
defineProps<{ tabs: SheetTab[]; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();
</script>

<template>
  <div class="sheet-tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="sheet-tab"
      :class="{ 'is-active': tab.id === modelValue }"
      type="button"
      role="tab"
      :aria-selected="tab.id === modelValue"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
    <div class="sheet-tabs-fill" />
    <slot name="end" />
  </div>
</template>
