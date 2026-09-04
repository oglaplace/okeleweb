<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import PaymentDialog from "../../components/finance/PaymentDialog.vue";
import ReceiptSheet from "../../components/finance/ReceiptSheet.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";

/**
 * ONE PUPIL'S MONEY — the échéancier, every règlement, and the reçus.
 *
 * The screen that is open while a parent stands at the guichet. It answers, in
 * this order: what was agreed (the tranches the modalité defines), what has
 * been paid against them, and what is left. Then the history, because the
 * argument at the counter is almost always about a payment already made.
 *
 * A receipt opens in place rather than on its own route. It is a document about
 * a payment on this page, and sending someone to a third screen to print it —
 * then back — is three navigations for one act.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const studentId = computed(() => String(route.params.id));
const yearParam = computed(() =>
  typeof route.query.year === "string" && route.query.year ? route.query.year : undefined,
);

const led = ref<api.StudentLedger | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    led.value = await api.finance.studentLedger(studentId.value, yearParam.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Situation financière indisponible.";
    led.value = null;
  } finally {
    loading.value = false;
  }
}
watch([studentId, yearParam], load, { immediate: true });

const backTo = computed(() =>
  typeof route.query.from === "string" && route.query.from
    ? { name: "unit" as const, params: { id: route.query.from }, query: { tab: "finances" } }
    : null,
);

const fullName = computed(() =>
  led.value ? `${led.value.student.lastName.toUpperCase()} ${led.value.student.firstName}` : "",
);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TRANCHE_FR: Record<api.TrancheState, string> = {
  PAID: "Soldée",
  PARTIAL: "Partielle",
  LATE: "En retard",
  DUE: "À venir",
  NONE: "—",
};

// ── taking money ────────────────────────────────────────────────────────────
const paying = ref(false);
const issuing = ref(false);

/**
 * Issue the facture, explicitly.
 *
 * A button rather than the only way in: taking a payment issues it too, so
 * nobody is ever BLOCKED on pressing this. It exists for the secretary who is
 * preparing the year rather than serving a queue — and because "générer la
 * facture" being invisible was the actual complaint.
 */
async function issueInvoice() {
  if (!led.value) return;
  issuing.value = true;
  error.value = null;
  try {
    const inv = await api.finance.issueInvoice(led.value.student.id, led.value.year.id);
    notice.value = `Facture ${inv.number} émise · ${money(inv.totalXaf)}.`;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Émission impossible.";
  } finally {
    issuing.value = false;
  }
}

async function onRecorded(res: {
  paymentId: string; receiptNumber: string; remainingXaf: number; unallocated: boolean;
}) {
  paying.value = false;
  // An avance is not a settled balance and must not be reported as one: there
  // is no facture, so "solde réglé" would be a claim about a total nobody has
  // worked out yet.
  notice.value = res.unallocated
    ? `Avance enregistrée · reçu ${res.receiptNumber} · portée au crédit de l'élève.`
    : res.remainingXaf > 0
      ? `Paiement enregistré · reçu ${res.receiptNumber} · reste ${money(res.remainingXaf)}.`
      : `Paiement enregistré · reçu ${res.receiptNumber} · solde réglé.`;
  await load();
  // Straight to the slip: the parent is still standing there, and the reason
  // they came is the piece of paper.
  await openReceipt(res.paymentId);
}

// ── bourses et réductions ───────────────────────────────────────────────────

/**
 * THE SCHOLARSHIP CONTROLS, on the page where the money is.
 *
 * The award model shipped last turn and had no UI at all, which made it
 * unusable: a bourse you cannot see is a bourse nobody trusts, and a total
 * below the grille with nothing explaining it reads as a mistake.
 *
 * Deliberately plain — pick a reduction, say why, apply. The people running
 * this have little experience of software, so there is one list and one
 * button, no wizard, and the consequence is stated in the sentence above the
 * button rather than discovered afterwards.
 */
const discounts = ref<api.Discount[]>([]);
const granting = ref(false);
const grantDiscountId = ref("");
const grantFeeTypeId = ref("");
const grantReason = ref("");
const grantBusy = ref(false);
const feeTypes = ref<{ id: string; name: string }[]>([]);

const canGrantWaiver = computed(() => auth.can("finance.admin"));

async function openGrant() {
  granting.value = true;
  grantDiscountId.value = "";
  grantFeeTypeId.value = "";
  grantReason.value = "";
  newName.value = "";
  newValue.value = "";
  newCap.value = "";
  [discounts.value, feeTypes.value] = await Promise.all([
    api.finance.discounts().catch(() => []),
    api.finance.feeTypes().catch(() => []),
  ]);
}

/**
 * Creating the rule from here.
 *
 * The award UI alone would have been a dead end: a school that has never
 * declared a "Bourse 50 %" opens this dialog, finds an empty list, and there is
 * nowhere in the console to fill it. Rather than sending them to another page
 * to define something and back to apply it, the rule is created where it is
 * first needed — it stays in the catalogue afterwards and is picked from the
 * list next time.
 */
const NEW = "__new";
const newName = ref("");
const newKind = ref<"PERCENT" | "AMOUNT">("PERCENT");
const newValue = ref("");
const newCap = ref("");
const makingNew = computed(() => grantDiscountId.value === NEW);

/** A code nobody has to think about, derived from what they typed. */
function codeFor(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return `${base || "REDUCTION"}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

/** What this reduction would take off, said before it is applied. */
const grantPreview = computed(() => {
  if (makingNew.value) {
    const v = Number(newValue.value);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (newKind.value === "AMOUNT") return `${money(Math.round(v))} par ligne`;
    return Number(newCap.value) > 0
      ? `${v} % — au plus ${money(Math.round(Number(newCap.value)))} par ligne`
      : `${v} % du montant`;
  }
  const d = discounts.value.find((x) => x.id === grantDiscountId.value);
  if (!d) return null;
  if (d.percentBps !== null) {
    const pct = d.percentBps / 100;
    return d.maxAmountXaf
      ? `${pct} % — au plus ${money(d.maxAmountXaf)} par ligne`
      : `${pct} % du montant`;
  }
  return d.amountXaf !== null ? `${money(d.amountXaf)} par ligne` : null;
});

async function grantWaiver() {
  if (!led.value || !grantDiscountId.value || grantBusy.value) return;
  grantBusy.value = true;
  error.value = null;
  try {
    let discountId = grantDiscountId.value;
    if (discountId === NEW) {
      const v = Number(newValue.value);
      if (!newName.value.trim() || !Number.isFinite(v) || v <= 0) {
        error.value = "Donnez un nom et une valeur à la réduction.";
        return;
      }
      const d = await api.finance.createDiscount({
        code: codeFor(newName.value),
        name: newName.value.trim(),
        percentBps: newKind.value === "PERCENT" ? Math.round(v * 100) : null,
        amountXaf: newKind.value === "AMOUNT" ? Math.round(v) : null,
        maxAmountXaf:
          newKind.value === "PERCENT" && Number(newCap.value) > 0
            ? Math.round(Number(newCap.value))
            : null,
      });
      discountId = d.id;
      discounts.value = [...discounts.value, d];
    }
    const res = await api.finance.grantWaiver({
      studentId: led.value.student.id,
      discountId,
      academicYearId: led.value.year.id,
      ...(grantFeeTypeId.value ? { feeTypeId: grantFeeTypeId.value } : {}),
      ...(grantReason.value.trim() ? { reason: grantReason.value.trim() } : {}),
    });
    notice.value = res.creditedXaf
      ? `Réduction accordée · ${money(res.creditedXaf)} porté en avoir sur la facture.`
      : "Réduction accordée · elle s'appliquera à la facture.";
    granting.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Impossible d'accorder la réduction.";
  } finally {
    grantBusy.value = false;
  }
}

async function revokeWaiver(id: string) {
  error.value = null;
  try {
    await api.finance.revokeWaiver(id);
    // Said plainly, because it is the surprising half: the avoir already
    // booked stays, and withdrawal only affects what is billed next.
    notice.value = "Réduction retirée · l'avoir déjà porté sur la facture reste acquis.";
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Retrait impossible.";
  }
}

// ── the receipt ─────────────────────────────────────────────────────────────
const receipt = ref<api.ReceiptDoc | null>(null);
const receiptBusy = ref(false);

async function openReceipt(paymentId: string) {
  receiptBusy.value = true;
  try {
    receipt.value = await api.finance.receipt(paymentId);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Reçu indisponible.";
  } finally {
    receiptBusy.value = false;
  }
}

/**
 * Print, and record that it happened.
 *
 * The count is evidence in a dispute — "this parent was handed three copies" —
 * so it ticks here, where a copy really was produced, and not on every open of
 * the screen. The reload after is what makes the next copy say "duplicata".
 */
async function printReceipt() {
  const doc = receipt.value;
  if (!doc) return;
  window.print();
  try {
    await api.finance.markReceiptPrinted(doc.receipt.id);
    await load();
  } catch {
    // The paper is already out of the printer; failing to count it is not a
    // reason to tell the operator their payment did not work.
  }
}
</script>

<template>
  <div class="finance-page">
    <div class="bulletin-bar">
      <RouterLink v-if="backTo" class="btn sm ghost" :to="backTo">← Retour à la classe</RouterLink>
      <button v-else class="btn sm ghost" type="button" @click="router.back()">← Retour</button>

      <template v-if="led">
        <RouterLink
          class="btn sm ghost"
          :to="{
            name: 'student',
            params: { id: led.student.id },
            query: { from: route.query.from, tab: 'finances' },
          }"
        >Fiche de l'élève</RouterLink>
        <button class="btn sm primary" type="button" @click="paying = true">
          Enregistrer un paiement
        </button>
      </template>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <template v-else-if="led">
      <header class="finance-head">
        <div>
          <h1 class="dossier-name">{{ fullName }}</h1>
          <div class="dossier-sub">
            Matricule {{ led.student.matricule }} · {{ led.classe.name }} · {{ led.year.label }}
          </div>
        </div>
        <div class="dossier-figures">
          <div><span>Facturé</span><strong>{{ money(led.totals.billedXaf) }}</strong></div>
          <div><span>Réglé</span><strong>{{ money(led.totals.paidXaf) }}</strong></div>
          <div v-if="led.totals.advanceXaf > 0">
            <span>Avance au crédit</span><strong>{{ money(led.totals.advanceXaf) }}</strong>
          </div>
          <div v-if="led.totals.creditXaf > 0 && !led.totals.advanceXaf">
            <span>Crédit</span><strong>{{ money(led.totals.creditXaf) }}</strong>
          </div>
          <!-- No facture yet, but the amount IS knowable: grille + modalité +
               réductions are all set, so it is computed and shown. Issuing
               stays a deliberate act; the information is not withheld. -->
          <div v-if="led.needsInvoice && led.projection">
            <span>À payer (prévision)</span>
            <strong>{{ money(led.projection.totalXaf) }}</strong>
          </div>
          <div v-else-if="led.needsInvoice">
            <span>Reste à payer</span>
            <!-- No grille applies either, so there genuinely is no figure.
                 Printing 0 would tell a parent they owe nothing. -->
            <strong>—</strong>
          </div>
          <div v-else-if="!(led.totals.creditXaf > 0 && !led.totals.advanceXaf)">
            <span>Reste à payer</span>
            <strong :class="{ 'is-warn': led.totals.balanceXaf > 0 }">
              {{ money(Math.max(0, led.totals.balanceXaf)) }}
            </strong>
          </div>
          <!-- The figure the guichet actually needs. The annual balance answers
               a question nobody at the counter is asking: a parent in November
               owes the tranches that have come due, not the June one. Shown
               only when it differs, so it never repeats the line above it. -->
          <div v-if="!led.needsInvoice && led.totals.dueNowXaf > 0
                     && led.totals.dueNowXaf !== led.totals.balanceXaf">
            <span>Dû à ce jour</span>
            <strong class="is-warn">{{ money(led.totals.dueNowXaf) }}</strong>
          </div>
        </div>
      </header>

      <!-- ── the échéancier, which is what was agreed ─────────────────── -->
      <section class="dossier-section">
        <h2>
          Échéancier
          <span class="dossier-h2-note">
            <template v-if="led.policy">
              · {{ api.PAYMENT_MODALITY_FR[led.policy.modality] }}
              <template v-if="led.policy.graceDays">
                · {{ led.policy.graceDays }} j de grâce
              </template>
            </template>
          </span>
        </h2>

        <!--
          THE PROJECTION. Same table the échéancier will be, before anybody
          issues anything: the operator sees what the pupil owes and what each
          tranche will be, and presses Émettre when they mean to create the
          document rather than to find out a number.
        -->
        <table v-if="led.needsInvoice && led.projection" class="dossier-table">
          <thead>
            <tr>
              <th>Type de frais</th>
              <th class="c-num">Tarif</th>
              <th class="c-num">Réduction</th>
              <th class="c-num">À payer</th>
              <th class="c-num">Par tranche</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in led.projection.lines" :key="l.feeTypeId">
              <td>{{ l.feeType }}</td>
              <td class="c-num">{{ money(l.grossXaf) }}</td>
              <td class="c-num">{{ l.waivedXaf ? `− ${money(l.waivedXaf)}` : "—" }}</td>
              <td class="c-num">{{ money(l.amountXaf) }}</td>
              <td class="c-num">
                <template v-if="l.installments > 1">
                  {{ money(l.perTrancheXaf[0] ?? 0) }} × {{ l.installments }}
                </template>
                <template v-else>en une fois</template>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- The dates too, since "trois tranches" without them still leaves a
             parent asking when the first one falls. -->
        <p v-if="led.needsInvoice && led.projection?.tranches.length" class="hint">
          Échéances prévues :
          <template v-for="(t, i) in led.projection.tranches" :key="t.number"
            >{{ i ? " · " : "" }}{{ t.label }} {{ day(t.dueOn) }}</template
          >
        </p>

        <!--
          No facture is a state with a remedy, and it is stated as one. It is
          NOT a blocker: encaisser works regardless — the API issues the facture
          when a grille applies and holds the money as an avance when none does.
        -->
        <Alert v-if="led.needsInvoice" kind="warn" :closable="false">
          <template v-if="led.canIssueInvoice">
            Aucune facture n'a encore été émise pour {{ led.year.label }}. La grille
            tarifaire de sa classe s'applique — vous pouvez l'émettre maintenant, ou
            simplement encaisser : elle sera créée automatiquement.
            <button class="btn sm" type="button" :disabled="issuing" @click="issueInvoice">
              <span v-if="issuing" class="btn-spin" aria-hidden="true" />
              {{ issuing ? "Émission…" : "Émettre la facture" }}
            </button>
          </template>
          <template v-else>
            Aucune facture, et aucune grille tarifaire ne s'applique à sa classe pour
            {{ led.year.label }}. Vous pouvez tout de même encaisser : la somme sera
            portée en avance et imputée dès qu'une grille sera définie.
          </template>
        </Alert>

        <!-- Without a modalité there is no échéancier to show, and inventing
             one would put a date in front of a parent that nobody agreed. -->
        <Alert v-else-if="!led.policy" kind="warn" :closable="false">
          Aucune modalité de paiement n'est définie pour cette classe : les tranches
          ne peuvent pas être calculées. Définissez-la depuis l'école ou le cycle.
        </Alert>

        <table v-else class="dossier-table">
          <thead>
            <tr>
              <th>Tranche</th><th>Échéance</th>
              <th class="c-num">Dû</th><th class="c-num">Réglé</th><th class="c-num">Reste</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in led.tranches" :key="t.number" :class="`tr-${t.state.toLowerCase()}`">
              <td>{{ t.label }}</td>
              <td>{{ day(t.dueOn) }}</td>
              <td class="c-num">{{ money(t.dueXaf) }}</td>
              <td class="c-num">{{ money(t.paidXaf) }}</td>
              <td class="c-num">{{ t.balanceXaf > 0 ? money(t.balanceXaf) : "—" }}</td>
              <td><span class="tranche-tag" :class="`is-${t.state.toLowerCase()}`">
                {{ TRANCHE_FR[t.state] }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!--
        ── RÉDUCTIONS ──
        On the page where the money is, not behind a menu. A bourse nobody can
        see is a bourse nobody trusts, and a total below the grille with nothing
        explaining it reads as an arithmetic mistake.
      -->
      <section class="dossier-section">
        <h2>
          Réductions et bourses
          <span class="dossier-h2-note" v-if="led.waivers.length"> · {{ led.waivers.length }}</span>
        </h2>

        <table v-if="led.waivers.length" class="dossier-table">
          <thead>
            <tr><th>Réduction</th><th>Porte sur</th><th>Motif</th><th>Accordée le</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="w in led.waivers" :key="w.id">
              <td>
                <span class="cell-strong">{{ w.name }}</span>
                <span class="cell-sub">
                  {{ w.percentBps !== null ? `${w.percentBps / 100} %` : money(w.amountXaf ?? 0) }}
                </span>
              </td>
              <td>{{ w.feeType ?? "toute la facture" }}</td>
              <td>{{ w.reason ?? "—" }}</td>
              <td>{{ day(w.grantedAt) }}</td>
              <td>
                <button
                  v-if="canGrantWaiver"
                  class="btn sm ghost"
                  type="button"
                  @click="revokeWaiver(w.id)"
                >Retirer</button>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-else class="dossier-empty">
          Aucune réduction pour cet élève.
          <button v-if="canGrantWaiver" class="btn sm ghost" type="button" @click="openGrant">
            Accorder une réduction
          </button>
        </p>

        <div v-if="led.waivers.length && canGrantWaiver">
          <button class="btn sm ghost" type="button" @click="openGrant">
            Accorder une autre réduction
          </button>
        </div>
      </section>

      <!-- ── the history, which is what the argument is usually about ─── -->
      <section class="dossier-section">
        <h2>Règlements<span class="dossier-h2-note"> · {{ led.payments.length }}</span></h2>
        <table v-if="led.payments.length" class="dossier-table">
          <thead>
            <tr>
              <th>Date</th><th>Motif</th><th>Moyen</th><th>Référence</th><th>Reçu</th>
              <th class="c-num">Montant</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in led.payments" :key="p.id">
              <td>{{ day(p.receivedAt) }}</td>
              <td>
                {{ p.purpose ?? "—" }}
                <!-- An avance is a different thing from a règlement and the
                     history has to say which is which, or a parent's total and
                     the facture's total look like a contradiction. -->
                <span v-if="p.isAdvance" class="tranche-tag is-credit">avance</span>
              </td>
              <td>{{ api.PAYMENT_METHOD_FR[p.method] }}</td>
              <td>{{ p.reference ?? "—" }}</td>
              <td>
                {{ p.receipt?.number ?? "—" }}
                <!-- Says so on the row, because a duplicata is a different
                     piece of paper from an original and both exist. -->
                <small v-if="p.receipt && p.receipt.printCount > 0">
                  · {{ p.receipt.printCount }} copie(s)
                </small>
              </td>
              <td class="c-num">{{ money(p.amountXaf) }}</td>
              <td>
                <button
                  v-if="p.receipt"
                  class="btn sm ghost"
                  type="button"
                  :disabled="receiptBusy"
                  @click="openReceipt(p.id)"
                >Reçu</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="dossier-empty">
          Aucun règlement enregistré.
          <button class="btn sm ghost" type="button" @click="paying = true">
            Enregistrer un paiement
          </button>
        </p>
      </section>

      <!-- ── the factures behind it all ─────────────────────────────────── -->
      <section v-if="led.invoices.length" class="dossier-section">
        <h2>Factures</h2>
        <div v-for="inv in led.invoices" :key="inv.id" class="finance-invoice">
          <div class="finance-invoice-head">
            <strong>{{ inv.number }}</strong>
            <span class="hint">émise le {{ day(inv.issuedOn) }}</span>
            <span class="finance-invoice-total">{{ money(inv.totalXaf) }}</span>
          </div>
          <table class="dossier-table">
            <tbody>
              <tr v-for="l in inv.lines" :key="l.id">
                <td>{{ l.label }}</td>
                <td>{{ l.dueOn ? day(l.dueOn) : "—" }}</td>
                <td class="c-num">{{ money(l.amountXaf) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!--
      Deliberately plain: one list, one reason, one button. The people running
      this have little experience of software, and the consequence is stated in
      the sentence above the button rather than discovered afterwards.
    -->
    <ConfirmDialog
      v-if="granting && led"
      title="Accorder une réduction"
      :subtitle="fullName"
      confirm-label="Accorder"
      :busy="grantBusy"
      @close="granting = false"
      @confirm="grantWaiver"
    >
      <div class="stack">
        <div class="field">
          <label for="w-disc">Réduction</label>
          <select id="w-disc" v-model="grantDiscountId">
            <option value="">Choisir…</option>
            <option v-for="d in discounts" :key="d.id" :value="d.id">{{ d.name }}</option>
            <option :value="NEW">＋ Nouvelle réduction…</option>
          </select>
          <span v-if="grantPreview" class="hint">{{ grantPreview }}</span>
          <span v-else-if="!discounts.length" class="hint">
            Aucune réduction n'est encore définie : choisissez « Nouvelle réduction ».
          </span>
        </div>

        <!-- Defined here the first time, picked from the list every time after. -->
        <template v-if="makingNew">
          <div class="field">
            <label for="w-name">Nom de la réduction</label>
            <input id="w-name" v-model="newName" maxlength="80" autocomplete="off"
                   placeholder="Bourse d'excellence, Fratrie, Personnel…" />
          </div>
          <div class="grant-row">
            <div class="field">
              <label for="w-kind">Type</label>
              <select id="w-kind" v-model="newKind">
                <option value="PERCENT">Pourcentage</option>
                <option value="AMOUNT">Montant fixe</option>
              </select>
            </div>
            <div class="field">
              <label for="w-val">{{ newKind === "PERCENT" ? "Pourcentage" : "Montant (XAF)" }}</label>
              <input id="w-val" v-model="newValue" inputmode="numeric" autocomplete="off"
                     :placeholder="newKind === 'PERCENT' ? '50' : '25000'" />
            </div>
            <div v-if="newKind === 'PERCENT'" class="field">
              <label for="w-cap">Plafond (facultatif)</label>
              <input id="w-cap" v-model="newCap" inputmode="numeric" autocomplete="off"
                     placeholder="XAF" />
              <span class="hint">Au plus ce montant par ligne.</span>
            </div>
          </div>
        </template>

        <div class="field">
          <label for="w-fee">Porte sur</label>
          <select id="w-fee" v-model="grantFeeTypeId">
            <option value="">Toute la facture</option>
            <option v-for="f in feeTypes" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <!-- The common case, said out loud: a bourse covers the scolarité and
               not the canteen. -->
          <span class="hint">Une bourse ne couvre souvent que la scolarité.</span>
        </div>

        <div class="field">
          <label for="w-why">Motif</label>
          <input id="w-why" v-model="grantReason" maxlength="240" autocomplete="off"
                 placeholder="Fille d'enseignante, cas social…" />
          <span class="hint">Une réduction sans motif écrit est une réduction que personne ne peut défendre.</span>
        </div>

        <p v-if="!led.needsInvoice" class="hint">
          La facture existe déjà : la réduction sera portée en <strong>avoir</strong>
          sur cette facture, sans en réécrire les lignes.
        </p>
      </div>
    </ConfirmDialog>

    <PaymentDialog
      v-if="paying && led"
      :student-id="led.student.id"
      :student-name="fullName"
      :academic-year-id="led.year.id"
      :balance-xaf="Math.max(0, led.totals.balanceXaf)"
      :needs-invoice="led.needsInvoice"
      @close="paying = false"
      @recorded="onRecorded"
    />

    <!--
      The receipt overlay. `receipt-stage` is what survives @media print — the
      rest of the console is hidden, so what comes out of the printer is the
      slip and nothing else.
    -->
    <div v-if="receipt" class="scrim receipt-stage" @click.self="receipt = null">
      <div class="scrim-card dialog receipt-modal" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <div class="dialog-title"><span>Reçu {{ receipt.receipt.number }}</span></div>
          <div class="receipt-acts">
            <button class="btn sm primary" type="button" @click="printReceipt">
              Imprimer / PDF
            </button>
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
