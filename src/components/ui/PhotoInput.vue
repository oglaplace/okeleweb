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
 * The file is REDUCED before it is handed over — see lib/photo.ts. A 28px disc
 * in a list and a vignette on a bulletin do not need the three megapixels the
 * secretariat's phone just produced, and pushing them across a Congolese mobile
 * link is a minute of somebody's day for a difference nobody can see.
 */
import { portraitRefusal, toPortraitDataUrl } from "../../lib/photo";

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

async function pick(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = ""; // so re-choosing the same file fires change again
  if (!file) return;
  error.value = null;

  const refusal = portraitRefusal(file);
  if (refusal) {
    error.value = refusal;
    return;
  }

  try {
    model.value = await toPortraitDataUrl(file);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Lecture du fichier impossible.";
  }
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
      <span v-else class="photoinput-hint">
        JPEG, PNG ou WebP — réduite automatiquement
      </span>
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
