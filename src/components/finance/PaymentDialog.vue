<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
}>();
const emit = defineEmits<{
  close: [];
  /** The payment landed — the caller reloads and offers the receipt. */
  recorded: [{ paymentId: string; receiptNumber: string; remainingXaf: number }];
}>();

const amount = ref("");
const method = ref<api.PaymentMethod>("CASH");
const reference = ref("");
const working = ref(false);
const error = ref<string | null>(null);

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
      ...(NEEDS_REFERENCE.includes(method.value) && reference.value.trim()
        ? { reference: reference.value.trim() }
        : {}),
    });
    emit("recorded", {
      paymentId: res.payment.id,
      receiptNumber: res.receipt.number,
      remainingXaf: res.invoice.balanceXaf,
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
