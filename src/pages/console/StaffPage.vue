<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import { useBusyStore } from "../../stores/busy";
import { KIND_FR } from "../../components/structure/kinds";
import Alert from "../../components/ui/Alert.vue";
import PhotoInput from "../../components/ui/PhotoInput.vue";
import { useBanner, exclusive } from "../../lib/banner";
import { useAuthStore } from "../../stores/auth";

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
const units = ref<{ id: string; label: string; kind: api.OrgUnitKind; path: string }[]>([]);
const loading = ref(true);
const { notice, error } = useBanner();

const adding = ref(false);
const working = ref(false);
const form = ref({
  lastName: "", firstName: "", phone: "", type: "PERMANENT" as api.StaffMember["type"],
  baseAmountXaf: "", orgUnitId: "", role: "Enseignant",
});

/**
 * Once the contract is chosen by hand, the posting stops proposing one.
 *
 * Otherwise picking "6e A" after correcting the contract would silently undo
 * the correction, which is the way a suggestion turns into a bug report.
 */
const typeChosen = ref(false);
watch(() => form.value.orgUnitId, (unitId) => {
  if (typeChosen.value || !unitId) return;
  const suggestion = suggestedType(unitId);
  if (suggestion) form.value.type = suggestion;
});

/**
 * What the amount means — the whole point of this turn.
 *
 * One column in the database (`baseAmountXaf`) holds two different things, and
 * the form asked for it as "Salaire de base (XAF)" either way. A vacataire's
 * 2 000 F an hour went into the same box as a titulaire's 250 000 F a month and
 * the list printed both under "Salaire", where the first reads as a starvation
 * wage and the second as a fortune. The field says which it wants.
 */
const AMOUNT_FR = {
  HOURLY: {
    label: "Taux horaire (XAF / heure)",
    hint: "Payé sur les heures faites : voir « Heures et paie » plus bas.",
    placeholder: "2 000",
  },
  FIXED: {
    label: "Salaire mensuel (XAF)",
    hint: "Montant brut versé chaque mois, quelles que soient les heures.",
    placeholder: "250 000",
  },
} as const;
const amountBasis = computed(() => (form.value.type === "VACATAIRE" ? "HOURLY" : "FIXED"));
const amount = computed(() => AMOUNT_FR[amountBasis.value]);

/** The digits the office typed, as a number. One parse, used everywhere. */
const amountXaf = computed(() => Number(form.value.baseAmountXaf.replace(/\D/g, "")) || 0);

/**
 * Grouped as it is typed — 250000 and 25000 are one keystroke apart on screen
 * and a factor of ten in the payroll.
 */
function onAmountInput(event: Event) {
  const digits = (event.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 9);
  form.value.baseAmountXaf = digits ? Number(digits).toLocaleString("fr-FR") : "";
}

/* ── CE QUE CETTE EMBAUCHE VA COÛTER ───────────────────────────────────────
 *
 * The form asks for a rate; the question behind the form is what the rate adds
 * up to. Nothing answered it, so the office typed a number and worked out the
 * consequence on paper — which is the same gap the pay panel below was built
 * to close, one step earlier.
 *
 * It is answerable for a salaried hire and NOT for an hourly one, and the form
 * says so rather than splitting the difference. A monthly salary times the
 * months left in the year is arithmetic. A vacataire's year depends on how many
 * hours they end up holding, which is not known until they are posted and the
 * grid is drawn — so the annual figure stays blank, with a line saying when it
 * will appear. A plausible invented total is worse than none: it gets budgeted
 * against, found wrong, and then nothing on the screen is trusted again.
 */
const year = ref<api.AcademicYear | null>(null);

/**
 * Employer charges on top of gross — CNSS retraite, allocations familiales,
 * accidents du travail. The server owns the rate (it can be set per tenant);
 * this is the national default, used until the pay panel has been asked.
 */
const DEFAULT_CHARGE_RATE = 0.2028;
const chargeRate = ref(DEFAULT_CHARGE_RATE);

/** Whole months from today to the end of the year, the current one included. */
const monthsLeft = computed(() => {
  if (!year.value) return null;
  const end = new Date(year.value.endsOn);
  const now = new Date();
  // A hire made after the year has ended belongs to the next one; until that
  // year exists there is nothing honest to project.
  if (end < now) return null;
  const months =
    (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()) + 1;
  return Math.max(1, months);
});

/** null = not answerable yet, and the template says why. */
const projection = computed(() => {
  if (amountBasis.value === "HOURLY" || !amountXaf.value || !monthsLeft.value) return null;
  const gross = amountXaf.value * monthsLeft.value;
  return {
    months: monthsLeft.value,
    gross,
    cost: Math.round(gross * (1 + chargeRate.value)),
    monthlyCost: Math.round(amountXaf.value * (1 + chargeRate.value)),
  };
});

/** Assignment being added to an existing employment. */
const assigning = ref<string | null>(null);
const assignForm = ref({ orgUnitId: "", role: "Enseignant" });

/** The staff portrait — optional, exactly as for a pupil. See PhotoInput. */
const photo = ref<string | null>(null);
const photoWarning = ref<string | null>(null);
exclusive({ notice, error, photoWarning });

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
    return {
      id: u.id,
      label: `${parts.join(" / ")} · ${KIND_FR[u.kind]}`,
      kind: u.kind,
      // The whole branch, lowercased: what tells a primaire from a collège is
      // the CYCLE's name — "Primaire", "Collège", "Lycée" — and a classe two
      // levels below it carries none of that in its own.
      path: [...parts, ...ancestorKinds(u.id, byId)].join(" ").toLowerCase(),
    };
  });
}

/** The kinds along a unit's branch, so FACULTY anywhere above is visible. */
function ancestorKinds(id: string, byId: Map<string, api.TreeUnit>): string[] {
  const kinds: string[] = [];
  let cursor: string | null = id;
  for (let i = 0; cursor && i < 12; i++) {
    const unit: api.TreeUnit | undefined = byId.get(cursor);
    if (!unit) break;
    kinds.push(unit.kind);
    cursor = unit.parentId;
  }
  return kinds;
}

/**
 * COMMENT CETTE AFFECTATION PAIE, D'HABITUDE.
 *
 * A primaire titulaire holds one class all week and draws a monthly salary; at
 * the collège, at the lycée and in the supérieur the school buys hours — a
 * vacataire takes eight of maths across three classes and is paid for those
 * eight. The form used to open on "Permanent" for everyone, so the hourly half
 * of the staff — most of a private Brazzaville school — was hired on the wrong
 * contract and the number typed next to it meant a month instead of an hour.
 *
 * A SUGGESTION, and never more: an école pays whoever it likes however it
 * likes, a primaire keeps a vacataire for English, and a lycée puts its censeur
 * on salary. Choosing a posting proposes the usual contract; touching the
 * contract yourself ends the proposing, for good, on this form.
 */
function suggestedType(unitId: string): api.StaffMember["type"] | null {
  const unit = units.value.find((u) => u.id === unitId);
  if (!unit) return null;
  // The supérieur is structural — FACULTY, FILIERE and PARCOURS exist nowhere
  // else in the tree — so it is read from the kinds rather than from a name.
  if (/FACULTY|FILIERE|PARCOURS/.test(unit.path.toUpperCase())) return "VACATAIRE";
  if (/primaire|présco|presco|maternelle|garderie/.test(unit.path)) return "PERMANENT";
  if (/collège|college|lycée|lycee|secondaire|supérieur|superieur/.test(unit.path)) {
    return "VACATAIRE";
  }
  return null;
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
  await Promise.all([
    load(),
    loadUnits().catch(() => {}),
    api.academics
      .years()
      .then((ys) => { year.value = ys.find((y) => y.isCurrent) ?? null; })
      .catch(() => {}),
  ]);
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
    const created = await busy.run(
      () =>
        api.people.createStaff({
          person: {
            firstName: form.value.firstName.trim(),
            lastName: form.value.lastName.trim(),
            ...(form.value.phone ? { phone: form.value.phone.trim() } : {}),
          },
          type: form.value.type,
          baseAmountXaf: amountXaf.value,
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

/* ── HEURES ET PAIE ────────────────────────────────────────────────────────
 *
 * The other half of the fix. Knowing that 2 000 F is an hourly rate is only
 * useful if something multiplies it by the hours, and until now nothing did:
 * the office took the grid off the wall, counted the mardis of the month by
 * hand and wrote a figure. The API counts them — off the PUBLISHED timetable,
 * inside the trimestres, or off the register of lessons where the school keeps
 * one — and says which source it used, because a payroll figure whose
 * provenance is not on screen is one that gets redone by hand anyway.
 */
const auth = useAuthStore();
const maySeePay = computed(() => auth.can("finance.read"));

/** A month, because that is the unit a school pays in. `<input type=month>`. */
const month = ref(new Date().toISOString().slice(0, 7));

/**
 * MOIS OU ANNÉE — the same endpoint, asked a bigger question.
 *
 * "What do I owe in mars" and "what does my staff cost me this year" are the
 * same arithmetic over a different range, and the API already takes two dates
 * with a 400-day ceiling. So the annual figure — the one a director actually
 * budgets on — costs one toggle, no endpoint, no new model.
 *
 * The year is the ACADEMIC year, not January to December: a school commits to
 * a rentrée, and a calendar year cuts that commitment in half.
 */
const scope = ref<"MONTH" | "YEAR">("MONTH");
const pay = ref<api.Workload | null>(null);
const payLoading = ref(false);
const payOpen = ref(false);

/** Last day of the month, without a date library: day 0 of the next one. */
function bounds(value: string): { from: string; to: string } {
  const [y, m] = value.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${value}-01`, to: `${value}-${String(last).padStart(2, "0")}` };
}

/**
 * The range being asked about, or null when the year is wanted and none is
 * declared — the button is disabled in that case rather than silently
 * falling back to the month, which would show a monthly figure under an
 * annual heading.
 */
const range = computed<{ from: string; to: string } | null>(() => {
  if (scope.value === "MONTH") return bounds(month.value);
  if (!year.value) return null;
  return { from: year.value.startsOn.slice(0, 10), to: year.value.endsOn.slice(0, 10) };
});

async function loadPay() {
  if (!maySeePay.value || !range.value) return;
  payLoading.value = true;
  try {
    pay.value = await api.people.workload(range.value.from, range.value.to);
    // The server owns the rate; the hiring projection above follows it.
    chargeRate.value = pay.value.chargeRate;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Calcul des heures impossible.";
    pay.value = null;
  } finally {
    payLoading.value = false;
  }
}

watch([month, scope, payOpen], () => {
  if (payOpen.value) void loadPay();
});

/** Minutes as a school says them: "6 h", "6 h 30". */
const hours = (min: number) =>
  min === 0 ? "—" : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}`;

const BASIS_FR: Record<api.Workload["rows"][number]["hoursBasis"], string> = {
  SESSIONS: "séances pointées",
  EXCEPTIONS: "emploi du temps, corrigé",
  TIMETABLE: "emploi du temps",
  NONE: "aucune heure",
};

/**
 * Two totals, because they are two different questions.
 *
 * `payTotal` is what leaves for the teachers; `costTotal` adds the employer's
 * own charges — CNSS — and is what the school actually spends. Showing only the
 * first is how a budget comes up a fifth short.
 */
const payTotal = computed(() =>
  (pay.value?.rows ?? []).reduce((sum, r) => sum + r.payXaf, 0),
);
const costTotal = computed(() =>
  (pay.value?.rows ?? []).reduce((sum, r) => sum + r.costXaf, 0),
);
const chargePct = computed(() =>
  `${((pay.value?.chargeRate ?? chargeRate.value) * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  })} %`,
);

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
            <select id="s-ty" v-model="form.type" @change="typeChosen = true">
              <option value="PERMANENT">Permanent — salaire mensuel</option>
              <option value="VACATAIRE">Vacataire — payé à l'heure</option>
              <option value="STAGIAIRE">Stagiaire</option>
            </select>
            <span class="hint">
              Primaire et préscolaire au mois ; collège, lycée et supérieur à
              l'heure. L'affectation propose, vous décidez.
            </span>
          </div>
          <div class="field">
            <label for="s-sa">{{ amount.label }}</label>
            <input
              id="s-sa"
              :value="form.baseAmountXaf"
              inputmode="numeric"
              :placeholder="amount.placeholder"
              @input="onAmountInput"
            />
            <span class="hint">{{ amount.hint }}</span>
          </div>
        </div>

        <!-- CE QUE ÇA COÛTE, pendant qu'on le tape. A number typed with no
             consequence on screen is a number checked on paper afterwards. -->
        <div v-if="amountXaf" class="cost-note">
          <template v-if="projection">
            <div class="cost-line">
              <span>Coût jusqu'à la fin de l'année</span>
              <strong>{{ xaf(projection.cost) }}</strong>
            </div>
            <span class="hint">
              {{ xaf(amountXaf) }} × {{ projection.months }} mois
              = {{ xaf(projection.gross) }} brut, plus {{ chargePct }} de charges
              patronales — soit {{ xaf(projection.monthlyCost) }} par mois pour l'école.
            </span>
          </template>
          <template v-else-if="amountBasis === 'HOURLY'">
            <div class="cost-line">
              <span>Coût annuel</span>
              <strong class="muted">à déterminer</strong>
            </div>
            <span class="hint">
              Un vacataire est payé sur les heures qu'il tient : le coût annuel
              apparaîtra dans « Heures et paie » dès qu'il sera affecté et que
              l'emploi du temps de ses classes sera publié.
              {{ xaf(amountXaf) }} de l'heure, charges patronales en sus.
            </span>
          </template>
          <span v-else class="hint">
            Aucune année scolaire en cours : le coût annuel ne peut pas être calculé.
          </span>
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
              <th>Rémunération</th>
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
              <!-- The unit, always: the same column holds 2 000 F an hour and
                   250 000 F a month, and they are not comparable numbers. -->
              <td>
                {{ xaf(s.baseAmountXaf) }}
                <span class="cell-sub">{{ s.type === "VACATAIRE" ? "par heure" : "par mois" }}</span>
              </td>
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

    <!--
      HEURES ET PAIE DU MOIS.

      Collapsed until asked for: most visits to this screen are to hire someone
      or fix a posting, and the payroll is a monthly errand. Behind finance.read
      because every figure in it is francs.
    -->
    <div v-if="maySeePay" class="card is-grid" style="margin-top: var(--s4)">
      <div class="card-head cal-head" :class="{ 'is-open': payOpen }">
        <button class="cal-toggle" type="button" @click="payOpen = !payOpen">
          <svg class="cal-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          <span>Heures et paie</span>
          <span class="unit-meta">
            {{ pay ? `${xaf(costTotal)} pour ${pay.rows.length} personne(s)`
                   : "calculé sur l'emploi du temps publié" }}
          </span>
        </button>
        <div v-if="payOpen" class="pay-scope">
          <!-- Same endpoint, wider range. See `scope` in the script.
               `viewswitch` is the console's one segmented control — the tarifs
               and impayés screens already use it, and a second one built here
               is exactly the drift its own comment warns about. -->
          <div class="viewswitch" role="group" aria-label="Période">
            <button type="button" class="viewswitch-btn" :class="{ 'is-on': scope === 'MONTH' }"
                    @click="scope = 'MONTH'">Mois</button>
            <button type="button" class="viewswitch-btn" :class="{ 'is-on': scope === 'YEAR' }"
                    :disabled="!year" @click="scope = 'YEAR'"
                    :title="year ? `Année ${year.label}` : 'Aucune année scolaire en cours'">
              Année
            </button>
          </div>
          <input v-if="scope === 'MONTH'" v-model="month" type="month" class="btn"
                 aria-label="Mois" />
          <span v-else-if="year" class="unit-meta">{{ year.label }}</span>
        </div>
      </div>

      <template v-if="payOpen">
        <div v-if="payLoading" class="card-body stack">
          <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 65%" />
        </div>

        <div v-else-if="!pay || !pay.rows.length" class="empty">
          <div class="empty-title">
            Rien à payer sur {{ scope === "YEAR" ? "cette année" : "ce mois" }}
          </div>
          <div>Aucun contrat en cours sur cette période.</div>
        </div>

        <template v-else>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Personne</th>
                  <th class="c-text">Base</th>
                  <th class="c-num">Prévu</th>
                  <th class="c-num">Retenu</th>
                  <th class="c-num">À payer</th>
                  <th class="c-num">Coût école</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in pay.rows" :key="r.employmentId">
                  <td class="c-name">
                    <span class="cell-strong">{{ r.lastName.toUpperCase() }} {{ r.firstName }}</span>
                    <span class="cell-sub">{{ TYPE_FR[r.type] }}</span>
                  </td>
                  <td class="c-text">
                    {{ r.payBasis === "HOURLY" ? `${xaf(r.rateXaf)} / heure` : "Salaire mensuel" }}
                    <span v-if="r.payBasis === 'HOURLY'" class="cell-sub">
                      {{ BASIS_FR[r.hoursBasis] }}<template v-if="r.draftSlots">
                        · {{ r.draftSlots }} créneau(x) non publié(s)</template>
                    </span>
                  </td>
                  <td class="c-num">{{ hours(r.plannedMinutes) }}</td>
                  <td class="c-num">
                    {{ hours(r.payableMinutes) }}
                    <!-- The adjustment spelled out: a teacher asking why the
                         figure moved should read the answer, not ask twice. -->
                    <span v-if="r.cancelledMinutes || r.extraMinutes" class="cell-sub">
                      <template v-if="r.cancelledMinutes">− {{ hours(r.cancelledMinutes) }} annulé</template>
                      <template v-if="r.cancelledMinutes && r.extraMinutes"> · </template>
                      <template v-if="r.extraMinutes">+ {{ hours(r.extraMinutes) }} en plus</template>
                    </span>
                  </td>
                  <td class="c-num">{{ xaf(r.payXaf) }}</td>
                  <td class="c-num">{{ xaf(r.costXaf) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="c-name">
                    <span class="cell-strong">Total</span>
                    <span class="cell-sub">dont {{ chargePct }} de charges patronales</span>
                  </td>
                  <td class="c-text" /><td class="c-num" /><td class="c-num" />
                  <td class="c-num"><span class="cell-strong">{{ xaf(payTotal) }}</span></td>
                  <td class="c-num"><span class="cell-strong">{{ xaf(costTotal) }}</span></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Why a total is lower than the office expects, and which screen
               fixes it. The API writes these; the page only shows them. -->
          <div v-if="pay.notes.length" class="card-body">
            <p v-for="(n, i) in pay.notes" :key="i" class="verify-sub" style="margin: 0 0 4px">
              {{ n }}
            </p>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* The running total under the amount field — a consequence, not a form field,
   so it is set apart from the inputs rather than looking like another one. */
.cost-note {
  margin: calc(var(--s2) * -1) 0 var(--s4);
  padding: var(--s3);
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
}
.cost-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s3);
  margin-bottom: var(--s1);
}
.cost-line strong {
  font-size: var(--t-body);
  font-variant-numeric: tabular-nums;
}
.cost-line .muted {
  color: var(--ink-3);
  font-weight: 500;
}
.pay-scope {
  display: flex;
  align-items: center;
  gap: var(--s2);
}
</style>
