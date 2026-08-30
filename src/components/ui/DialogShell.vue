<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import Icon from "./Icon.vue";
import type { IconName } from "./icons";

/**
 * One dialog, used by all of them.
 *
 * There were three overlays with three headers, three paddings and three ideas
 * of where the buttons go — the action form, the node menus, and now enrolment.
 * At that point "consistent" stops being a matter of care and becomes a matter
 * of having one component.
 *
 * The background blurs rather than dims to grey: the page behind stays legible
 * as CONTEXT, which is the point of acting in place — you can still see the
 * class you are enrolling into.
 */
defineProps<{
  title: string;
  /** What this is being done TO, stated so it never has to be asked. */
  subtitle?: string;
  detail?: string;
  icon?: IconName;
  wide?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

// Escape closes. A modal you can only leave with the mouse is a modal that
// traps someone mid-form on a laptop with a dead trackpad.
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="scrim-card dialog" :class="{ 'is-wide': wide }" role="dialog" aria-modal="true">
      <div class="dialog-head">
        <div class="dialog-title">
          <Icon v-if="icon" :name="icon" :size="17" />
          <span>{{ title }}</span>
        </div>
        <button class="btn sm ghost" type="button" @click="emit('close')">Fermer</button>
      </div>

      <div v-if="subtitle || detail" class="dialog-scope">
        <span v-if="subtitle" class="kind-tag">{{ subtitle }}</span>
        <span v-if="detail" class="hint">{{ detail }}</span>
      </div>

      <div class="dialog-body">
        <slot />
      </div>
    </div>
  </div>
</template>
