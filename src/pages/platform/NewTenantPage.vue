<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import {
  ESTABLISHMENT_LABELS, ESTABLISHMENT_NOTES, TIER_LABELS, TIER_NOTES,
} from "./labels";

/**
 * Registering an établissement.
 *
 * One screen, not a wizard. There are eight fields and six of them have
 * defaults; splitting that across steps would add clicks and hide from the
 * operator — usually sitting with the director on the phone — how much is left
 * to ask. The two things that genuinely cannot be defaulted are at the top: the
 * name, and who is in charge.
 *
 * The administrator's phone is part of THIS form rather than a follow-up,
 * because an établissement nobody can sign in to is not registered, it is a
 * support ticket. The API creates both in one transaction for the same reason.
 */
const router = useRouter();

const TYPES = Object.keys(ESTABLISHMENT_LABELS) as api.EstablishmentType[];
const TIERS: api.ServiceTier[] = ["CONNECTED", "RESILIENT", "SOVEREIGN"];

const name = ref("");
const establishmentType = ref<api.EstablishmentType>("COMPLEXE");
const tier = ref<api.ServiceTier>("CONNECTED");
const slug = ref("");
const slugTouched = ref(false);
const code = ref("");
const adminName = ref("");
const adminPhone = ref("+242");
const adminRole = ref("Directeur Général");

const busy = ref(false);
const error = ref<string | null>(null);

/** Mirrors the server's slugify. Shown, not hidden, because it becomes part of
 *  the URL a school will be given and is awkward to change later. */
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Follows the name until the operator edits it, then stops — the usual rule,
// and the one that avoids silently discarding a deliberate choice.
watch(name, (v) => {
  if (!slugTouched.value) slug.value = slugify(v);
});

const phoneValid = computed(() =>
  /^\+[1-9]\d{6,14}$/.test(adminPhone.value.replace(/[\s.-]/g, "")),
);
const canSubmit = computed(
  () =>
    name.value.trim().length >= 2 &&
    adminName.value.trim().length >= 2 &&
    phoneValid.value &&
    !busy.value,
);

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = null;
  try {
    const created = await api.platform.createTenant({
      name: name.value.trim(),
      establishmentType: establishmentType.value,
      tier: tier.value,
      ...(slug.value ? { slug: slug.value } : {}),
      ...(code.value.trim() ? { code: code.value.trim().toUpperCase() } : {}),
      admin: {
        phone: adminPhone.value.replace(/[\s.-]/g, ""),
        fullName: adminName.value.trim(),
        ...(adminRole.value.trim() ? { role: adminRole.value.trim() } : {}),
      },
    });
    await router.replace({ name: "tenant", params: { id: created.tenant.id } });
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <RouterLink class="crumb-back" :to="{ name: 'tenants' }">← Établissements</RouterLink>

    <div class="page-head">
      <div>
        <h1 class="page-title">Nouvel établissement</h1>
        <div class="page-sub">
          L'établissement et son premier administrateur sont créés ensemble. Celui-ci
          pourra se connecter immédiatement avec son numéro de téléphone.
        </div>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <form class="card" @submit.prevent="submit">
      <div class="card-body">
        <fieldset class="fieldset">
          <legend>Identité</legend>

          <div class="field">
            <label for="name">Nom officiel</label>
            <input
              id="name"
              v-model="name"
              autocomplete="off"
              placeholder="Complexe Scolaire La Grâce"
            />
            <span class="hint">Tel qu'il doit apparaître en tête des bulletins.</span>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="slug">Identifiant</label>
              <input
                id="slug"
                v-model="slug"
                autocomplete="off"
                placeholder="complexe-scolaire-la-grace"
                @input="slugTouched = true"
              />
              <span class="hint">Utilisé dans les adresses. Difficile à changer ensuite.</span>
            </div>
            <div class="field">
              <label for="code">Sigle</label>
              <input id="code" v-model="code" autocomplete="off" maxlength="8" placeholder="CSLG" />
              <span class="hint">Sur les documents imprimés. Déduit du nom si vide.</span>
            </div>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Type d'établissement</legend>
          <div class="choices">
            <label
              v-for="t in TYPES"
              :key="t"
              class="choice"
              :class="{ 'is-selected': establishmentType === t }"
            >
              <input v-model="establishmentType" type="radio" :value="t" name="type" />
              <span class="choice-name">{{ ESTABLISHMENT_LABELS[t] }}</span>
              <span class="choice-note">{{ ESTABLISHMENT_NOTES[t] }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Formule</legend>
          <div class="choices">
            <label
              v-for="t in TIERS"
              :key="t"
              class="choice"
              :class="{ 'is-selected': tier === t }"
            >
              <input v-model="tier" type="radio" :value="t" name="tier" />
              <span class="choice-name">{{ TIER_LABELS[t] }}</span>
              <span class="choice-note">{{ TIER_NOTES[t] }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="fieldset" style="margin-bottom: 0">
          <legend>Premier administrateur</legend>

          <div class="field-row">
            <div class="field">
              <label for="admin-name">Nom complet</label>
              <input id="admin-name" v-model="adminName" autocomplete="off" placeholder="Jean Mbemba" />
            </div>
            <div class="field" :class="{ 'is-invalid': adminPhone.length > 4 && !phoneValid }">
              <label for="admin-phone">Téléphone</label>
              <input
                id="admin-phone"
                v-model="adminPhone"
                type="tel"
                autocomplete="off"
                placeholder="+242 06 000 00 01"
              />
              <span v-if="adminPhone.length > 4 && !phoneValid" class="field-error">
                Format international attendu, par ex. +242060000001.
              </span>
              <span v-else class="hint">C'est ce numéro qui recevra le code de connexion.</span>
            </div>
          </div>

          <div class="field" style="margin-bottom: 0">
            <label for="admin-role">Fonction</label>
            <input id="admin-role" v-model="adminRole" autocomplete="off" />
            <span class="hint">
              Libellé affiché seulement. Les droits accordés sont complets sur tout
              l'établissement.
            </span>
          </div>
        </fieldset>
      </div>

      <div class="card-foot">
        <RouterLink class="btn" :to="{ name: 'tenants' }">Annuler</RouterLink>
        <button class="btn primary" type="submit" :disabled="!canSubmit">
          {{ busy ? "Enregistrement…" : "Enregistrer l'établissement" }}
        </button>
      </div>
    </form>
  </div>
</template>
