<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import { ESTABLISHMENT_LABELS, TIER_LABELS, TIER_NOTES } from "./labels";

/**
 * One établissement's registration record.
 *
 * What is deliberately NOT here: any of the school's own data. A platform
 * account holds no tenant, so the API refuses every academic and financial
 * query it makes — see the API's shared/tenancy.ts. This page shows what an
 * operator legitimately administers (who can sign in, which formula, which
 * boxes) and nothing about a single pupil.
 */
const route = useRoute();
const busy = useBusyStore();
const id = route.params.id as string;

const data = ref<api.TenantDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

// Add-administrator form.
const adding = ref(false);
const newName = ref("");
const newPhone = ref("");
const newRole = ref("Administrateur");
const addBusy = ref(false);
const addError = ref<string | null>(null);

const phoneValid = computed(() => /^\+242\d{9}$/.test(newPhone.value));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await busy.run(() => api.platform.tenant(id));
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

async function addAdmin() {
  if (!phoneValid.value || newName.value.trim().length < 2) return;
  addBusy.value = true;
  addError.value = null;
  try {
    // Blocking: this mints a Firebase identity for someone who is probably on
    // the phone waiting to be told they can sign in.
    await busy.run(
      () =>
        api.platform.addAdmin(id, {
          phone: newPhone.value,
          fullName: newName.value.trim(),
          ...(newRole.value.trim() ? { role: newRole.value.trim() } : {}),
        }),
      {
        title: "Ajout de l'administrateur",
        detail: "Création du compte et des droits sur cet établissement.",
      },
    );
    notice.value = `${newName.value.trim()} peut désormais se connecter.`;
    newName.value = "";
    newPhone.value = "";
    adding.value = false;
    await load();
  } catch (e) {
    addError.value = e instanceof api.ApiError ? e.message : "Ajout impossible.";
  } finally {
    addBusy.value = false;
  }
}

async function setActive(active: boolean) {
  try {
    await busy.run(
      () => api.platform.updateTenant(id, { active }),
      {
        title: active ? "Réactivation" : "Suspension",
        detail: active
          ? "L'établissement redevient accessible à son personnel."
          : "Le personnel de l'établissement ne pourra plus se connecter.",
      },
    );
    notice.value = active ? "Établissement réactivé." : "Établissement suspendu.";
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Modification impossible.";
  }
}

/** Two initials for the row mark, same convention as the sidebar avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "—";

onMounted(() => void load());
</script>

<template>
  <div>
    <RouterLink class="crumb-back" :to="{ name: 'tenants' }">← Établissements</RouterLink>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="width: 35%" />
        <div class="skeleton" style="width: 60%" />
      </div>
    </div>

    <div v-else-if="error" class="form-error">{{ error }}</div>

    <template v-else-if="data">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ data.tenant.name }}</h1>
          <div class="page-sub">
            {{ ESTABLISHMENT_LABELS[data.tenant.establishmentType ?? "COMPLEXE"] }} ·
            {{ data.tenant.slug }} · enregistré le {{ dateFmt(data.tenant.createdAt) }}
          </div>
        </div>
        <div class="page-actions">
          <button
            v-if="data.tenant.active"
            class="btn"
            type="button"
            @click="setActive(false)"
          >
            Suspendre
          </button>
          <button v-else class="btn primary" type="button" @click="setActive(true)">
            Réactiver
          </button>
        </div>
      </div>

      <div v-if="notice" class="form-ok">{{ notice }}</div>

      <div class="grid-cards" style="margin-bottom: var(--s5)">
        <div class="stat">
          <div class="stat-label">Formule</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ TIER_LABELS[data.tenant.tier] }}
          </div>
          <div class="stat-note">{{ TIER_NOTES[data.tenant.tier] }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Écriture</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ data.tenant.authority === "EDGE" ? "Serveur local" : "Cloud" }}
          </div>
          <div class="stat-note">
            {{
              data.tenant.migrationLockedAt
                ? "Migration en cours — écritures suspendues."
                : "Nœud autorisé à enregistrer."
            }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Année en cours</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ data.academicYears.find((y) => y.isCurrent)?.label ?? "—" }}
          </div>
          <div class="stat-note">{{ data.academicYears.length }} année(s) enregistrée(s)</div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">
            Personnes pouvant se connecter
            <button
              v-if="!adding"
              class="btn sm"
              type="button"
              @click="adding = true"
            >
              Ajouter
            </button>
          </div>

          <div v-if="adding" class="card-body" style="border-bottom: 1px solid var(--line-soft)">
            <div v-if="addError" class="form-error">{{ addError }}</div>
            <div class="field-row">
              <div class="field">
                <label for="new-name">Nom complet</label>
                <input id="new-name" v-model="newName" autocomplete="off" />
              </div>
              <div class="field">
                <label for="new-phone">Téléphone</label>
                <PhoneInput
                  id="new-phone"
                  v-model="newPhone"
                  :invalid="newPhone.length > 0 && !phoneValid"
                />
              </div>
              <div class="field">
                <label for="new-role">Fonction</label>
                <input id="new-role" v-model="newRole" autocomplete="off" />
              </div>
            </div>
            <div class="form-actions">
              <button
                class="btn primary"
                type="button"
                :disabled="addBusy || !phoneValid || newName.trim().length < 2"
                @click="addAdmin"
              >
                <span v-if="addBusy" class="btn-spin" aria-hidden="true" />
                {{ addBusy ? "Ajout…" : "Ajouter l'administrateur" }}
              </button>
              <button class="btn ghost" type="button" @click="adding = false">Annuler</button>
            </div>
          </div>

          <div v-if="!data.admins.length" class="empty">
            Aucun compte. Personne ne peut ouvrir cet établissement.
          </div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Personne</th>
                  <th>Téléphone</th>
                  <th>Dernière connexion</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in data.admins" :key="a.id">
                  <td class="c-name">
                    <span class="row-mark" aria-hidden="true">{{ initials(a.fullName) }}</span>
                    <span class="row-text">
                      <span class="cell-strong">{{ a.fullName }}</span>
                      <span class="cell-sub">{{ a.roles.join(", ") || "—" }}</span>
                    </span>
                  </td>
                  <td>{{ a.phone }}</td>
                  <td>{{ dateFmt(a.lastSeenAt) }}</td>
                  <td>
                    <span v-if="a.active" class="pill ok">Actif</span>
                    <span v-else class="pill danger">Désactivé</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-head">Structure</div>
          <div class="card-body">
            <p style="color: var(--ink-2); margin: 0">
              Racine :
              <strong>{{ data.root?.name ?? "—" }}</strong>
              <span class="unit-meta"> · {{ data.root?.code ?? "—" }}</span>
            </p>
            <p style="color: var(--ink-3); font-size: var(--t-small); margin: var(--s2) 0 0">
              Les écoles, cycles, niveaux et classes se créent depuis la console de
              l'établissement, par son administrateur.
            </p>
          </div>
        </div>

        <div v-if="data.edgeNodes.length" class="card">
          <div class="card-head">Serveurs locaux</div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Nom</th>
                  <th>État</th>
                  <th>Version</th>
                  <th>Dernier contact</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in data.edgeNodes" :key="n.id">
                  <td class="c-name cell-strong">{{ n.name }}</td>
                  <td>
                    <span class="pill" :class="n.status === 'ACTIVE' ? 'ok' : 'warn'">
                      {{ n.status }}
                    </span>
                  </td>
                  <td>{{ n.appVersion ?? "—" }}</td>
                  <td>{{ dateFmt(n.lastSeenAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
