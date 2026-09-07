<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import * as api from "../lib/api";

/**
 * THE BULLETIN AS THE SCHOOL ISSUED IT.
 *
 * Reached only by scanning the QR on a printed sheet — no account, no menu, no
 * way further in. Whoever holds the paper can put it next to this and see
 * whether the numbers are the ones the school signed; that is the whole
 * feature, because a PDF edited between the office and the reader is otherwise
 * indistinguishable from the original.
 *
 * Deliberately plain and deliberately read-only: no console chrome, nothing to
 * click, nothing that could be mistaken for a document that can be produced
 * here. This page is evidence, not a screen.
 */
const route = useRoute();
const doc = ref<api.PublicBulletin | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    doc.value = await api.publicApi.bulletin(String(route.params.token ?? ""));
  } catch (e) {
    error.value =
      e instanceof api.ApiError && e.status === 404
        ? "Aucun bulletin ne correspond à ce code."
        : "Vérification impossible pour le moment.";
  } finally {
    loading.value = false;
  }
});

const num = (v: string | null) => (v === null ? "—" : Number(v).toFixed(2).replace(".", ","));
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
</script>

<template>
  <div class="verify">
    <div v-if="loading" class="verify-card">
      <div class="skeleton" style="width: 45%" />
      <div class="skeleton" style="width: 70%" />
    </div>

    <div v-else-if="error" class="verify-card">
      <h1 class="verify-title">Bulletin non vérifié</h1>
      <p>{{ error }}</p>
      <p class="hint">
        Un code illisible ou modifié ne correspond à aucun document. Demandez à
        l'établissement une réimpression.
      </p>
    </div>

    <article v-else-if="doc" class="verify-card">
      <!-- Said first, because it is the only question this page answers. -->
      <div class="verify-badge">Document authentique</div>
      <h1 class="verify-title">
        {{ doc.establishment.complex ?? "Bulletin" }}
      </h1>
      <p class="verify-sub">
        <template v-if="doc.establishment.school">{{ doc.establishment.school }} · </template>
        {{ doc.establishment.classe }} · {{ doc.year }} · {{ doc.period }}
        <template v-if="doc.version > 1"> · version {{ doc.version }}</template>
      </p>

      <dl class="verify-id">
        <div><dt>Élève</dt><dd>{{ doc.student.lastName.toUpperCase() }} {{ doc.student.firstName }}</dd></div>
        <div><dt>Matricule</dt><dd>{{ doc.student.matricule }}</dd></div>
        <div><dt>Délivré le</dt><dd>{{ day(doc.issuedAt) }}</dd></div>
        <!-- The meeting behind the paper, for whoever is holding the paper. -->
        <div v-if="doc.council?.heldAt">
          <dt>Conseil de classe</dt><dd>{{ day(doc.council.heldAt) }}</dd>
        </div>
        <div><dt>Barème</dt><dd>{{ doc.gradingSystem.name }} / {{ doc.gradingSystem.scaleMax }}</dd></div>
      </dl>

      <table class="verify-table">
        <thead>
          <tr>
            <th>Matière</th><th class="c-num">Coef.</th><th class="c-num">Note</th>
            <th class="c-num">Moy. classe</th><th class="c-num">Rang</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in doc.lines" :key="l.subjectCode">
            <td>{{ l.subjectName }}</td>
            <td class="c-num">{{ num(l.coefficient) }}</td>
            <td class="c-num">{{ num(l.score) }}</td>
            <td class="c-num">{{ num(l.classAvg) }}</td>
            <td class="c-num">{{ l.rank ?? "—" }}</td>
          </tr>
        </tbody>
      </table>

      <dl class="verify-id verify-result">
        <div><dt>Moyenne</dt><dd class="verify-avg">{{ num(doc.average) }}</dd></div>
        <div v-if="doc.rank"><dt>Rang</dt><dd>{{ doc.rank }}<span v-if="doc.rankOf"> / {{ doc.rankOf }}</span></dd></div>
        <div v-if="doc.mention"><dt>Mention</dt><dd>{{ doc.mention }}</dd></div>
        <div v-if="doc.classAvg"><dt>Moyenne de la classe</dt><dd>{{ num(doc.classAvg) }}</dd></div>
      </dl>

      <p v-if="doc.appreciation" class="verify-note">{{ doc.appreciation }}</p>

      <p class="hint verify-foot">
        Ces chiffres sont ceux enregistrés par l'établissement au moment de la
        délivrance. Un bulletin imprimé qui ne correspond pas à cette page a été
        modifié.
      </p>
    </article>
  </div>
</template>
