<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { KIND_FR } from "../../components/structure/kinds";

/**
 * Staff, and where they are posted.
 *
 * One person, one employment, several assignments — 6e A and 5e B and the
 * censorat. That shape is why "affecter" is a separate act from "ajouter": most
 * teachers in a private Brazzaville school are vacataires holding several
 * classes, and a model where a teacher belongs to one class cannot say so.
 */
const busy = useBusyStore();

const staff = ref<api.StaffMember[]>([]);
const units = ref<{ id: string; label: string }[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const adding = ref(false);
const working = ref(false);
const form = ref({
  lastName: "", firstName: "", phone: "", type: "PERMANENT" as api.StaffMember["type"],
  baseAmountXaf: "", orgUnitId: "", role: "Enseignant",
});

/** Assignment being added to an existing employment. */
const assigning = ref<string | null>(null);
const assignForm = ref({ orgUnitId: "", role: "Enseignant" });

/** Every unit, flattened with its path — an assignment can target any of them. */
async function loadUnits() {
  const found: { id: string; label: string }[] = [];
  const queue: { id: string | null; path: string[] }[] = [{ id: null, path: [] }];
  for (let guard = 0; guard < 400 && queue.length; guard++) {
    const next = queue.shift()!;
    const children = await api.orgUnits.children(next.id);
    for (const c of children) {
      const path = [...next.path, c.name];
      found.push({ id: c.id, label: `${path.join(" / ")} · ${KIND_FR[c.kind]}` });
      if (c.kind !== "CLASSE") queue.push({ id: c.id, path });
    }
  }
  units.value = found;
}

async function load() {
  loading.value = true;
  try {
    staff.value = await busy.run(() => api.people.staff());
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), loadUnits().catch(() => {})]);
});

const canAdd = computed(
  () =>
    form.value.lastName.trim().length >= 2 &&
    form.value.firstName.trim().length >= 2 &&
    !working.value,
);

async function add() {
  if (!canAdd.value) return;
  working.value = true;
  error.value = null;
  try {
    const salary = Number(form.value.baseAmountXaf.replace(/\D/g, "")) || 0;
    await busy.run(
      () =>
        api.people.createStaff({
          person: {
            firstName: form.value.firstName.trim(),
            lastName: form.value.lastName.trim(),
            ...(form.value.phone ? { phone: form.value.phone.trim() } : {}),
          },
          type: form.value.type,
          baseAmountXaf: salary,
          ...(form.value.orgUnitId
            ? { assignment: { orgUnitId: form.value.orgUnitId, role: form.value.role.trim() } }
            : {}),
        }),
      { title: "Ajout du personnel", detail: "Création de la fiche et du contrat." },
    );
    notice.value = `${form.value.firstName} ${form.value.lastName} ajouté(e).`;
    form.value.lastName = "";
    form.value.firstName = "";
    form.value.phone = "";
    form.value.baseAmountXaf = "";
    adding.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Ajout impossible.";
  } finally {
    working.value = false;
  }
}

async function assign(employmentId: string) {
  if (!assignForm.value.orgUnitId) return;
  try {
    await busy.run(() => api.people.assign(employmentId, { ...assignForm.value }));
    assigning.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Affectation impossible.";
  }
}

async function unassign(id: string) {
  try {
    await busy.run(() => api.people.endAssignment(id));
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Retrait impossible.";
  }
}

const xaf = (n: number) => `${n.toLocaleString("fr-FR")} F`;
const TYPE_FR: Record<api.StaffMember["type"], string> = {
  PERMANENT: "Permanent",
  VACATAIRE: "Vacataire",
  STAGIAIRE: "Stagiaire",
};
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Personnel</h1>
        <div class="page-sub">
          Enseignants, administration et vie scolaire — et les unités où ils sont
          affectés.
        </div>
      </div>
      <div class="page-actions">
        <button v-if="!adding" class="btn primary" type="button" @click="adding = true">
          Ajouter un personnel
        </button>
      </div>
    </div>

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <div v-if="adding" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Nouveau personnel
        <button class="btn sm ghost" type="button" @click="adding = false">Annuler</button>
      </div>
      <div class="card-body">
        <div class="field-row">
          <div class="field"><label for="s-ln">Nom</label>
            <input id="s-ln" v-model="form.lastName" autocomplete="off" /></div>
          <div class="field"><label for="s-fn">Prénom</label>
            <input id="s-fn" v-model="form.firstName" autocomplete="off" /></div>
          <div class="field"><label for="s-ph">Téléphone</label>
            <input id="s-ph" v-model="form.phone" autocomplete="off" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="s-ty">Contrat</label>
            <select id="s-ty" v-model="form.type">
              <option value="PERMANENT">Permanent</option>
              <option value="VACATAIRE">Vacataire</option>
              <option value="STAGIAIRE">Stagiaire</option>
            </select>
            <span class="hint">Le vacataire est payé sur les heures faites.</span>
          </div>
          <div class="field"><label for="s-sa">Salaire de base (XAF)</label>
            <input id="s-sa" v-model="form.baseAmountXaf" inputmode="numeric" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="s-ou">Première affectation</label>
            <select id="s-ou" v-model="form.orgUnitId">
              <option value="">Aucune pour l'instant</option>
              <option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option>
            </select>
          </div>
          <div class="field"><label for="s-ro">Fonction</label>
            <input id="s-ro" v-model="form.role" autocomplete="off" /></div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn primary" type="button" :disabled="!canAdd" @click="add">
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{ working ? "Ajout…" : "Ajouter" }}
        </button>
      </div>
    </div>

    <div class="card is-grid">
      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 60%" />
      </div>
      <div v-else-if="!staff.length" class="empty">
        <div class="empty-title">Aucun personnel</div>
        <div>Ajoutez-les un par un, ou importez un fichier.</div>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="adding = true">Ajouter</button>
          <RouterLink class="btn" :to="{ name: 'import' }">Importer</RouterLink>
        </div>
      </div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Personne</th>
              <th class="c-text">Contrat</th>
              <th>Salaire</th>
              <th class="c-text">Affectations</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in staff" :key="s.id">
              <td class="c-name">
                <span class="cell-id">
                  <span class="row-text">
                    <span class="cell-strong">{{ s.lastName.toUpperCase() }} {{ s.firstName }}</span>
                    <span class="cell-sub">{{ s.phone ?? "—" }}</span>
                  </span>
                </span>
              </td>
              <td class="c-text">{{ TYPE_FR[s.type] }}</td>
              <td>{{ xaf(s.baseAmountXaf) }}</td>
              <td class="c-text">
                <span v-for="a in s.assignments" :key="a.id" class="pill" style="margin-right: 4px">
                  {{ a.orgUnit.name }} · {{ a.role }}
                  <button
                    class="pill-x"
                    type="button"
                    :title="`Retirer de ${a.orgUnit.name}`"
                    @click="unassign(a.id)"
                  >×</button>
                </span>
                <span v-if="!s.assignments.length" class="cell-sub">Non affecté</span>

                <template v-if="assigning === s.id">
                  <div class="assign-row">
                    <select v-model="assignForm.orgUnitId">
                      <option value="">Choisir une unité…</option>
                      <option v-for="u in units" :key="u.id" :value="u.id">{{ u.label }}</option>
                    </select>
                    <input v-model="assignForm.role" placeholder="Fonction" />
                    <button class="btn sm primary" type="button" @click="assign(s.id)">OK</button>
                    <button class="btn sm ghost" type="button" @click="assigning = null">×</button>
                  </div>
                </template>
                <button
                  v-else
                  class="btn sm ghost"
                  type="button"
                  @click="assigning = s.id"
                >Affecter</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
