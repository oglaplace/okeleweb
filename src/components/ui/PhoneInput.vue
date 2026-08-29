<script setup lang="ts">
import { computed, ref, watch } from "vue";

/**
 * A phone field whose country code is furniture, not content.
 *
 * `+242` sits OUTSIDE the editable input — it is a sibling span inside the same
 * frame — so there is no caret position from which it can be deleted, no
 * backspace that eats it, and no paste that replaces it. Masking it inside the
 * input would mean policing every one of those, and the policing always loses
 * somewhere (select-all + type is the usual escape).
 *
 * This matters more than it looks. The phone number IS the identity: it is what
 * Firebase keys the uid on and what the API's unique index protects. A number
 * typed as "060000001" and one typed as "+242060000001" are the same human and
 * two different accounts, and only one of them can ever receive an OTP.
 * Removing the possibility is better than validating after the fact.
 *
 * The model value is always full E.164 or empty — never a half-formed string —
 * so callers can hand it straight to the API.
 */
const props = defineProps<{
  modelValue: string;
  id?: string;
  /** Marks the frame invalid; the caller owns the message. */
  invalid?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [string] }>();

const DIAL = "+242";
/** Congo-Brazzaville national numbers are nine digits. */
const NATIONAL_LENGTH = 9;

/** Grouped as a Congolese reads it aloud: 06 000 00 01. */
function group(digits: string): string {
  const p = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)];
  return p.filter(Boolean).join(" ");
}

/** Everything that is not a digit goes, and a pasted +242 or 242 is absorbed
 *  rather than doubled — pasting a full number is the common case. */
function nationalOf(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("242")) digits = digits.slice(3);
  return digits.slice(0, NATIONAL_LENGTH);
}

const text = ref(group(nationalOf(props.modelValue)));

// Keep in step when the parent resets the field (after a successful invite).
watch(
  () => props.modelValue,
  (next) => {
    if (nationalOf(next) !== nationalOf(text.value)) {
      text.value = group(nationalOf(next));
    }
  },
);

function onInput(event: Event) {
  const national = nationalOf((event.target as HTMLInputElement).value);
  text.value = group(national);
  emit("update:modelValue", national ? DIAL + national : "");
}

const complete = computed(() => nationalOf(text.value).length === NATIONAL_LENGTH);
</script>

<template>
  <div class="phone" :class="{ 'is-invalid': invalid, 'is-disabled': disabled }">
    <span class="phone-dial" aria-hidden="true">{{ DIAL }}</span>
    <input
      :id="id"
      class="phone-input"
      type="tel"
      inputmode="numeric"
      autocomplete="tel-national"
      placeholder="06 000 00 01"
      :aria-label="`Numéro de téléphone, indicatif ${DIAL}`"
      :disabled="disabled"
      :autofocus="autofocus"
      :value="text"
      @input="onInput"
    />
    <span v-if="complete" class="phone-ok" aria-hidden="true">✓</span>
  </div>
</template>
