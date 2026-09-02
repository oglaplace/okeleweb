<script setup lang="ts">
import { computed } from "vue";
import * as api from "../../lib/api";

/**
 * THE REÇU — the slip the parent keeps and produces in a dispute.
 *
 * Every figure on it comes from the API. Not one is recomputed here, and that
 * is the whole design: "reste à payer" printed on paper and "reste à payer" on
 * the screen must be the same number, and the only way to guarantee that is for
 * there to be one place that works it out. A reprint in June still says what
 * was owed in October, because the API stored the event and not the current
 * total.
 *
 * On screen it is a card; in print it IS the document. The browser's print
 * dialog is also the PDF writer — nothing to install on the school's machine,
 * and identical behaviour on an edge box with no internet.
 */
const props = defineProps<{ doc: api.ReceiptDoc }>();

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} F CFA`;

const when = computed(() =>
  new Date(props.doc.payment.receivedAt).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  }),
);
const student = computed(() =>
  props.doc.student
    ? `${props.doc.student.lastName.toUpperCase()} ${props.doc.student.firstName}`
    : "—",
);
</script>

<template>
  <article class="receipt">
    <header class="receipt-head">
      <div>
        <div class="receipt-school">{{ doc.school.name }}</div>
        <div class="receipt-year" v-if="doc.year">Année scolaire {{ doc.year.label }}</div>
      </div>
      <div class="receipt-no">
        <div class="receipt-no-label">Reçu n°</div>
        <div class="receipt-no-value">{{ doc.receipt.number }}</div>
      </div>
    </header>

    <h1 class="receipt-title">Reçu de paiement</h1>

    <dl class="receipt-facts">
      <div><dt>Élève</dt><dd>{{ student }}</dd></div>
      <div v-if="doc.student?.matricule"><dt>Matricule</dt><dd>{{ doc.student.matricule }}</dd></div>
      <div v-if="doc.student?.classe"><dt>Classe</dt><dd>{{ doc.student.classe }}</dd></div>
      <div><dt>Date</dt><dd>{{ when }}</dd></div>
      <div><dt>Moyen</dt><dd>{{ api.PAYMENT_METHOD_FR[doc.payment.method] }}</dd></div>
      <div v-if="doc.payment.reference"><dt>Référence</dt><dd>{{ doc.payment.reference }}</dd></div>
      <div v-if="doc.invoice"><dt>Facture</dt><dd>{{ doc.invoice.number }}</dd></div>
    </dl>

    <!-- The figure, then the same figure in words. A number alone can be
         altered with a pen after the slip leaves the guichet; the pair cannot,
         which is why every carnet de reçus sold here has a line for each. -->
    <div class="receipt-amount">
      <div class="receipt-amount-fig">{{ money(doc.payment.amountXaf) }}</div>
      <div class="receipt-amount-words">{{ doc.payment.amountWords }}</div>
    </div>

    <table class="receipt-standing">
      <tbody>
        <tr><th>Total dû</th><td>{{ money(doc.standing.totalXaf) }}</td></tr>
        <tr><th>Versé à ce jour</th><td>{{ money(doc.standing.paidToDateXaf) }}</td></tr>
        <tr v-if="doc.standing.creditXaf > 0" class="is-credit">
          <th>Trop-perçu (crédit)</th><td>{{ money(doc.standing.creditXaf) }}</td>
        </tr>
        <tr v-else class="is-remaining">
          <th>Reste à payer</th><td>{{ money(doc.standing.remainingXaf) }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="receipt-foot">
      <div class="receipt-sign">
        <span>Le caissier</span>
        <span class="receipt-rule" aria-hidden="true" />
      </div>
      <div class="receipt-sign">
        <span>Le parent / tuteur</span>
        <span class="receipt-rule" aria-hidden="true" />
      </div>
    </footer>

    <!-- A reprint has to admit that it is one, or two copies of the same slip
         are indistinguishable and both can be presented as the original. -->
    <p v-if="doc.receipt.printCount > 0" class="receipt-dup">
      Duplicata — copie n° {{ doc.receipt.printCount + 1 }}
    </p>
  </article>
</template>
