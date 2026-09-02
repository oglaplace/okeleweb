<script setup lang="ts">
import { computed, ref } from "vue";

/**
 * The passport photo, wherever a person is being registered.
 *
 * NEVER REQUIRED. A school that cannot enrol a child because the family did not
 * bring a photograph is a school that turns children away over a photograph —
 * and in Brazzaville the picture is very often taken later, by whoever next has
 * a phone. So this holds a value or it holds nothing, and the form around it
 * does not care which. The same photo can be added weeks afterwards from the
 * person's own dossier.
 *
 * The value is a data URL, which is also what the API accepts, so nothing has
 * to be re-encoded between here and the wire.
 *
 * The two rules below are the API's rules restated. They are checked here
 * because a 2 Mo upload that fails after crossing a Congolese mobile link is a
 * minute of someone's day and a message that arrives too late to be useful —
 * and restated rather than merely trusted, because the server still enforces
 * them: this is a courtesy, not the guard.
 */
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

const model = defineModel<string | null>({ default: null });
withDefaults(
  defineProps<{
    label?: string;
    /** Small enough to sit inside a form row rather than lead a page. */
    compact?: boolean;
  }>(),
  { label: "Photo d'identité", compact: false },
);

const error = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);

function pick(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = ""; // so re-choosing the same file fires change again
  if (!file) return;
  error.value = null;

  if (!TYPES.includes(file.type)) {
    error.value = "Format accepté : JPEG, PNG ou WebP.";
    return;
  }
  if (file.size > MAX_BYTES) {
    error.value = `Photo trop lourde (${(file.size / 1024 / 1024).toFixed(1)} Mo, maximum 2 Mo).`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => (model.value = String(reader.result));
  reader.onerror = () => (error.value = "Lecture du fichier impossible.");
  reader.readAsDataURL(file);
}

function clear() {
  model.value = null;
  error.value = null;
}

const hint = computed(() => (model.value ? "Changer" : "Choisir une photo"));
</script>

<template>
  <div class="photoinput" :class="{ 'is-compact': compact }">
    <div class="photoinput-frame" :class="{ 'is-empty': !model }">
      <img v-if="model" :src="model" alt="Aperçu de la photo" />
      <!-- Passport proportions even when empty, so the form does not jump by
           144px the moment a file is chosen. -->
      <span v-else class="photoinput-ph" aria-hidden="true">35 × 45</span>
    </div>

    <div class="photoinput-side">
      <span class="photoinput-label">{{ label }}<em> — facultative</em></span>
      <div class="photoinput-acts">
        <button class="btn sm" type="button" @click="input?.click()">{{ hint }}</button>
        <button v-if="model" class="btn sm ghost" type="button" @click="clear">Retirer</button>
      </div>
      <span v-if="error" class="photoinput-err">{{ error }}</span>
      <span v-else class="photoinput-hint">JPEG, PNG ou WebP · 2 Mo maximum</span>
    </div>

    <input
      ref="input"
      class="visually-hidden"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      tabindex="-1"
      aria-hidden="true"
      @change="pick"
    />
  </div>
</template>
