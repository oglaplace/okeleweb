<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import PaymentDialog from "../../components/finance/PaymentDialog.vue";
import ReceiptSheet from "../../components/finance/ReceiptSheet.vue";

/**
 * IMPAYÉS — the worklist, not a report.
 *
 * The distinction matters. A report is read; a worklist is worked through, and
 * every row here has to carry what it takes to act on it: who owes, how much is
 * actually OVERDUE as opposed to merely outstanding, how many days late, and
 * the phone number of whoever pays. Without the number this is a list of names
 * to go and look up somewhere else, which is the work it was meant to remove.
 *
 * "Overdue" is measured against the modalité de paiement — the tranches the
 * school announced — not against the invoice total. A family on the trimestriel
 * plan who has paid the first tranche in October owes nothing yet, and putting
 * them on a chase list in October is how a school loses a parent's trust.
 *
 * Payment happens in place. Sending an économe to the pupil's page and back for
 * every row is the difference between clearing a list in ten minutes and not
 * clearing it.
 */
const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const data = ref<api.Unpaid | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const query = ref("");
const lateOnly = ref(false);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

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
    data.value = await api.finance.unpaid(yearId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Impayés indisponibles.";
    data.value = null;
  } finally {
    loading.value = false;
  }
}
watch(yearId, load);

const rows = computed(() => {
  const all = data.value?.rows ?? [];
  const q = query.value.trim().toLowerCase();
  return all.filter(
    (r) =>
      (!lateOnly.value || r.state === "LATE") &&
      (!q ||
        `${r.lastName} ${r.firstName} ${r.matricule} ${r.classe?.name ?? ""}`
          .toLowerCase()
          .includes(q)),
  );
});

/** What the filtered view actually adds up to — not the unfiltered totals. */
const shown = computed(() => ({
  count: rows.value.length,
  balanceXaf: rows.value.reduce((s, r) => s + r.balanceXaf, 0),
  lateXaf: rows.value.reduce((s, r) => s + r.overdueXaf, 0),
}));

// ── taking money, without leaving the list ──────────────────────────────────
const paying = ref<api.Unpaid["rows"][number] | null>(null);
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
    // The payment is recorded; a receipt that will not open is a smaller
    // problem than a banner claiming the payment failed.
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
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Impayés</h1>
        <div class="page-sub">
          Ce qui reste dû, du plus en retard au moins — mesuré sur la modalité de
          paiement de chaque classe, pas sur la facture entière.
        </div>
      </div>
      <div class="page-actions">
        <label class="sheet-pick">
          <span>Année</span>
          <select v-model="yearId" aria-label="Année scolaire">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else-if="data">
      <div class="dossier-figures" style="margin-bottom: var(--s4)">
        <div><span>Élèves concernés</span><strong>{{ shown.count }}</strong></div>
        <div><span>Reste dû</span><strong>{{ money(shown.balanceXaf) }}</strong></div>
        <div>
          <span>Dont en retard</span>
          <strong :class="{ 'is-warn': shown.lateXaf > 0 }">{{ money(shown.lateXaf) }}</strong>
        </div>
      </div>

      <div class="card">
        <div class="card-head unpaid-tools">
          <input v-model="query" class="unpaid-search" placeholder="Nom, matricule, classe…" />
          <!-- The default is everything outstanding. "En retard" is the
               narrower, sharper list, and it is a choice rather than the
               default because a school also chases what is merely due. -->
          <label class="unpaid-toggle">
            <input v-model="lateOnly" type="checkbox" />
            <span>En retard seulement</span>
          </label>
          <span class="hint">{{ rows.length }} / {{ data.rows.length }}</span>
        </div>

        <div v-if="!rows.length" class="empty">
          <div class="empty-title">
            {{ data.rows.length ? "Aucun élève ne correspond" : "Aucun impayé" }}
          </div>
          <div v-if="!data.rows.length">Toutes les factures émises sont soldées.</div>
        </div>

        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="c-name">Élève</th>
                <th class="c-text">Classe</th>
                <th class="c-text">À contacter</th>
                <th class="c-num">Reste dû</th>
                <th class="c-num">En retard</th>
                <th class="c-num">Jours</th>
                <th class="c-text">Dernier règlement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.invoiceId" :class="{ 'is-late': r.state === 'LATE' }">
                <td class="c-name">
                  <RouterLink
                    class="cell-strong"
                    :to="{ name: 'student-finance', params: { id: r.studentId }, query: { year: yearId ?? undefined } }"
                  >{{ r.lastName.toUpperCase() }} {{ r.firstName }}</RouterLink>
                  <span class="cell-sub">{{ r.matricule }} · {{ r.number }}</span>
                </td>
                <td class="c-text">{{ r.classe?.name ?? "—" }}</td>
                <td class="c-text">
                  <template v-if="r.guardianPhone">
                    <!-- A tel: link, because half the offices run this on a
                         phone and the other half on a laptop with a softphone. -->
                    <a :href="`tel:${r.guardianPhone}`">{{ r.guardianPhone }}</a>
                    <span class="cell-sub">{{ r.guardianName }}</span>
                  </template>
                  <span v-else class="cell-sub">Aucun tuteur payeur</span>
                </td>
                <td class="c-num">{{ money(r.balanceXaf) }}</td>
                <td class="c-num" :class="{ 'is-warn': r.overdueXaf > 0 }">
                  {{ r.overdueXaf > 0 ? money(r.overdueXaf) : "—" }}
                </td>
                <td class="c-num">{{ r.daysLate || "—" }}</td>
                <td class="c-text">
                  <template v-if="r.lastPaymentOn">
                    {{ day(r.lastPaymentOn) }}
                    <span class="cell-sub">{{ money(r.lastPaymentXaf ?? 0) }}</span>
                  </template>
                  <span v-else class="cell-sub">Jamais</span>
                </td>
                <td>
                  <button class="btn sm" type="button" @click="paying = r">Encaisser</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <PaymentDialog
      v-if="paying && yearId"
      :student-id="paying.studentId"
      :student-name="`${paying.lastName.toUpperCase()} ${paying.firstName}`"
      :academic-year-id="yearId"
      :balance-xaf="paying.balanceXaf"
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
