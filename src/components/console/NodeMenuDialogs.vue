<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { KIND_FR } from "../structure/kinds";

/**
 * The dialogs behind the tree's ⋯ menu.
 *
 * Kept out of the Explorer for one reason: the tree is a pure renderer of rows
 * and a row must not own a modal — a menu opened on a node that the next reload
 * removes would leave a dialog attached to nothing. The pane owns them, keyed
 * on the unit, and closes them when the tree changes underneath.
 */
const props = defineProps<{
  unit: api.TreeUnit | null;
  action: "add" | "rename" | "close" | "reopen" | null;
}>();
const emit = defineEmits<{ done: [changed: boolean] }>();

const busy = useBusyStore();
const working = ref(false);
const error = ref<string | null>(null);

const form = ref({ name: "", code: "", kind: "" as api.OrgUnitKind | "" });
const allowedKinds = ref<api.OrgUnitKind[]>([]);

watch(
  () => [props.unit?.id, props.action],
  async () => {
    error.value = null;
    if (!props.unit || !props.action) return;

    if (props.action === "rename") {
      form.value = { name: props.unit.name, code: props.unit.code, kind: "" };
    }
    if (props.action === "add") {
      form.value = { name: "", code: "", kind: "" };
      // Asked, not assumed: ALLOWED_PARENTS is what the POST enforces, so a
      // client guessing offers options the server then refuses.
      allowedKinds.value = await api.orgUnits.allowedKinds(props.unit.id).catch(() => []);
      form.value.kind = allowedKinds.value[0] ?? "";
    }
  },
  { immediate: true },
);

watch(
  () => form.value.name,
  (v) => {
    if (props.action === "add" && !form.value.code) {
      form.value.code = v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
    }
  },
);

const title = computed(() => {
  if (!props.unit) return "";
  switch (props.action) {
    case "add": return `Ajouter dans « ${props.unit.name} »`;
    case "rename": return `Renommer « ${props.unit.name} »`;
    case "close": return `Fermer « ${props.unit.name} » ?`;
    case "reopen": return `Rouvrir « ${props.unit.name} » ?`;
    default: return "";
  }
});

const canSubmit = computed(() => {
  if (working.value) return false;
  if (props.action === "add") {
    return form.value.kind !== "" && form.value.name.trim().length >= 2 && form.value.code.trim().length >= 1;
  }
  if (props.action === "rename") return form.value.name.trim().length >= 2;
  return true;
});

async function submit() {
  if (!props.unit || !props.action || !canSubmit.value) return;
  working.value = true;
  error.value = null;
  try {
    await busy.run(async () => {
      if (props.action === "add") {
        await api.orgUnits.create({
          parentId: props.unit!.id,
          kind: form.value.kind as api.OrgUnitKind,
          name: form.value.name.trim(),
          code: form.value.code.trim().toUpperCase(),
        });
      } else if (props.action === "rename") {
        await api.orgUnits.update(props.unit!.id, {
          name: form.value.name.trim(),
          code: form.value.code.trim().toUpperCase(),
        });
      } else if (props.action === "close") {
        await api.orgUnits.close(props.unit!.id);
      } else if (props.action === "reopen") {
        await api.orgUnits.reopen(props.unit!.id);
      }
    });
    emit("done", true);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div v-if="unit && action" class="scrim" @click.self="emit('done', false)">
    <div class="scrim-card" style="align-items: stretch; text-align: left; max-width: 460px">
      <div class="login-title" style="font-size: var(--t-h3)">{{ title }}</div>

      <div v-if="error" class="form-error" style="margin: var(--s3) 0 0">{{ error }}</div>

      <template v-if="action === 'add'">
        <div v-if="!allowedKinds.length" class="hint" style="margin-top: var(--s3)">
          Rien ne peut être créé ici — une classe est le dernier échelon de l'arbre.
        </div>
        <div v-else style="margin-top: var(--s3)">
          <div class="field">
            <label for="n-kind">Type</label>
            <select id="n-kind" v-model="form.kind">
              <option v-for="k in allowedKinds" :key="k" :value="k">{{ KIND_FR[k] }}</option>
            </select>
          </div>
          <div class="field">
            <label for="n-name">Nom</label>
            <input id="n-name" v-model="form.name" autocomplete="off" />
          </div>
          <div class="field" style="margin-bottom: 0">
            <label for="n-code">Code</label>
            <input id="n-code" v-model="form.code" autocomplete="off" maxlength="8" />
          </div>
        </div>
      </template>

      <template v-else-if="action === 'rename'">
        <div style="margin-top: var(--s3)">
          <div class="field">
            <label for="r-name">Nom</label>
            <input id="r-name" v-model="form.name" autocomplete="off" />
          </div>
          <div class="field" style="margin-bottom: 0">
            <label for="r-code">Code</label>
            <input id="r-code" v-model="form.code" autocomplete="off" maxlength="8" />
            <span class="hint">Apparaît sur les documents imprimés.</span>
          </div>
        </div>
      </template>

      <p v-else-if="action === 'close'" class="scrim-detail" style="text-align: left">
        L'unité est <strong>fermée, pas supprimée</strong> : les bulletins déjà édités
        continuent de la référencer, et vous pourrez la rouvrir. Ses enfants et ses
        inscriptions actives doivent d'abord être déplacés.
      </p>

      <p v-else class="scrim-detail" style="text-align: left">
        L'unité redeviendra active et réapparaîtra dans les listes.
      </p>

      <div class="form-actions" style="margin-top: var(--s4); justify-content: flex-end">
        <button class="btn ghost" type="button" @click="emit('done', false)">Annuler</button>
        <button
          class="btn"
          :class="action === 'close' ? 'danger' : 'primary'"
          type="button"
          :disabled="!canSubmit"
          @click="submit"
        >
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{ action === "close" ? "Fermer" : action === "reopen" ? "Rouvrir" : "Enregistrer" }}
        </button>
      </div>
    </div>
  </div>
</template>
