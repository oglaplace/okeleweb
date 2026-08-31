<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import Icon from "../../components/ui/Icon.vue";
import Alert from "../../components/ui/Alert.vue";

/**
 * ONE PUPIL'S BULLETIN — the document, not a screen about it.
 *
 * Everything else in this console is a tool; this is a thing a school prints,
 * signs and hands to a family, and it is read by people who have never used
 * the software. So it is laid out as the paper it will become: the
 * établissement at the top, the pupil under it, one line per subject with its
 * coefficient and the class average beside the mark, and the moyenne, the rang
 * and the mention where a Congolese bulletin puts them.
 *
 * PROVISIONAL is stated, loudly, when the conseil has not sat. The same numbers
 * the council will look at are worth showing during the week they are being
 * argued about — but a provisional bulletin that does not say so is a document
 * a parent will keep and quote back.
 */
const route = useRoute();
const router = useRouter();

const studentId = computed(() => String(route.params.id));
const bulletin = ref<api.Bulletin | null>(null);
const periodId = ref<string | null>(
  typeof route.query.period === "string" ? route.query.period : null,
);
const loading = ref(true);
const error = ref<string | null>(null);

/** Every période of the year — the API sends it with the document. */
const periods = computed(() => bulletin.value?.calendar ?? []);

/** Where the operator came from, so "retour" means the class they were in. */
const backTo = computed(() =>
  typeof route.query.from === "string" && route.query.from
    ? { name: "unit" as const, params: { id: route.query.from }, query: { tab: "grades" } }
    : null,
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    /*
     * The période is optional in the URL and the API resolves it.
     *
     * A bulletin link that must carry a période id is a link nobody can type,
     * and the server is the only party that knows which périodes this pupil's
     * classe has — they hang off the cycle above it, not off the pupil.
     */
    const doc = await api.grading.bulletin(studentId.value, periodId.value);
    bulletin.value = doc;
    periodId.value = doc.period.id;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Bulletin indisponible.";
    bulletin.value = null;
  } finally {
    loading.value = false;
  }
}
watch([studentId, periodId], load, { immediate: true });

const fullName = computed(() =>
  bulletin.value
    ? `${bulletin.value.student.lastName.toUpperCase()} ${bulletin.value.student.firstName}`
    : "",
);

const num = (v: string | null, digits = 2) =>
  v === null || v === "" ? "—" : Number(v).toFixed(digits);
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

/** Coefficient × note — the column a parent recomputes by hand. */
const weighted = (score: string | null, coefficient: string) =>
  score === null ? null : Number(score) * Number(coefficient);

const totals = computed(() => {
  const lines = bulletin.value?.lines ?? [];
  const coefficients = lines.reduce((sum, l) => sum + Number(l.coefficient), 0);
  const points = lines.reduce((sum, l) => sum + (weighted(l.score, l.coefficient) ?? 0), 0);
  return { coefficients, points };
});

/** A mark below the pass threshold is the one a conseil stops on. */
const isWeak = (score: string | null) =>
  score !== null &&
  bulletin.value !== null &&
  Number(score) < Number(bulletin.value.gradingSystem.passThreshold);

/** The browser's own print dialogue — the page is styled for paper below. */
const print = () => window.print();

const DECISIONS: Record<string, string> = {
  ADMIS: "Admis(e)",
  ADMIS_SOUS_CONDITION: "Admis(e) sous condition",
  REDOUBLE: "Redouble",
  EXCLU: "Exclu(e)",
  RATTRAPAGE: "Rattrapage",
  EN_ATTENTE: "En attente",
};
</script>

<template>
  <div class="bulletin-page">
    <!-- Screen chrome. None of it prints — see the @media print rules. -->
    <div class="bulletin-bar">
      <RouterLink v-if="backTo" class="btn sm ghost" :to="backTo">← Retour à la classe</RouterLink>
      <button v-else class="btn sm ghost" type="button" @click="router.back()">← Retour</button>

      <label v-if="periods.length > 1" class="sheet-pick">
        <span>Période</span>
        <select v-model="periodId" aria-label="Période">
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>

      <div class="sheet-bar-fill" />
      <button class="btn sm" type="button" :disabled="!bulletin" @click="print()">
        <Icon name="fileText" :size="14" /> Imprimer
      </button>
    </div>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <!-- The load failed: this banner is the whole page, so it has no
         close button — there is nothing behind it to reveal. -->
    <Alert v-else-if="error" :closable="false">{{ error }}</Alert>

    <article v-else-if="bulletin" class="bulletin" :class="{ 'is-draft': bulletin.status === 'PROVISIONAL' }">
      <!--
        The header a ministry inspecting this looks for, in the order it looks:
        complex, école, cycle. Missing levels simply do not print.
      -->
      <header class="bulletin-head">
        <div class="bulletin-org">
          <div class="bulletin-complex">{{ bulletin.establishment.complex }}</div>
          <div v-if="bulletin.establishment.school" class="bulletin-school">
            {{ bulletin.establishment.school }}
          </div>
          <div v-if="bulletin.establishment.department" class="bulletin-dept">
            {{ bulletin.establishment.department }}
          </div>
        </div>
        <div class="bulletin-title">
          <h1>Bulletin de notes</h1>
          <div class="bulletin-period">
            {{ bulletin.period.label }} · Année scolaire {{ bulletin.year.label }}
          </div>
          <div v-if="bulletin.status === 'PROVISIONAL'" class="bulletin-stamp">
            Provisoire — avant conseil de classe
          </div>
          <div v-else class="bulletin-issued">
            Délivré le {{ day(bulletin.issuedAt) }}<template v-if="(bulletin.version ?? 1) > 1">
              · version {{ bulletin.version }}</template>
          </div>
        </div>
      </header>

      <!-- Who this is about. A bulletin is identified by matricule, not name:
           two Makaya Josué in the same collège is a Tuesday. -->
      <section class="bulletin-id">
        <div><span>Élève</span><strong>{{ fullName }}</strong></div>
        <div><span>Matricule</span><strong>{{ bulletin.student.matricule }}</strong></div>
        <div><span>Classe</span><strong>{{ bulletin.establishment.classe }}</strong></div>
        <div v-if="bulletin.student.serie"><span>Série</span><strong>{{ bulletin.student.serie }}</strong></div>
        <div><span>Né(e) le</span><strong>{{ day(bulletin.student.birthDate) }}</strong></div>
        <div v-if="bulletin.student.birthPlace"><span>À</span><strong>{{ bulletin.student.birthPlace }}</strong></div>
        <div><span>Effectif</span><strong>{{ bulletin.rankOf ?? "—" }}</strong></div>
        <div v-if="bulletin.student.isRepeating"><span>Statut</span><strong>Redoublant(e)</strong></div>
      </section>

      <!-- The body: one line per subject, and the arithmetic left visible. -->
      <table class="bulletin-marks">
        <thead>
          <tr>
            <th class="c-subject">Matière</th>
            <th>Coef.</th>
            <th>Note /{{ bulletin.gradingSystem.scaleMax }}</th>
            <!-- "Points" rather than "note × coefficient": it is the term on
                 every Congolese bulletin, and it fits the column. -->
            <th>Points</th>
            <th>Moy. cl.</th>
            <th>Rang</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="line in bulletin.lines"
            :key="line.subjectCode"
            :class="{ 'is-eliminated': line.isEliminated }"
          >
            <td class="c-subject">
              {{ line.subjectName }}
              <span v-if="line.isCompensated" class="bulletin-flag" title="Compensée">c</span>
            </td>
            <td>{{ Number(line.coefficient) }}</td>
            <td :class="{ 'is-weak': isWeak(line.score) }">{{ num(line.score) }}</td>
            <td>{{ weighted(line.score, line.coefficient)?.toFixed(2) ?? "—" }}</td>
            <td>{{ num(line.classAvg) }}</td>
            <td>{{ line.rank ?? "—" }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="c-subject">Total</td>
            <td>{{ totals.coefficients }}</td>
            <td />
            <td>{{ totals.points.toFixed(2) }}</td>
            <td colspan="2" />
          </tr>
        </tfoot>
      </table>

      <!-- The three numbers everyone actually reads, given room to be read. -->
      <section class="bulletin-result">
        <div class="bulletin-figure is-lead">
          <span>Moyenne</span>
          <strong>{{ num(bulletin.average) }}<small>/{{ bulletin.gradingSystem.scaleMax }}</small></strong>
        </div>
        <div class="bulletin-figure">
          <span>Rang</span>
          <strong>{{ bulletin.rank ?? "—" }}<small v-if="bulletin.rankOf">/{{ bulletin.rankOf }}</small></strong>
        </div>
        <div class="bulletin-figure">
          <span>Mention</span>
          <strong>{{ bulletin.mention ?? "—" }}</strong>
        </div>
        <div class="bulletin-figure">
          <span>Moy. classe</span>
          <strong>{{ num(bulletin.classAvg) }}</strong>
        </div>
        <div class="bulletin-figure">
          <span>Extrêmes</span>
          <strong>{{ num(bulletin.classMin) }} – {{ num(bulletin.classMax) }}</strong>
        </div>
        <div class="bulletin-figure">
          <span>Absences</span>
          <strong>
            {{ bulletin.absenceHours ? `${Number(bulletin.absenceHours).toFixed(0)} h` : "—" }}
            <small v-if="bulletin.lateCount">· {{ bulletin.lateCount }} retard(s)</small>
          </strong>
        </div>
      </section>

      <section v-if="bulletin.appreciation || bulletin.decision" class="bulletin-words">
        <div v-if="bulletin.appreciation">
          <span>Appréciation du conseil</span>
          <p>{{ bulletin.appreciation }}</p>
        </div>
        <div v-if="bulletin.decision">
          <span>Décision</span>
          <p>
            <strong>{{ DECISIONS[bulletin.decision.kind] ?? bulletin.decision.kind }}</strong>
            <template v-if="bulletin.decision.note"> — {{ bulletin.decision.note }}</template>
          </p>
        </div>
      </section>

      <!-- Signature blocks. A bulletin nobody signed is a printout. -->
      <footer class="bulletin-sign">
        <div><span>Le titulaire</span></div>
        <div><span>Le chef d'établissement</span></div>
        <div><span>Le parent / tuteur</span></div>
      </footer>
    </article>
  </div>
</template>
