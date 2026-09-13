<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";

/**
 * LA BARRE DE RECHERCHE, une fois.
 *
 * Three screens had `<input class="unpaid-search">` — the class named after the
 * page it was first written on, which is how a style ends up on a screen about
 * something else. They were a bare box with a placeholder: no affordance that
 * it searched rather than filtered, and no way to clear it but selecting the
 * text and deleting it, which at a guichet with a parent waiting is the kind of
 * friction that gets an operator to reach for the paper register instead.
 *
 * So: the magnifier that says what the box is for, a clear button that appears
 * only when there is something to clear, and Échap to empty it without leaving
 * the keyboard. `hint` sits inside the control rather than beside it, because
 * "12 résultats" is about the box and floated away from it before.
 */
const model = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    /** Right-aligned inside the field: result counts, mostly. */
    hint?: string;
    label?: string;
    autofocus?: boolean;
  }>(),
  { placeholder: "Rechercher…", hint: "", label: "Rechercher", autofocus: false },
);

const el = ref<HTMLInputElement | null>(null);
const focused = ref(false);
const filled = computed(() => model.value.trim().length > 0);

function clear() {
  model.value = "";
  // Focus goes back to the box, not nowhere: clearing is almost always the
  // start of typing something else.
  el.value?.focus();
}
</script>

<template>
  <div class="search-field" :class="{ 'is-focused': focused, 'is-filled': filled }">
    <Icon name="search" :size="15" class="search-icon" aria-hidden="true" />
    <input
      ref="el"
      v-model="model"
      type="search"
      class="search-input"
      :placeholder="props.placeholder"
      :aria-label="props.label"
      :autofocus="props.autofocus"
      autocomplete="off"
      spellcheck="false"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.esc.prevent="clear"
    />
    <span v-if="props.hint" class="search-hint">{{ props.hint }}</span>
    <button
      v-if="filled"
      class="search-clear"
      type="button"
      aria-label="Effacer la recherche"
      @click="clear"
    >
      <Icon name="x" :size="13" />
    </button>
  </div>
</template>

<style scoped>
.search-field {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex: 1;
  min-width: 200px;
  max-width: 420px;
  padding: 0 var(--s3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.search-field.is-focused {
  border-color: var(--primary-line);
  box-shadow: var(--ring);
}
.search-icon {
  color: var(--ink-3);
  flex: none;
}
.search-field.is-focused .search-icon,
.search-field.is-filled .search-icon {
  color: var(--primary);
}

/* The input keeps none of the app's field chrome: the wrapper is the control. */
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  box-shadow: none;
  padding: 8px 0;
  font: inherit;
  color: var(--ink);
}
.search-input:focus {
  outline: none;
  box-shadow: none;
}
/* Safari draws its own oval clear button on type=search; ours is the one that
   is keyboard-reachable and the right colour. */
.search-input::-webkit-search-decoration,
.search-input::-webkit-search-cancel-button {
  appearance: none;
}

.search-hint {
  flex: none;
  font-size: var(--t-small);
  color: var(--ink-3);
  white-space: nowrap;
}
.search-clear {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--ink-2);
  cursor: pointer;
}
.search-clear:hover {
  background: var(--line-strong);
  color: var(--ink);
}
.search-clear:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
</style>
