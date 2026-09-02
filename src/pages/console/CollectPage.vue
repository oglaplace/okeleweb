<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import PaymentDialog from "../../components/finance/PaymentDialog.vue";
import ReceiptSheet from "../../components/finance/ReceiptSheet.vue";

/**
 * LE GUICHET — take money from whoever is standing at the counter.
 *
 * Deliberately NOT the impayés list, which is where this used to point. Those
 * are two different jobs and they answer to two different people:
 *
 *   Impayés   — a state of the world. Who is behind, by how much, since when.
 *               Read by whoever chases debts, worked through top to bottom.
 *   Encaisser — an act. A parent is here with money. It may be an inscription
 *               for a child who owes nothing yet, a réinscription, a tranche of
 *               scolarité, or the exam fee. None of those people need be on a
 *               debtor list, and the commonest of them — the family paying in
 *               advance — never is.
 *
 * So this screen starts from the search box rather than from a list of debts,
 * and every enrolled pupil is findable whatever their balance.
 */
const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const rows = ref<api.Payable[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const query = ref("");

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;

onMounted(async () => {
  try {
    years.value = await api.academics.years();
    yearId.value = (years.value.find((y) => y.isCurrent) ?? years.value[0])?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Années scolaires indisponibles.";
    loading.value = false;
  }
});

async function load() {
  if (!yearId.value) return;
  loading.value = true;
  error.value = null;
  try {
    rows.value = await api.finance.payable(yearId.value, query.value.trim() || undefined);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Liste indisponible.";
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
watch(yearId, load);

/**
 * The search runs on the server, so it is debounced.
 *
 * A key per request would be one round trip per letter over a Congolese mobile
 * link, which is slower than not searching at all.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
watch(query, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(load, 280);
});

const paying = ref<api.Payable | null>(null);
const receipt = ref<api.ReceiptDoc | null>(null);

async function onRecorded(res: {
  paymentId: string; receiptNumber: string; remainingXaf: number; unallocated: boolean;
}) {
  const who = paying.value;
  paying.value = null;
  notice.value = res.unallocated
    ? `${who?.lastName} ${who?.firstName} · reçu ${res.receiptNumber} · avance portée au crédit.`
    : res.remainingXaf > 0
      ? `${who?.lastName} ${who?.firstName} · reçu ${res.receiptNumber} · reste ${money(res.remainingXaf)}.`
      : `${who?.lastName} ${who?.firstName} · reçu ${res.receiptNumber} · solde réglé.`;
  await load();
  try {
    receipt.value = await api.finance.receipt(res.paymentId);
  } catch {
    // The money is recorded. A receipt that will not open is a smaller problem
    // than a banner claiming the payment failed.
  }
}

async function printReceipt() {
  const doc = receipt.value;
  if (!doc) return;
  window.print();
  try {
    await api.finance.markReceiptPrinted(doc.receipt.id);
  } catch {
    /* see StudentFinancePage.printReceipt */
  }
}

/** What the row's figure means, in one word, without asking for a legend. */
function stateOf(r: api.Payable) {
  if (r.advanceXaf > 0 && !r.hasInvoice) return { label: "Avance au crédit", cls: "is-credit" };
  if (!r.hasInvoice) return { label: "Pas encore facturé", cls: "is-none" };
  if (r.balanceXaf <= 0) return { label: "À jour", cls: "is-clear" };
  return { label: money(r.balanceXaf), cls: "is-due" };
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Encaisser un paiement</h1>
        <div class="page-sub">
          Inscription, réinscription, scolarité, frais d'examen — pour n'importe
          quel élève inscrit, qu'il doive quelque chose ou non.
        </div>
      </div>
      <div class="page-actions">
        <label class="sheet-pick">
          <span>Année</span>
          <select v-model="yearId" aria-label="Année scolaire">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
        <RouterLink class="btn" :to="{ name: 'unpaid' }">Voir les impayés</RouterLink>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" @close="error = null">{{ error }}</Alert>

    <div class="card">
      <div class="card-head unpaid-tools">
        <!-- The search IS the navigation: a guichet needs to find one child,
             not to page through nine hundred. -->
        <input
          v-model="query"
          class="unpaid-search"
          placeholder="Nom, prénom, matricule…"
          autofocus
        />
        <span class="hint">
          {{ query.trim() ? `${rows.length} résultat(s)` : "Les élèves les plus récents" }}
        </span>
      </div>

      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
      </div>

      <div v-else-if="!rows.length" class="empty">
        <div class="empty-title">
          {{ query.trim() ? "Aucun élève ne correspond" : "Aucun élève inscrit" }}
        </div>
        <div v-if="!query.trim()">Inscrivez un élève avant d'encaisser un paiement.</div>
      </div>

      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Élève</th>
              <th class="c-text">Classe</th>
              <th class="c-num">Facturé</th>
              <th class="c-num">Réglé</th>
              <th class="c-text">Situation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.studentId">
              <td class="c-name">
                <RouterLink
                  class="cell-strong"
                  :to="{
                    name: 'student-finance',
                    params: { id: r.studentId },
                    query: { year: yearId ?? undefined },
                  }"
                >{{ r.lastName.toUpperCase() }} {{ r.firstName }}</RouterLink>
                <span class="cell-sub">{{ r.matricule }}</span>
              </td>
              <td class="c-text">{{ r.classe.name }}</td>
              <td class="c-num">{{ r.hasInvoice ? money(r.billedXaf) : "—" }}</td>
              <td class="c-num">{{ money(r.paidXaf + r.advanceXaf) }}</td>
              <td class="c-text">
                <span class="tranche-tag" :class="stateOf(r).cls">{{ stateOf(r).label }}</span>
              </td>
              <td>
                <button class="btn sm primary" type="button" @click="paying = r">
                  Encaisser
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <PaymentDialog
      v-if="paying && yearId"
      :student-id="paying.studentId"
      :student-name="`${paying.lastName.toUpperCase()} ${paying.firstName}`"
      :academic-year-id="yearId"
      :balance-xaf="paying.balanceXaf"
      :needs-invoice="!paying.hasInvoice"
      @close="paying = null"
      @recorded="onRecorded"
    />

    <div v-if="receipt" class="scrim receipt-stage" @click.self="receipt = null">
      <div class="scrim-card dialog receipt-modal" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <div class="dialog-title"><span>Reçu {{ receipt.receipt.number }}</span></div>
          <div class="receipt-acts">
            <button class="btn sm primary" type="button" @click="printReceipt">Imprimer / PDF</button>
            <button class="btn sm ghost" type="button" @click="receipt = null">Fermer</button>
          </div>
        </div>
        <div class="dialog-body">
          <ReceiptSheet :doc="receipt" />
        </div>
      </div>
    </div>
  </div>
</template>
