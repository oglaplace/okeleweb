<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type * as api from "../../lib/api";
import { useOrgStore } from "../../stores/org";
import Icon from "../ui/Icon.vue";

/**
 * Choosing a class, by typing three letters of its name.
 *
 * A `<select>` was fine at four classes and useless at forty: a complex running
 * primaire, collège and lycée has one option per cohort, in tree order, and a
 * secretary enrolling into 4e B scrolls past thirty entries to reach it. Worse,
 * a native option list shows one line of text, so "A" appears five times with
 * nothing to tell them apart.
 *
 * This filters as you type and shows the path under each name, which is the
 * part that disambiguates. It is a combobox rather than a dialog because it has
 * to sit inside a form row next to the other fields and behave like them.
 */
const props = defineProps<{
  modelValue: string;
  kinds: api.OrgUnitKind[];
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [string] }>();

const org = useOrgStore();
const open = ref(false);
const query = ref("");
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

onMounted(() => void org.load());

const options = computed(() =>
  org
    .ofKind(props.kinds)
    .filter((u) => !u.validTo)
    .map((u) => ({ id: u.id, name: u.name, path: org.pathOf(u.id) })),
);

const selected = computed(() => options.value.find((o) => o.id === props.modelValue) ?? null);

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  // The path counts: "collège 4" should find 4e A under the collège, and it is
  // how an operator describes a class out loud.
  return options.value.filter((o) =>
    `${o.name} ${o.path}`.toLowerCase().includes(needle),
  );
});

watch(matches, () => (active.value = 0));

async function openList() {
  if (props.disabled) return;
  open.value = true;
  query.value = "";
  await nextTick();
  input.value?.focus();
}

function choose(id: string) {
  emit("update:modelValue", id);
  open.value = false;
  query.value = "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const n = matches.value.length;
    if (n) active.value = (active.value + step + n) % n;
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const hit = matches.value[active.value];
    if (hit) choose(hit.id);
  }
}

// Click-away. A list that only its own trigger can close is a list people
// leave open over the field below it.
function onDocClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="unitsel" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      :id="id"
      class="unitsel-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? (open = false) : openList()"
    >
      <span v-if="selected" class="unitsel-value">
        <span class="unitsel-name">{{ selected.name }}</span>
        <span v-if="selected.path" class="unitsel-path">{{ selected.path }}</span>
      </span>
      <span v-else class="unitsel-empty">{{ placeholder ?? "Choisir…" }}</span>
      <Icon name="chevronDown" :size="14" />
    </button>

    <div v-if="open" class="unitsel-pop">
      <div class="unitsel-search">
        <Icon name="search" :size="15" />
        <input
          ref="input"
          v-model="query"
          type="search"
          placeholder="Filtrer…"
          aria-label="Filtrer"
          @keydown="onKey"
        />
      </div>

      <div class="unitsel-list" role="listbox">
        <button
          v-for="(o, i) in matches"
          :key="o.id"
          class="unitsel-item"
          :class="{ 'is-active': i === active, 'is-picked': o.id === modelValue }"
          type="button"
          role="option"
          :aria-selected="o.id === modelValue"
          @mouseenter="active = i"
          @click="choose(o.id)"
        >
          <span class="unitsel-name">{{ o.name }}</span>
          <span class="unitsel-path">{{ o.path || "Racine" }}</span>
        </button>
        <div v-if="!matches.length" class="tnode-hint">
          Aucun résultat pour « {{ query }} ».
        </div>
      </div>
    </div>
  </div>
</template>
