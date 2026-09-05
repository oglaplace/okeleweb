<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { useOrgStore } from "../../stores/org";
import PhoneInput from "../ui/PhoneInput.vue";
import UnitSelect from "../structure/UnitSelect.vue";
import Alert from "../ui/Alert.vue";
import PhotoInput from "../ui/PhotoInput.vue";

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
const emit = defineEmits<{
  /** The pupil, and the class they landed in — the caller decides what to do
   *  about it: refresh in place, or go and look at the class. */
  enrolled: [{ name: string; classeId: string }];
}>();

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

/*
 * ── THE SECOND STEP ────────────────────────────────────────────────────────
 *
 * An inscription and the money handed over with it are one act at the desk, so
 * the form asks for both and sends them together. The API treats the pair as
 * atomic: a refused payment undoes the enrolment rather than leaving a child on
 * the roll whose family believes they have paid.
 *
 * The payment is OPTIONAL — plenty of inscriptions are recorded before anything
 * is paid — but it is ASKED, because "later" is how a school ends up with a
 * register and a till that disagree.
 */
const step = ref<1 | 2>(1);

const pay = ref({ amount: "", method: "CASH" as api.PaymentMethod, feeTypeId: "", note: "", reference: "" });
const feeTypes = ref<{ id: string; name: string }[]>([]);
const OTHER = "__other__";

/** Only these carry one; the rest would print an empty box on every slip. */
const NEEDS_REFERENCE: api.PaymentMethod[] = ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER", "CHEQUE"];
const REFERENCE_LABEL: Partial<Record<api.PaymentMethod, string>> = {
  MTN_MOMO: "N° de transaction MoMo",
  AIRTEL_MONEY: "N° de transaction Airtel",
  BANK_TRANSFER: "Référence du virement",
  CHEQUE: "N° du chèque",
};

/** Digits only: a thousands separator typed by hand must not become an amount. */
const amountXaf = computed(() => Number(pay.value.amount.replace(/\D/g, "")) || 0);

/**
 * The échéancier of the class they are joining.
 *
 * Not a total — a bourse this pupil has not been granted yet would make any
 * figure shown here wrong — but the modalité and the first échéance, which is
 * the question actually asked across the desk: "c'est payable quand".
 */
const schedule = ref<{ modality: string; tranches: { label: string; dueOn: string }[] } | null>(null);

async function goToPayment() {
  if (!canSubmit.value) return;
  step.value = 2;
  error.value = null;
  if (!feeTypes.value.length) {
    // Both optional to the point of invisible: without them the step still
    // works, it just has fewer words on it.
    feeTypes.value = await api.finance.feeTypes().catch(() => []);
  }
  if (!schedule.value && form.value.classeId && form.value.academicYearId) {
    const led = await api.finance
      .classeLedger(form.value.classeId, form.value.academicYearId)
      .catch(() => null);
    if (led?.policy) {
      schedule.value = {
        modality: api.PAYMENT_MODALITY_FR[led.policy.modality] ?? led.policy.modality,
        tranches: led.tranches.map((t) => ({ label: t.label, dueOn: t.dueOn })),
      };
    }
  }
}

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

/** The portrait, as a data URL, or nothing at all. See PhotoInput. */
const photo = ref<string | null>(null);
/** Enrolled, but the photo did not go up — a warning, never an error. */
const photoWarning = ref<string | null>(null);

/** Only to tell "no class exists" apart from "none chosen yet". */
const classes = computed(() => org.ofKind(["CLASSE"]).filter((u) => !u.validTo));

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
    const created = await busy.run(
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
          /*
           * SENT WITH THE ENROLMENT, not after it. Two calls could half-happen;
           * the API undoes the inscription if the règlement is refused.
           */
          ...(amountXaf.value > 0
            ? {
                payment: {
                  amountXaf: amountXaf.value,
                  method: pay.value.method,
                  ...(pay.value.feeTypeId && pay.value.feeTypeId !== OTHER
                    ? { feeTypeId: pay.value.feeTypeId }
                    : {}),
                  ...(pay.value.feeTypeId === OTHER && pay.value.note.trim()
                    ? { purposeNote: pay.value.note.trim() }
                    : {}),
                  ...(NEEDS_REFERENCE.includes(pay.value.method) && pay.value.reference.trim()
                    ? { reference: pay.value.reference.trim() }
                    : {}),
                },
              }
            : {}),
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
      {
        title: "Inscription",
        detail: amountXaf.value > 0
          ? "Création de l'élève, de son inscription et du règlement."
          : "Création de l'élève et de son inscription.",
      },
    );
    /*
     * THE PHOTO IS SENT AFTER, AND ITS FAILURE IS NOT THE ENROLMENT'S.
     *
     * Two calls rather than one because the photo must never be able to undo an
     * inscription. A file too large, a link that dropped halfway, a format the
     * server refuses — none of those are reasons a child is not enrolled, and
     * folding the upload into the same transaction would make every one of them
     * exactly that. So the pupil exists first; if the picture does not arrive,
     * the operator is told where to add it and the row is already there.
     */
    if (photo.value && created.personId) {
      try {
        await api.people.setPhoto(created.personId, photo.value);
      } catch (e) {
        photoWarning.value =
          `${fullName} est inscrit(e), mais la photo n'a pas été envoyée` +
          `${e instanceof api.ApiError ? ` : ${e.message}` : "."} ` +
          `Vous pourrez l'ajouter depuis sa fiche.`;
      }
    }

    notice.value = created.receipt
      ? `${fullName} inscrit(e) · ${money(created.payment?.amountXaf ?? 0)} encaissé(s) · reçu ${created.receipt.number}.`
      : `${fullName} inscrit(e).`;
    // The classe and the year stay: a secretary enrols a whole list in one
    // sitting, and re-picking the same class forty times is the work.
    form.value.firstName = "";
    form.value.lastName = "";
    form.value.birthDate = "";
    form.value.birthPlace = "";
    form.value.gender = "";
    form.value.isRepeating = false;
    photo.value = null;
    form.value.guardians = [blankGuardian()];
    pay.value = { amount: "", method: "CASH", feeTypeId: "", note: "", reference: "" };
    step.value = 1;
    emit("enrolled", { name: fullName, classeId: form.value.classeId });
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
    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>
    <Alert v-if="photoWarning" kind="warn" @close="photoWarning = null">{{ photoWarning }}</Alert>

    <!-- Two steps, both visible from the start: the operator has to know the
         payment is coming before they start typing names, or they will look
         for it afterwards and not find it. -->
    <ol class="steps">
      <li :class="{ 'is-on': step === 1, 'is-done': step === 2 }">
        <span class="steps-n">1</span> Élève
      </li>
      <li :class="{ 'is-on': step === 2 }">
        <span class="steps-n">2</span> Règlement
        <span class="steps-note">facultatif</span>
      </li>
    </ol>

    <fieldset v-show="step === 1" class="fieldset">
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
      <!-- Last in the fieldset and marked facultative on its face: an operator
           enrolling forty pupils should be able to tab straight past it. -->
      <PhotoInput v-model="photo" />
    </fieldset>

    <!--
      The tuteur, asked now rather than "later".
      Later never comes: the number is needed the first time the child is absent
      or a tranche is unpaid, and by then whoever knew it has gone home.
    -->
    <fieldset v-show="step === 1" class="fieldset">
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
            <!-- Same control as the login. The number is how the school reaches
                 this family and how the API deduplicates one adult across their
                 children, so a tuteur typed as "060000001" and one typed as
                 "+242060000001" must not be able to become two people. -->
            <PhoneInput :id="`g-ph-${i}`" v-model="g.phone" />
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

    <fieldset v-show="step === 1" class="fieldset" style="margin-bottom: 0">
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
          <!-- Typed, not scrolled: a complex running three cycles has one
               option per cohort, and "A" appears five times in a native list
               with nothing to tell them apart. -->
          <UnitSelect
            id="e-cl"
            v-model="form.classeId"
            :kinds="['CLASSE']"
            placeholder="Rechercher une classe…"
          />
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

    <fieldset v-if="step === 2" class="fieldset" style="margin-bottom: 0">
      <legend>Règlement</legend>
      <p class="fieldset-note">
        Ce qui est versé maintenant, au guichet. Laissez le montant vide si la
        famille ne paie rien aujourd'hui — l'inscription se fait quand même.
        <template v-if="schedule">
          <br />
          <strong>{{ schedule.modality }}</strong>
          <template v-if="schedule.tranches[0]">
            · première échéance le {{ day(schedule.tranches[0].dueOn) }}
          </template>
        </template>
      </p>

      <div class="field-row">
        <div class="field">
          <label for="p-amt">Montant (XAF)</label>
          <input id="p-amt" v-model="pay.amount" inputmode="numeric" autocomplete="off"
                 placeholder="0" />
          <span v-if="amountXaf > 0" class="hint">{{ money(amountXaf) }}</span>
        </div>
        <div class="field">
          <label for="p-met">Moyen</label>
          <select id="p-met" v-model="pay.method">
            <option v-for="(label, code) in api.PAYMENT_METHOD_FR" :key="code" :value="code">
              {{ label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="p-mot">Motif</label>
          <select id="p-mot" v-model="pay.feeTypeId">
            <option value="">—</option>
            <option v-for="f in feeTypes" :key="f.id" :value="f.id">{{ f.name }}</option>
            <option :value="OTHER">Autre…</option>
          </select>
        </div>
      </div>

      <div class="field-row">
        <div v-if="pay.feeTypeId === OTHER" class="field">
          <label for="p-note">Préciser</label>
          <input id="p-note" v-model="pay.note" maxlength="120" autocomplete="off"
                 placeholder="Carte perdue, contribution…" />
        </div>
        <!-- Only for the methods that have one: a "référence" for cash is a box
             nobody fills. -->
        <div v-if="NEEDS_REFERENCE.includes(pay.method)" class="field">
          <label for="p-ref">{{ REFERENCE_LABEL[pay.method] ?? "Référence" }}</label>
          <input id="p-ref" v-model="pay.reference" autocomplete="off" />
        </div>
      </div>

      <p v-if="amountXaf > 0" class="hint">
        L'inscription et le règlement partent ensemble : si le règlement est
        refusé, l'inscription n'est pas créée non plus.
      </p>
    </fieldset>

    <div class="form-actions">
      <slot name="cancel" />
      <template v-if="step === 1">
        <button class="btn primary" type="button" :disabled="!canSubmit" @click="goToPayment">
          Continuer
        </button>
      </template>
      <template v-else>
        <button class="btn ghost" type="button" :disabled="working" @click="step = 1">
          Retour
        </button>
        <button class="btn primary" type="submit" :disabled="!canSubmit">
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{
            working ? "Inscription…"
            : amountXaf > 0 ? `Inscrire et encaisser ${money(amountXaf)}`
            : "Inscrire sans règlement"
          }}
        </button>
      </template>
    </div>
  </form>
</template>
