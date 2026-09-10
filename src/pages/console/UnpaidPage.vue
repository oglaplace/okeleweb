<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import PaymentDialog from "../../components/finance/PaymentDialog.vue";
import ReceiptSheet from "../../components/finance/ReceiptSheet.vue";
import { useBanner } from "../../lib/banner";

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
const { notice, error } = useBanner();
const query = ref("");

/**
 * WHAT THE LIST IS ABOUT, and it is not the year.
 *
 * "Impayé" used to mean the whole outstanding balance, so a family on the
 * trimestriel plan who has paid everything asked of them so far still appeared
 * — owing 300 000 F nobody has demanded. Chasing that list loses a parent's
 * trust, and an économe who learns the list is wrong stops using it.
 *
 *   exigible — every tranche whose date has passed, the default and the
 *              figure the list is ordered by: what can be collected today.
 *   late     — only what is past the grace period too. The sharper list, for
 *              the calls that have to be made.
 *   all      — the whole outstanding balance, which is a report rather than a
 *              worklist. Kept because a director does ask "what is out there".
 */
type Scope = "due" | "late" | "all";
const scope = ref<Scope>("due");
const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "due", label: "Exigible", hint: "Tranches déjà échues, réglées ou non" },
  { id: "late", label: "En retard", hint: "Au-delà du délai de grâce" },
  { id: "all", label: "Tout l'impayé", hint: "Toute l'année, échue ou non" },
];

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

/**
 * A PAGE AT A TIME, and the narrowing belongs to the API.
 *
 * A complex of a thousand pupils has close to a thousand outstanding factures
 * in janvier. Downloading all of them to show fifty is the whole wait on this
 * connection — and filtering fifty of nine hundred in the browser answers a
 * different question from the one that was asked: "who owes something today"
 * cannot be read off one page. So scope, search and paging all go to the
 * server, and the figures that come back describe exactly what was asked for.
 */
const PAGE = 50;
const offset = ref(0);

async function load() {
  if (!yearId.value) return;
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.finance.unpaid(yearId.value, {
      limit: PAGE,
      offset: offset.value,
      scope: scope.value,
      ...(query.value.trim() ? { q: query.value.trim() } : {}),
    });
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Impayés indisponibles.";
    data.value = null;
  } finally {
    loading.value = false;
  }
}
watch(yearId, load);

/** Any change of question starts at the first page — page 7 of the old one is
 *  a page of a list that no longer exists. */
watch([scope, query], () => {
  offset.value = 0;
  void load();
});
watch(offset, load);

const rows = computed(() => data.value?.rows ?? []);
const shown = computed(() => data.value?.totals ?? null);

const pageInfo = computed(() => {
  const p = data.value?.page;
  if (!p || !p.total) return null;
  return {
    from: p.offset + 1,
    to: Math.min(p.offset + p.limit, p.total),
    total: p.total,
    hasPrev: p.offset > 0,
    hasNext: p.offset + p.limit < p.total,
  };
});

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
          Ce qui peut être encaissé aujourd'hui, du plus élevé au moins — mesuré
          sur les tranches échues de chaque classe, pas sur la facture entière.
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
      <div v-if="shown" class="dossier-figures" style="margin-bottom: var(--s4)">
        <div><span>Élèves concernés</span><strong>{{ shown.count }}</strong></div>
        <!-- The collectable figure first and in red: it is the one an économe
             acts on. The year's balance is context, not a target. -->
        <div>
          <span>Exigible à ce jour</span>
          <strong :class="{ 'is-warn': shown.dueNowXaf > 0 }">{{ money(shown.dueNowXaf) }}</strong>
        </div>
        <div><span>Dont en retard</span><strong>{{ money(shown.lateXaf) }}</strong></div>
        <div><span>Reste sur l'année</span><strong>{{ money(shown.balanceXaf) }}</strong></div>
      </div>

      <div class="card">
        <div class="card-head unpaid-tools">
          <input
            v-model="query"
            class="unpaid-search"
            placeholder="Nom, matricule, classe…"
            aria-label="Rechercher un élève"
          />
          <!-- Three widths of the same list, and the default is the one that
               can be acted on. See `scope`. -->
          <!-- Same control as the grille's list/graphe switch — one segmented
               group in the console, not two that drift. -->
          <div class="viewswitch" role="group" aria-label="Portée">
            <button
              v-for="sc in SCOPES"
              :key="sc.id"
              class="viewswitch-btn"
              :class="{ 'is-on': scope === sc.id }"
              type="button"
              :title="sc.hint"
              :aria-pressed="scope === sc.id"
              @click="scope = sc.id"
            >{{ sc.label }}</button>
          </div>
          <span v-if="pageInfo" class="hint">
            {{ pageInfo.from }}–{{ pageInfo.to }} sur {{ pageInfo.total }}
          </span>
        </div>

        <div v-if="!rows.length" class="empty">
          <div class="empty-title">
            {{ data.totals.allCount ? "Aucun élève ne correspond" : "Aucun impayé" }}
          </div>
          <div v-if="!data.totals.allCount">Toutes les factures émises sont soldées.</div>
          <div v-else-if="scope === 'due'">
            Personne n'a de tranche échue impayée. {{ data.totals.allCount }} élève(s) ont
            un solde sur l'année — « Tout l'impayé » les montre.
          </div>
        </div>

        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="c-name">Élève</th>
                <th class="c-text">Classe</th>
                <th class="c-text">À contacter</th>
                <th class="c-num" title="Tranches déjà échues, réglées ou non">Exigible</th>
                <th class="c-num" title="Au-delà du délai de grâce">En retard</th>
                <th class="c-num">Jours</th>
                <th class="c-num" title="Toute l'année, échue ou non">Sur l'année</th>
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
                <td class="c-num" :class="{ 'is-warn': r.dueNowXaf > 0 }">
                  {{ r.dueNowXaf > 0 ? money(r.dueNowXaf) : "—" }}
                </td>
                <td class="c-num">{{ r.overdueXaf > 0 ? money(r.overdueXaf) : "—" }}</td>
                <td class="c-num">{{ r.daysLate || "—" }}</td>
                <td class="c-num is-muted">{{ money(r.balanceXaf) }}</td>
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

        <!-- Explicit pages rather than infinite scroll: this is a list that
             gets worked through and put down, and "where was I" has to survive
             a phone call. -->
        <div v-if="pageInfo && (pageInfo.hasPrev || pageInfo.hasNext)" class="pager">
          <button
            class="btn sm ghost"
            type="button"
            :disabled="!pageInfo.hasPrev || loading"
            @click="offset = Math.max(0, offset - PAGE)"
          >Précédent</button>
          <span class="hint">{{ pageInfo.from }}–{{ pageInfo.to }} sur {{ pageInfo.total }}</span>
          <button
            class="btn sm ghost"
            type="button"
            :disabled="!pageInfo.hasNext || loading"
            @click="offset = offset + PAGE"
          >Suivant</button>
        </div>
      </div>
    </template>

    <PaymentDialog
      v-if="paying && yearId"
      :student-id="paying.studentId"
      :student-name="`${paying.lastName.toUpperCase()} ${paying.firstName}`"
      :academic-year-id="yearId"
      :balance-xaf="paying.balanceXaf"
      :suggest-xaf="paying.dueNowXaf"
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
