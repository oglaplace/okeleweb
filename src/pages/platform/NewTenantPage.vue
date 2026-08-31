<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import ModulePicker from "../../components/structure/ModulePicker.vue";
import Alert from "../../components/ui/Alert.vue";
import {
  DEFAULT_MODULES, ESTABLISHMENT_LABELS, ESTABLISHMENT_NOTES,
  TIER_LABELS, TIER_NOTES,
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
const busy = useBusyStore();

const TYPES = Object.keys(ESTABLISHMENT_LABELS) as api.EstablishmentType[];
const TIERS: api.ServiceTier[] = ["CONNECTED", "RESILIENT", "SOVEREIGN"];

const name = ref("");
const establishmentType = ref<api.EstablishmentType>("COMPLEXE");
const tier = ref<api.ServiceTier>("CONNECTED");
const slug = ref("");
const slugTouched = ref(false);
const code = ref("");
const adminName = ref("");
const adminPhone = ref("");
const adminRole = ref("Directeur Général");

/**
 * The structure this établissement will be created with.
 *
 * Preselected from the type and then freely editable, because "complexe
 * scolaire" in Brazzaville means whatever that complex actually runs — half of
 * them run a maternelle nobody asked about. Changing the type resets the
 * selection unless the operator has already touched it: silently discarding a
 * deliberate choice is worse than a stale default.
 */
const modules = ref<api.BlueprintModule[]>(DEFAULT_MODULES.COMPLEXE ?? []);
const modulesTouched = ref(false);
const preview = ref<api.ScaffoldPreview | null>(null);

watch(establishmentType, (t) => {
  if (!modulesTouched.value) modules.value = DEFAULT_MODULES[t] ?? [];
});

// The preview is computed by the API from the same catalogue that builds the
// tree, so a count shown here cannot disagree with what lands.
watch(
  modules,
  async (list) => {
    if (!list.length) {
      preview.value = null;
      return;
    }
    try {
      preview.value = await api.orgUnits.previewScaffold(list);
    } catch {
      // A failed preview must not block registration — it is a courtesy.
      preview.value = null;
    }
  },
  { immediate: true },
);

const working = ref(false);
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

const phoneValid = computed(() => /^\+242\d{9}$/.test(adminPhone.value));
const canSubmit = computed(
  () =>
    name.value.trim().length >= 2 &&
    adminName.value.trim().length >= 2 &&
    phoneValid.value &&
    !working.value,
);

async function submit() {
  if (!canSubmit.value) return;
  working.value = true;
  error.value = null;
  try {
    // Blocking, not ambient: this mints a Firebase identity and opens a
    // Postgres transaction, and a second click on a slow link would be a second
    // attempt to claim the same identifier.
    const created = await busy.run(
      () =>
        api.platform.createTenant({
          name: name.value.trim(),
          establishmentType: establishmentType.value,
          tier: tier.value,
          ...(slug.value ? { slug: slug.value } : {}),
          ...(code.value.trim() ? { code: code.value.trim().toUpperCase() } : {}),
          modules: modules.value,
          admin: {
            phone: adminPhone.value,
            fullName: adminName.value.trim(),
            ...(adminRole.value.trim() ? { role: adminRole.value.trim() } : {}),
          },
        }),
      {
        title: "Enregistrement de l'établissement",
        detail:
          "Création de la structure, de l'année scolaire en cours et du compte " +
          "administrateur. Ne fermez pas cette page.",
      },
    );
    await router.replace({ name: "tenant", params: { id: created.tenant.id } });
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    working.value = false;
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

    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

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
          <legend>Structure de départ</legend>
          <p class="fieldset-note">
            La structure qui fait d'un lycée un lycée vient du ministère, pas de
            l'établissement — elle est donc créée d'avance. L'administrateur n'aura
            qu'à y affecter le personnel, ouvrir les classes et inscrire les élèves.
          </p>
          <ModulePicker v-model="modules" :disabled="working" @update:model-value="modulesTouched = true" />

          <div v-if="preview" class="preview">
            <div class="preview-item">
              <b>{{ preview.orgUnits }}</b> unités
            </div>
            <div class="preview-item"><b>{{ preview.levels }}</b> niveaux</div>
            <div class="preview-item"><b>{{ preview.subjects }}</b> matières</div>
            <div class="preview-item"><b>{{ preview.series }}</b> séries</div>
            <div class="preview-item"><b>{{ preview.departments }}</b> services</div>
          </div>
          <p v-else class="hint">
            Aucun module sélectionné — l'établissement sera créé vide, et son
            administrateur construira la structure lui-même.
          </p>
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
            <div class="field">
              <label for="admin-phone">Téléphone</label>
              <PhoneInput
                id="admin-phone"
                v-model="adminPhone"
                :invalid="adminPhone.length > 0 && !phoneValid"
              />
              <span class="hint">C'est ce numéro qui recevra le code de connexion.</span>
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
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{ working ? "Enregistrement…" : "Enregistrer l'établissement" }}
        </button>
      </div>
    </form>
  </div>
</template>
