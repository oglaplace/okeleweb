<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { useOrgStore } from "../../stores/org";

/**
 * Enrol one pupil — the form, wherever it is shown.
 *
 * The API creates the Person, the Student and the Enrolment in one call and
 * allocates the matricule, so there is no "create pupil then enrol" step: a
 * pupil enrolled nowhere is a row nobody can act on.
 *
 * Split out of the page so the same form can open as a dialog over a class.
 * Enrolling is something you do WHILE looking at a class list — leaving the
 * list, filling a form, and coming back to a screen that has to be reloaded to
 * show the pupil you just added is three steps where one will do.
 *
 * `fixedClasse` is what makes that work: given one, the class question is
 * already answered and is stated rather than asked.
 */
const props = defineProps<{
  /** Pre-answers "which class" — the dialog case. */
  fixedClasse?: string | null;
  /** Clears the whole form after each save; the page keeps the class instead. */
  once?: boolean;
}>();
const emit = defineEmits<{ enrolled: [name: string] }>();

const busy = useBusyStore();
const org = useOrgStore();

const years = ref<api.AcademicYear[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const working = ref(false);

/** One tuteur as the form holds it, before it is worth sending. */
interface GuardianRow {
  firstName: string;
  lastName: string;
  relationship: string;
  phone: string;
  email: string;
}
const blankGuardian = (relationship = "mère"): GuardianRow => ({
  firstName: "", lastName: "", relationship, phone: "", email: "",
});

const form = ref({
  firstName: "",
  lastName: "",
  gender: "",
  birthDate: "",
  birthPlace: "",
  classeId: "",
  academicYearId: "",
  isRepeating: false,
  guardians: [blankGuardian()] as GuardianRow[],
});

/** Every classe in the complex, with the path that disambiguates it. */
const classes = computed(() =>
  org
    .ofKind(["CLASSE"])
    .filter((u) => !u.validTo)
    .map((u) => ({ id: u.id, name: u.name, path: org.pathOf(u.id) })),
);

const fixed = computed(() => (props.fixedClasse ? org.byId(props.fixedClasse) : null));

onMounted(async () => {
  try {
    const [y] = await Promise.all([api.academics.years(), org.load()]);
    years.value = y;
    form.value.academicYearId = y.find((x) => x.isCurrent)?.id ?? y[0]?.id ?? "";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

watch(
  () => props.fixedClasse,
  (id) => {
    if (id) form.value.classeId = id;
  },
  { immediate: true },
);

function addGuardian() {
  // The second row defaults to "père": the pair is what a school actually
  // records, and defaulting both to "mère" makes the operator fix every one.
  form.value.guardians.push(blankGuardian(form.value.guardians.length === 1 ? "père" : "tuteur"));
}
function removeGuardian(i: number) {
  form.value.guardians.splice(i, 1);
}

/** A tuteur is worth sending once they have a name. */
const namedGuardians = computed(() =>
  form.value.guardians.filter((g) => g.lastName.trim() || g.firstName.trim()),
);

const canSubmit = computed(
  () =>
    form.value.firstName.trim().length >= 2 &&
    form.value.lastName.trim().length >= 2 &&
    form.value.classeId !== "" &&
    form.value.academicYearId !== "" &&
    // Half a tuteur is not a tuteur: a row with a phone and no name would be
    // rejected by the API, so it is refused here where it can be explained.
    namedGuardians.value.every((g) => g.lastName.trim() && g.firstName.trim()) &&
    !working.value,
);

async function submit() {
  if (!canSubmit.value) return;
  working.value = true;
  error.value = null;
  const fullName = `${form.value.firstName} ${form.value.lastName}`;
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
          ...(namedGuardians.value.length
            ? {
                guardians: namedGuardians.value.map((g) => ({
                  firstName: g.firstName.trim(),
                  lastName: g.lastName.trim(),
                  relationship: g.relationship,
                  ...(g.phone.trim() ? { phone: g.phone.trim() } : {}),
                  ...(g.email.trim() ? { email: g.email.trim() } : {}),
                })),
              }
            : {}),
        }),
      { title: "Inscription", detail: "Création de l'élève et de son inscription." },
    );
    notice.value = `${fullName} inscrit(e).`;
    // The classe and the year stay: a secretary enrols a whole list in one
    // sitting, and re-picking the same class forty times is the work.
    form.value.firstName = "";
    form.value.lastName = "";
    form.value.birthDate = "";
    form.value.birthPlace = "";
    form.value.gender = "";
    form.value.isRepeating = false;
    form.value.guardians = [blankGuardian()];
    emit("enrolled", fullName);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Inscription impossible.";
  } finally {
    working.value = false;
  }
}

defineExpose({ submit });
</script>

<template>
  <div v-if="loading" class="stack">
    <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 65%" />
  </div>

  <!-- Two different dead ends, said apart. Both used to render as "aucune
       classe", which sent a director to build a class they already had. -->
  <div v-else-if="!years.length" class="empty">
    <div class="empty-title">Aucune année scolaire</div>
    <div>
      Une inscription se rattache à une année. Ouvrez-en une — tout le reste y est
      déjà prêt.
    </div>
    <div class="empty-actions">
      <RouterLink class="btn primary" :to="{ name: 'action', params: { id: 'create-year' } }">
        Ouvrir une année scolaire
      </RouterLink>
    </div>
  </div>

  <div v-else-if="!fixed && !classes.length" class="empty">
    <div class="empty-title">Aucune classe</div>
    <div>Un élève s'inscrit dans une classe. Créez-en une d'abord.</div>
    <div class="empty-actions">
      <RouterLink class="btn primary" :to="{ name: 'structure' }">Structure</RouterLink>
    </div>
  </div>

  <form v-else class="enroll-form" @submit.prevent="submit">
    <div v-if="notice" class="form-ok">{{ notice }}</div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <fieldset class="fieldset">
      <legend>Élève</legend>
      <div class="field-row">
        <div class="field">
          <label for="e-ln">Nom</label>
          <input id="e-ln" v-model="form.lastName" autocomplete="off" />
        </div>
        <div class="field">
          <label for="e-fn">Prénom</label>
          <input id="e-fn" v-model="form.firstName" autocomplete="off" />
        </div>
        <div class="field">
          <label for="e-g">Sexe</label>
          <select id="e-g" v-model="form.gender">
            <option value="">—</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="e-bd">Date de naissance</label>
          <input id="e-bd" v-model="form.birthDate" type="date" />
        </div>
        <div class="field">
          <label for="e-bp">Lieu de naissance</label>
          <input id="e-bp" v-model="form.birthPlace" autocomplete="off" />
        </div>
      </div>
    </fieldset>

    <!--
      The tuteur, asked now rather than "later".
      Later never comes: the number is needed the first time the child is absent
      or a tranche is unpaid, and by then whoever knew it has gone home.
    -->
    <fieldset class="fieldset">
      <legend>Tuteurs</legend>
      <p class="fieldset-note">
        Le premier tuteur est le contact principal et le destinataire des
        factures. Le téléphone est ce qui compte : c'est le numéro appelé en cas
        d'absence.
      </p>

      <div v-for="(g, i) in form.guardians" :key="i" class="guardian">
        <div class="field-row">
          <div class="field">
            <label :for="`g-ln-${i}`">Nom</label>
            <input :id="`g-ln-${i}`" v-model="g.lastName" autocomplete="off" />
          </div>
          <div class="field">
            <label :for="`g-fn-${i}`">Prénom</label>
            <input :id="`g-fn-${i}`" v-model="g.firstName" autocomplete="off" />
          </div>
          <div class="field">
            <label :for="`g-rl-${i}`">Lien</label>
            <select :id="`g-rl-${i}`" v-model="g.relationship">
              <option value="mère">Mère</option>
              <option value="père">Père</option>
              <option value="tuteur">Tuteur</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label :for="`g-ph-${i}`">Téléphone</label>
            <input :id="`g-ph-${i}`" v-model="g.phone" type="tel" placeholder="+242…" />
          </div>
          <div class="field">
            <label :for="`g-em-${i}`">Email</label>
            <input :id="`g-em-${i}`" v-model="g.email" type="email" autocomplete="off" />
          </div>
          <div class="field field-actions">
            <button
              v-if="form.guardians.length > 1"
              class="btn sm ghost"
              type="button"
              @click="removeGuardian(i)"
            >
              Retirer
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="form.guardians.length < 4"
        class="btn sm"
        type="button"
        @click="addGuardian"
      >
        Ajouter un tuteur
      </button>
    </fieldset>

    <fieldset class="fieldset" style="margin-bottom: 0">
      <legend>Inscription</legend>
      <div class="field-row">
        <!-- Stated, not asked, when the form was opened from the class. -->
        <div v-if="fixed" class="field">
          <label>Classe</label>
          <!-- The name in the box, the path underneath: a five-level path does
               not fit on one control-height line, and letting it wrap breaks
               the row every other field is aligned to. -->
          <div class="field-static">{{ fixed.name }}</div>
          <span class="hint">{{ org.pathOf(fixed.id) }}</span>
        </div>
        <div v-else class="field">
          <label for="e-cl">Classe</label>
          <select id="e-cl" v-model="form.classeId">
            <option value="">—</option>
            <option v-for="c in classes" :key="c.id" :value="c.id">
              {{ c.path }} / {{ c.name }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="e-yr">Année scolaire</label>
          <select id="e-yr" v-model="form.academicYearId">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </div>
      </div>
      <label class="toggle">
        <input v-model="form.isRepeating" type="checkbox" /> Redoublant(e)
      </label>
    </fieldset>

    <div class="form-actions">
      <slot name="cancel" />
      <button class="btn primary" type="submit" :disabled="!canSubmit">
        <span v-if="working" class="btn-spin" aria-hidden="true" />
        {{ working ? "Inscription…" : "Inscrire" }}
      </button>
    </div>
  </form>
</template>
