<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import { useBusyStore } from "../../stores/busy";
import { KIND_FR } from "../../components/structure/kinds";
import Alert from "../../components/ui/Alert.vue";
import PhotoInput from "../../components/ui/PhotoInput.vue";

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

/** The staff portrait — optional, exactly as for a pupil. See PhotoInput. */
const photo = ref<string | null>(null);
const photoWarning = ref<string | null>(null);

/**
 * The portraits already on file, keyed by personId.
 *
 * Fetched one by one because the endpoint serves one person, and behind the
 * bearer token, which an <img src> cannot carry — so each is loaded through the
 * API layer and kept as a blob URL. Fine for a staff list, which is dozens;
 * a roster of six hundred pupils would need a different endpoint, and it is
 * deliberately not given this treatment.
 */
const photos = ref<Record<string, string | null>>({});
const objectUrls: string[] = [];

async function loadPhotos() {
  await Promise.all(
    staff.value.map(async (s) => {
      if (s.personId in photos.value) return;
      const url = await api.people.photoObjectUrl(s.personId);
      if (url) objectUrls.push(url);
      photos.value = { ...photos.value, [s.personId]: url };
    }),
  );
}
onBeforeUnmount(() => objectUrls.forEach((u) => URL.revokeObjectURL(u)));

/** The office adding someone's photo after the fact, from the list. */
async function onStaffPhoto(event: Event, personId: string) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = "";
  if (!file) return;

  photoWarning.value = null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    photoWarning.value = "Format accepté : JPEG, PNG ou WebP.";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    photoWarning.value = `Photo trop lourde (${(file.size / 1024 / 1024).toFixed(1)} Mo, maximum 2 Mo).`;
    return;
  }

  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
    await api.people.setPhoto(personId, data);
    const fresh = await api.people.photoObjectUrl(personId);
    if (fresh) objectUrls.push(fresh);
    photos.value = { ...photos.value, [personId]: fresh };
  } catch (e) {
    photoWarning.value = e instanceof api.ApiError ? e.message : "Envoi de la photo impossible.";
  }
}

/** Every unit, flattened with its path — an assignment can target any of them. */
/** Every unit, flattened with its path. One request — see EnrollPage. */
async function loadUnits() {
  const all = await api.orgUnits.tree();
  const byId = new Map(all.map((u) => [u.id, u]));
  units.value = all.map((u) => {
    const parts: string[] = [u.name];
    let cursor = u.parentId;
    for (let i = 0; cursor && i < 12; i++) {
      const parent = byId.get(cursor);
      if (!parent) break;
      parts.unshift(parent.name);
      cursor = parent.parentId;
    }
    return { id: u.id, label: `${parts.join(" / ")} · ${KIND_FR[u.kind]}` };
  });
}

async function load() {
  loading.value = true;
  try {
    staff.value = await busy.run(() => api.people.staff());
    // After the list, not with it: a portrait that has not arrived yet costs
    // an initial, and nobody should wait on twenty of them to see the table.
    void loadPhotos();
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
    const created = await busy.run(
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
    /* Same rule as an inscription: the photo is sent after and cannot undo the
       hiring. See EnrollForm for why it is two calls. */
    if (photo.value && created.person.id) {
      try {
        await api.people.setPhoto(created.person.id, photo.value);
      } catch (e) {
        photoWarning.value =
          `La fiche est créée, mais la photo n'a pas été envoyée` +
          `${e instanceof api.ApiError ? ` : ${e.message}` : "."}`;
      }
    }

    notice.value = `${form.value.firstName} ${form.value.lastName} ajouté(e).`;
    form.value.lastName = "";
    form.value.firstName = "";
    form.value.phone = "";
    form.value.baseAmountXaf = "";
    photo.value = null;
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

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>
    <Alert v-if="photoWarning" kind="warn" @close="photoWarning = null">{{ photoWarning }}</Alert>

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
          <div class="field">
            <label for="s-ph">Téléphone</label>
            <!-- One phone control in the whole app: the prefix is furniture,
                 not something each form re-invents and half of them forget. -->
            <PhoneInput id="s-ph" v-model="form.phone" />
          </div>
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
        <!-- Same optional portrait as on an inscription: the badge and the
             trombinoscope want it, nothing about the hiring depends on it. -->
        <PhotoInput v-model="photo" />
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
                  <!--
                    The portrait, and the way to set it, in one 28px disc.

                    This is the "later" half of the optional field on the add
                    form: a school hires in August with no photos and collects
                    them through September, and the list they are working from
                    should be where they land. Same control the signed-in person
                    has over their own in the rail.
                  -->
                  <label class="avatar is-mine" :title="`Photo de ${s.firstName} ${s.lastName}`">
                    <img v-if="photos[s.personId]" :src="photos[s.personId]!" alt="" />
                    <span v-else aria-hidden="true">
                      {{ (s.firstName[0] ?? "") + (s.lastName[0] ?? "") }}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      @change="onStaffPhoto($event, s.personId)"
                    />
                  </label>
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
