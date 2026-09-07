<script setup lang="ts">
import { computed } from "vue";
import type { MarkSheet } from "../../lib/api";
import QrCode from "../ui/QrCode.vue";

/**
 * One bulletin — the document the whole system exists to produce.
 *
 * Laid out to match a Congolese secondary bulletin block for block: en-tête,
 * identité, corps par matière, totaux, assiduité, conseil de classe, pied. A
 * director compares it against the paper form they already use, so the field
 * names are theirs, not ours.
 *
 * It renders from the FROZEN snapshot: every coefficient shown was copied onto
 * the line at issue, so editing the grid later cannot alter a document already
 * handed to a parent.
 */
const props = defineProps<{
  sheet: MarkSheet;
  /** Établissement name, resolved from the classe's ancestors by the page. */
  schoolName?: string | null;
}>();

const p = computed(() => props.sheet.student.person);

const fullName = computed(() => `${p.value.lastName.toUpperCase()} ${p.value.firstName}`);

const born = computed(() => {
  if (!p.value.birthDate) return "—";
  const d = new Date(p.value.birthDate).toLocaleDateString("fr-FR");
  return p.value.birthPlace ? `${d} à ${p.value.birthPlace}` : d;
});

/** The meeting that validated this document, when it was frozen by one. */
const council = computed(() => props.sheet.councilSession ?? null);

const heldAt = computed(() =>
  council.value?.heldAt
    ? new Date(council.value.heldAt).toLocaleDateString("fr-FR", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null,
);

/** Short enough to be read out at a counter, long enough to be unambiguous. */
const councilRef = computed(() => (council.value?.id ?? "").slice(-8).toUpperCase());

/*
 * WHAT THE QR ENCODES: the public verification page for this exact document.
 *
 * Same origin as the console, so a school on an edge box prints a code that
 * resolves on its own network — see PublicBulletinPage and the /b/:token route.
 */
const verifyUrl = computed(() =>
  props.sheet.publicToken && props.sheet.status === "ISSUED"
    ? `${window.location.origin}/b/${props.sheet.publicToken}`
    : null,
);
const verifyHost = computed(() => window.location.host);

const num = (v: string | null | undefined, dp = 2) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(dp);

/** moyenne × coefficient, the column a parent adds up by hand to check us. */
const points = (score: string | null, coef: string) =>
  score === null ? "—" : (Number(score) * Number(coef)).toFixed(2);

const totalCoef = computed(() =>
  props.sheet.lines.reduce((sum, l) => sum + Number(l.coefficient), 0),
);

const totalPoints = computed(() =>
  props.sheet.lines.reduce(
    (sum, l) => sum + (l.score === null ? 0 : Number(l.score) * Number(l.coefficient)),
    0,
  ),
);

const issued = computed(() =>
  props.sheet.issuedAt ? new Date(props.sheet.issuedAt).toLocaleDateString("fr-FR") : "—",
);
</script>

<template>
  <article class="bulletin">
    <!-- ── en-tête ── -->
    <header class="bl-head">
      <div class="bl-school">{{ schoolName ?? "Établissement" }}</div>
      <div class="bl-title">Bulletin de notes</div>
      <div class="bl-term">
        Année scolaire {{ sheet.academicYear.label }} — {{ sheet.period?.label ?? "Année" }}
      </div>
    </header>

    <!-- ── identité ── -->
    <section class="bl-id">
      <div><span class="bl-lab">Élève</span> <strong>{{ fullName }}</strong></div>
      <div><span class="bl-lab">Matricule</span> {{ sheet.student.matricule }}</div>
      <div><span class="bl-lab">Classe</span> {{ sheet.classe.name }}</div>
      <div><span class="bl-lab">Né(e) le</span> {{ born }}</div>
    </section>

    <!-- ── corps ── -->
    <table class="bl-table">
      <thead>
        <tr>
          <th class="bl-n">N°</th>
          <th>Matière</th>
          <th class="bl-num">Coef</th>
          <th class="bl-num">Moyenne</th>
          <th class="bl-num">Moy × Coef</th>
          <th class="bl-num">Moy. classe</th>
          <th class="bl-num">Rang</th>
          <th>Appréciation</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(line, i) in sheet.lines" :key="line.id">
          <td class="bl-n">{{ i + 1 }}</td>
          <td>
            {{ line.courseOffering.subject.name }}
            <!-- Flagged on the document, not just in the data: a compensated or
                 eliminated subject is exactly what a parent will ask about. -->
            <span v-if="line.isEliminated" class="bl-flag bl-elim">éliminatoire</span>
            <span v-else-if="line.isCompensated" class="bl-flag">compensée</span>
          </td>
          <td class="bl-num">{{ Number(line.coefficient) }}</td>
          <td class="bl-num">{{ num(line.score) }}</td>
          <td class="bl-num">{{ points(line.score, line.coefficient) }}</td>
          <td class="bl-num">{{ num(line.classAvg) }}</td>
          <td class="bl-num">{{ line.rank ?? "—" }}</td>
          <td class="bl-app">{{ line.appreciation ?? "" }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Totaux</td>
          <td class="bl-num">{{ totalCoef }}</td>
          <td class="bl-num">—</td>
          <td class="bl-num">{{ totalPoints.toFixed(2) }}</td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table>

    <!-- ── synthèse ── -->
    <section class="bl-grid">
      <div class="bl-box bl-main">
        <div class="bl-lab">Moyenne générale</div>
        <div class="bl-big">{{ num(sheet.average) }}<span class="bl-of"> / 20</span></div>
        <div class="bl-sub">Mention : {{ sheet.mention ?? "—" }}</div>
      </div>
      <div class="bl-box">
        <div class="bl-lab">Rang</div>
        <div class="bl-big">{{ sheet.rank ?? "—" }}<span class="bl-of"> / {{ sheet.rankOf ?? "—" }}</span></div>
      </div>
      <div class="bl-box">
        <div class="bl-lab">La classe</div>
        <div class="bl-row"><span>Moyenne</span><b>{{ num(sheet.classAvg) }}</b></div>
        <div class="bl-row"><span>Plus forte</span><b>{{ num(sheet.classMax) }}</b></div>
        <div class="bl-row"><span>Plus faible</span><b>{{ num(sheet.classMin) }}</b></div>
      </div>
      <div class="bl-box">
        <div class="bl-lab">Assiduité</div>
        <div class="bl-row"><span>Absences</span><b>{{ num(sheet.absenceHours, 1) }} h</b></div>
        <div class="bl-row"><span>Retards</span><b>{{ sheet.lateCount ?? 0 }}</b></div>
      </div>
    </section>

    <!-- ── conseil de classe ── -->
    <section class="bl-council">
      <div class="bl-lab">Appréciation du conseil de classe</div>
      <div class="bl-appgen">{{ sheet.appreciation || " " }}</div>
    </section>

    <!-- ── pied ── -->
    <footer class="bl-foot">
      <div>
        Édité le {{ issued }}
        <!-- The version number belongs on the page: two sheets with the same
             header and different numbers, with nothing to order them, is the
             dispute the audit trail exists to settle. -->
        · <strong>version {{ sheet.version }}</strong>
        <span v-if="sheet.version > 1 && sheet.reason"> — {{ sheet.reason }}</span>
        <!--
          LA SÉANCE QUI L'A VALIDÉ.

          A bulletin's authority is not its arithmetic — anybody can redo that —
          it is that a conseil de classe sat and froze it. The reference is
          short on purpose: it is what a parent quotes at the secretariat, and
          it is the row the procès-verbal is filed under.
        -->
        <div v-if="council" class="bl-council-ref">
          Conseil de classe<template v-if="council.heldAt"> du {{ heldAt }}</template>
          · réf. {{ councilRef }}
        </div>
      </div>
      <div class="bl-sign">
        <span>Le chef d'établissement</span>
        <span>Le tuteur</span>
      </div>
      <!--
        The code that makes the paper checkable, on the paper itself.

        A bulletin travels to another school, an employer, a ministry — readers
        who cannot sign in here and for whom an edited PDF looks exactly like
        the original. Scanning opens the document the school actually issued.
        ISSUED only: a QR on a draft would claim authenticity for a draft.
      -->
      <div v-if="verifyUrl" class="bl-qr">
        <QrCode :value="verifyUrl" :size="72" label="Vérifier ce bulletin" />
        <span>Vérifier<br /><span class="bl-qr-url">{{ verifyHost }}</span></span>
      </div>
    </footer>
  </article>
</template>
