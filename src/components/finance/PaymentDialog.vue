<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../ui/Alert.vue";
import DialogShell from "../ui/DialogShell.vue";

/**
 * ENREGISTRER UN PAIEMENT — the guichet, as a form.
 *
 * Opened over whatever names the pupil, never reached from a menu. A payment is
 * always FOR somebody, and a screen that opens by asking which facture sends
 * the operator away to look up a number nobody in the queue knows. The pupil
 * and the year come in as props; the API finds the facture.
 *
 * The amount is the only required field. The method defaults to CASH because
 * that is still most of what crosses a counter in Brazzaville, and the
 * reference appears only for the methods that have one — a MoMo transaction id
 * is worth recording, a "reference" for cash is a box nobody fills.
 */
const props = defineProps<{
  studentId: string;
  studentName: string;
  academicYearId: string;
  /** What is still owed, so the form can offer it as the amount. */
  balanceXaf: number;
  /**
   * True when this pupil has no facture yet.
   *
   * Not a blocker — the API issues one itself when a grille applies, and books
   * an avance when none does. It is said here so the operator is not surprised
   * by what the receipt says afterwards.
   */
  needsInvoice?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  /** The payment landed — the caller reloads and offers the receipt. */
  recorded: [{
    paymentId: string;
    receiptNumber: string;
    remainingXaf: number;
    /** No facture behind it — the money is held as an avance. */
    unallocated: boolean;
  }];
}>();

const amount = ref("");
const method = ref<api.PaymentMethod>("CASH");
const reference = ref("");
const working = ref(false);
const error = ref<string | null>(null);

/**
 * WHAT THE MONEY IS FOR.
 *
 * Driven by the fee types the complex declared — inscription, réinscription,
 * scolarité, frais d'examen — rather than a free-text box, because those are
 * exactly the things it has already said it charges for, and a receipt naming
 * one can be reconciled against the grille. A school that needs another motif
 * adds a fee type; that is the system working rather than being worked around.
 */
const feeTypes = ref<{ id: string; name: string }[]>([]);
const feeTypeId = ref("");
/**
 * The escape hatch, and why it is not just another option.
 *
 * Every catalogued reason is a FeeType and reconciles against the grille. This
 * one is for the reason nobody planned — a lost card, a fine, a contribution —
 * and it takes the operator's own words. Without it the honest choices are to
 * record nothing or to pick the nearest wrong option, which then reconciles
 * against the wrong line.
 */
const OTHER = "__other__";
const purposeNote = ref("");

onMounted(async () => {
  // Optional to the point of invisible: if this fails, the payment still goes
  // through with no motif, which is exactly what happened before the field
  // existed.
  feeTypes.value = await api.finance.feeTypes().catch(() => []);
});

/** Only these carry one; the rest would print an empty box on every slip. */
const NEEDS_REFERENCE: api.PaymentMethod[] = ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER", "CHEQUE"];
const REFERENCE_LABEL: Partial<Record<api.PaymentMethod, string>> = {
  MTN_MOMO: "N° de transaction MoMo",
  AIRTEL_MONEY: "N° de transaction Airtel",
  BANK_TRANSFER: "Référence du virement",
  CHEQUE: "N° du chèque",
};

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;

/** Digits only: a thousands separator typed by hand must not become an amount. */
const parsed = computed(() => Number(amount.value.replace(/\D/g, "")) || 0);
const canSubmit = computed(() => parsed.value > 0 && !working.value);

/** What this payment would leave, stated before the money is taken. */
const after = computed(() => props.balanceXaf - parsed.value);

watch(
  () => props.studentId,
  () => {
    amount.value = "";
    reference.value = "";
    error.value = null;
  },
);

async function submit() {
  if (!canSubmit.value) return;
  working.value = true;
  error.value = null;
  try {
    const res = await api.finance.recordPayment({
      studentId: props.studentId,
      academicYearId: props.academicYearId,
      amountXaf: parsed.value,
      method: method.value,
      ...(feeTypeId.value && feeTypeId.value !== OTHER
        ? { feeTypeId: feeTypeId.value }
        : {}),
      ...(feeTypeId.value === OTHER && purposeNote.value.trim()
        ? { purposeNote: purposeNote.value.trim() }
        : {}),
      ...(NEEDS_REFERENCE.includes(method.value) && reference.value.trim()
        ? { reference: reference.value.trim() }
        : {}),
    });
    emit("recorded", {
      paymentId: res.payment.id,
      receiptNumber: res.receipt.number,
      remainingXaf: res.invoice.balanceXaf,
      unallocated: res.unallocated,
    });
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <DialogShell
    title="Enregistrer un paiement"
    :subtitle="studentName"
    :detail="`Reste à payer : ${money(balanceXaf)}`"
    icon="receipt"
    @close="emit('close')"
  >
    <form class="stack" @submit.prevent="submit">
      <Alert v-if="error" @close="error = null">{{ error }}</Alert>

      <!--
        Said before the money is taken, not discovered afterwards on the slip.
        The payment goes through either way: the API issues the facture when a
        grille applies, and holds the money as an avance when none does.
      -->
      <Alert v-if="needsInvoice" kind="warn" :closable="false">
        Aucune facture n'existe encore pour cet élève. Le paiement sera enregistré
        et la facture émise automatiquement si une grille tarifaire s'applique —
        sinon la somme sera portée en avance sur sa scolarité.
      </Alert>

      <div class="field">
        <label for="pay-amt">Montant reçu (XAF)</label>
        <div class="pay-amount">
          <input id="pay-amt" v-model="amount" inputmode="numeric" autocomplete="off" />
          <!-- The commonest amount by far is "all of it", and typing 150000
               correctly with a queue waiting is how a digit goes missing. -->
          <button
            v-if="balanceXaf > 0"
            class="btn sm"
            type="button"
            @click="amount = String(balanceXaf)"
          >Solde · {{ money(balanceXaf) }}</button>
        </div>
        <span v-if="parsed > 0" class="hint">
          <template v-if="after > 0">Restera {{ money(after) }} à payer.</template>
          <template v-else-if="after === 0">Solde entièrement réglé.</template>
          <template v-else>Trop-perçu de {{ money(-after) }}, porté au crédit de l'élève.</template>
        </span>
      </div>

      <div v-if="feeTypes.length" class="field-row">
        <div class="field">
          <label for="pay-for">Motif</label>
          <select id="pay-for" v-model="feeTypeId">
            <option value="">Non précisé</option>
            <option v-for="f in feeTypes" :key="f.id" :value="f.id">{{ f.name }}</option>
            <option :value="OTHER">Autre…</option>
          </select>
          <span class="hint">Imprimé sur le reçu.</span>
        </div>
        <div v-if="feeTypeId === OTHER" class="field">
          <label for="pay-note">Préciser</label>
          <input
            id="pay-note"
            v-model="purposeNote"
            maxlength="120"
            autocomplete="off"
            placeholder="Remplacement de carte scolaire…"
          />
        </div>
      </div>

      <!-- A school that has declared nothing gets told where to declare it,
           rather than a silently missing field. -->
      <div v-else class="field">
        <label for="pay-note-only">Motif</label>
        <input
          id="pay-note-only"
          v-model="purposeNote"
          maxlength="120"
          autocomplete="off"
          placeholder="Scolarité, inscription…"
          @input="feeTypeId = OTHER"
        />
        <span class="hint">
          Aucun type de frais n'est encore défini.
          <RouterLink :to="{ name: 'tariffs' }">Les choisir dans la grille tarifaire</RouterLink>
          évite de le retaper à chaque encaissement.
        </span>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="pay-met">Moyen</label>
          <select id="pay-met" v-model="method">
            <option v-for="(label, value) in api.PAYMENT_METHOD_FR" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </div>
        <div v-if="NEEDS_REFERENCE.includes(method)" class="field">
          <label for="pay-ref">{{ REFERENCE_LABEL[method] }}</label>
          <input id="pay-ref" v-model="reference" autocomplete="off" />
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn primary" type="submit" :disabled="!canSubmit">
          <span v-if="working" class="btn-spin" aria-hidden="true" />
          {{ working ? "Enregistrement…" : "Enregistrer et éditer le reçu" }}
        </button>
      </div>
    </form>
  </DialogShell>
</template>
