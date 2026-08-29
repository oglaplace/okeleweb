<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";

/**
 * Enrol one pupil.
 *
 * The API creates the Person, the Student and the Enrolment in one call and
 * allocates the matricule, so this form has no "create pupil then enrol" step —
 * a pupil enrolled nowhere is a row nobody can act on.
 */
const busy = useBusyStore();

const classes = ref<{ id: string; name: string; path: string }[]>([]);
const years = ref<api.AcademicYear[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const working = ref(false);

const form = ref({
  firstName: "",
  lastName: "",
  gender: "",
  birthDate: "",
  birthPlace: "",
  classeId: "",
  academicYearId: "",
  isRepeating: false,
});

/**
 * Every classe in the complex, with its path.
 *
 * Walked breadth-first from the root rather than asked for directly: the API
 * exposes children-of-a-parent, and "6e A" alone is ambiguous in a complex that
 * runs a collège and a lycée. The path is what disambiguates.
 */
async function loadClasses() {
  const found: { id: string; name: string; path: string }[] = [];
  const queue: { id: string | null; path: string[] }[] = [{ id: null, path: [] }];
  // Bounded by the domain: the deepest legal tree is seven levels.
  for (let guard = 0; guard < 400 && queue.length; guard++) {
    const next = queue.shift()!;
    const children = await api.orgUnits.children(next.id);
    for (const c of children) {
      if (c.kind === "CLASSE") {
        found.push({ id: c.id, name: c.name, path: next.path.join(" / ") });
      } else {
        queue.push({ id: c.id, path: [...next.path, c.name] });
      }
    }
  }
  classes.value = found;
}

onMounted(async () => {
  try {
    const [y] = await Promise.all([api.academics.years(), loadClasses()]);
    years.value = y;
    form.value.academicYearId = y.find((x) => x.isCurrent)?.id ?? y[0]?.id ?? "";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

const canSubmit = computed(
  () =>
    form.value.firstName.trim().length >= 2 &&
    form.value.lastName.trim().length >= 2 &&
    form.value.classeId !== "" &&
    form.value.academicYearId !== "" &&
    !working.value,
);

async function submit() {
  if (!canSubmit.value) return;
  working.value = true;
  error.value = null;
  try {
    await busy.run(
      () =>
        api.enrollment.enroll({
          person: {
            firstName: form.value.firstName.trim(),
            lastName: form.value.lastName.trim(),
            ...(form.value.gender ? { gender: form.value.gender } : {}),
            ...(form.value.birthDate ? { birthDate: form.value.birthDate } : {}),
            ...(form.value.birthPlace ? { birthPlace: form.value.birthPlace.trim() } : {}),
          },
          academicYearId: form.value.academicYearId,
          classeId: form.value.classeId,
          isRepeating: form.value.isRepeating,
        }),
      { title: "Inscription", detail: "Création de l'élève et de son inscription." },
    );
    notice.value = `${form.value.firstName} ${form.value.lastName} inscrit(e).`;
    // The classe and year stay: a secretary enrols a whole list in one sitting.
    form.value.firstName = "";
    form.value.lastName = "";
    form.value.birthDate = "";
    form.value.birthPlace = "";
    form.value.isRepeating = false;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Inscription impossible.";
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Inscrire un élève</h1>
        <div class="page-sub">
          L'élève, sa fiche et son inscription sont créés ensemble. Le matricule est
          attribué automatiquement.
        </div>
      </div>
    </div>

    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 65%" />
    </div></div>

    <div v-else-if="!classes.length" class="card">
      <div class="empty">
        <div class="empty-title">Aucune classe</div>
        <div>Un élève s'inscrit dans une classe. Créez-en une d'abord.</div>
        <div class="empty-actions">
          <RouterLink class="btn primary" :to="{ name: 'structure' }">Structure</RouterLink>
        </div>
      </div>
    </div>

    <form v-else class="card" @submit.prevent="submit">
      <div class="card-body">
        <fieldset class="fieldset">
          <legend>Élève</legend>
          <div class="field-row">
            <div class="field">
              <label for="ln">Nom</label>
              <input id="ln" v-model="form.lastName" autocomplete="off" />
            </div>
            <div class="field">
              <label for="fn">Prénom</label>
              <input id="fn" v-model="form.firstName" autocomplete="off" />
            </div>
            <div class="field">
              <label for="g">Sexe</label>
              <select id="g" v-model="form.gender">
                <option value="">—</option>
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="bd">Date de naissance</label>
              <input id="bd" v-model="form.birthDate" type="date" />
            </div>
            <div class="field">
              <label for="bp">Lieu de naissance</label>
              <input id="bp" v-model="form.birthPlace" autocomplete="off" />
            </div>
          </div>
        </fieldset>

        <fieldset class="fieldset" style="margin-bottom: 0">
          <legend>Inscription</legend>
          <div class="field-row">
            <div class="field">
              <label for="cl">Classe</label>
              <select id="cl" v-model="form.classeId">
                <option value="">—</option>
                <option v-for="c in classes" :key="c.id" :value="c.id">
                  {{ c.path }} / {{ c.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="yr">Année scolaire</label>
              <select id="yr" v-model="form.academicYearId">
                <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
            </div>
          </div>
          <label class="toggle">
            <input v-model="form.isRepeating" type="checkbox" /> Redoublant(e)
          </label>
        </fieldset>
      </div>
      <div class="card-foot">
        <button class="btn primary" type="submit" :disabled="!canSubmit">
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{ working ? "Inscription…" : "Inscrire" }}
        </button>
      </div>
    </form>
  </div>
</template>
