<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";

/**
 * RÉINSCRIPTION — one box, one pupil, one act.
 *
 * The three earlier versions of this screen all made the operator supply what
 * the database already knew. The last one asked for a mode (année or période),
 * an école, a année, then a période — four choices before a name could be
 * typed, at a counter, with a parent waiting — and it let them pick a trimestre
 * the child was already sitting in.
 *
 * So the screen is a search box. Type a matricule (the dashes are optional:
 * they are printed "M-2026-0431" and read out loud as "M20260431") or a name.
 * Everything else is derived from where the pupil actually is — école, année,
 * période — and the software offers only what may legitimately be opened next,
 * which is one thing, or two at a year boundary, or none with the reason said
 * out loud.
 *
 * Then the money, in the same act: réinscription is sanctioned by a payment
 * and the API takes both or neither.
 */
const query = ref("");
const searching = ref(false);
const results = ref<api.ReinscriptionLookup["candidates"]>([]);
const picked = ref<api.ReinscriptionLookup["candidates"][number] | null>(null);
const working = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const box = ref<HTMLInputElement | null>(null);

/** Which of the pupil's options is being acted on. */
const choice = ref<string | null>(null);
const chosen = computed(
  () => picked.value?.options.find((o) => `${o.kind}:${o.id}` === choice.value) ?? null,
);

const payment = ref({ amount: null as number | null, method: "CASH", reference: "" });

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;
const named = (c: { lastName: string; firstName: string }) =>
  `${c.lastName.toUpperCase()} ${c.firstName}`;

onMounted(() => box.value?.focus());

/**
 * Searching as they type, once there is enough to search for.
 *
 * Debounced rather than behind a button: a matricule is read off a card in one
 * breath and the answer should be there when the reading stops.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
watch(query, (q) => {
  if (timer) clearTimeout(timer);
  picked.value = null;
  if (q.trim().length < 2) { results.value = []; return; }
  timer = setTimeout(() => void search(), 250);
});

async function search() {
  const q = query.value.trim();
  if (q.length < 2) return;
  searching.value = true;
  error.value = null;
  try {
    const res = await api.academics.reinscriptionLookup(q);
    results.value = res.candidates;
    // One hit is the common case at a counter: open it rather than making
    // somebody click the only row on screen.
    if (res.candidates.length === 1) select(res.candidates[0]!);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Recherche impossible.";
    results.value = [];
  } finally {
    searching.value = false;
  }
}

function select(c: api.ReinscriptionLookup["candidates"][number]) {
  picked.value = c;
  // The first option is the one the school is collecting for right now.
  choice.value = c.options[0] ? `${c.options[0].kind}:${c.options[0].id}` : null;
  payment.value = { amount: null, method: "CASH", reference: "" };
}

/** Back to the box, ready for the next family. */
async function reset() {
  picked.value = null;
  results.value = [];
  query.value = "";
  await nextTick();
  box.value?.focus();
}

/**
 * THE ACT: réinscription and its fee, together or not at all.
 *
 * Two boundaries, two endpoints, one promise — a période registration and a
 * new year's enrolment both refuse to exist without the payment that was meant
 * to accompany them. `withPayment: false` is the school that prices none.
 */
async function confirm(withPayment: boolean) {
  const pupil = picked.value;
  const option = chosen.value;
  if (!pupil || !option || working.value) return;
  if (withPayment && !payment.value.amount) return;
  working.value = true;
  error.value = null;

  const money_ = withPayment && payment.value.amount
    ? {
        amountXaf: payment.value.amount,
        method: payment.value.method as api.PaymentMethod,
        ...(pupil.fee ? { feeTypeId: pupil.fee.id } : {}),
        ...(payment.value.reference.trim() ? { reference: payment.value.reference.trim() } : {}),
      }
    : undefined;

  try {
    const res = option.kind === "PERIOD"
      ? await api.academics.reinscribePeriod(option.id, pupil.studentId,
          money_ ? { payment: money_ } : {})
      : await api.academics.reinscribeYear({
          studentId:      pupil.studentId,
          academicYearId: option.id,
          classeId:       option.classeId ?? pupil.enrolled.classe.id,
          ...(money_ ? { payment: money_ } : {}),
        });
    notice.value = res.receipt
      ? `${named(pupil)} réinscrit(e) — ${option.label} · reçu n° ${res.receipt.number}.`
      : `${named(pupil)} réinscrit(e) — ${option.label}.`;
    await reset();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Réinscription impossible.";
  } finally {
    working.value = false;
  }
}

/**
 * BLOQUER — une trace, pas une exclusion.
 *
 * The school refuses this pupil the période until something is settled, with
 * the reason recorded against it. They stay enrolled for the year: marks are
 * still entered, factures still run, nothing is cancelled. Kept on this screen
 * because it is the same conversation at the same counter — "he cannot come
 * back until the scolarité is paid" — and the reason is required, since a
 * block nobody can explain is the state this replaced.
 */
const blocking = ref<{ periodId: string; label: string; reason: string } | null>(null);

async function block() {
  const target = blocking.value;
  const pupil = picked.value;
  if (!target || !pupil || working.value || !target.reason.trim()) return;
  working.value = true;
  error.value = null;
  try {
    await api.academics.registerPeriod(target.periodId, [pupil.studentId], {
      status: "BLOCKED",
      note:   target.reason.trim(),
    });
    notice.value = `${named(pupil)} bloqué(e) pour ${target.label}.`;
    blocking.value = null;
    await reset();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Réinscription</h1>
        <div class="page-sub">
          Tapez le matricule (avec ou sans tirets) ou le nom. Le reste — école,
          année, période, ce qui peut être ouvert — est déduit du dossier.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <!-- One box, focused on arrival. -->
    <div class="card reins-search">
      <input
        ref="box"
        v-model="query"
        class="reins-box"
        type="search"
        autocomplete="off"
        placeholder="M20260431, ou Mabiala Grâce…"
        aria-label="Matricule ou nom de l'élève"
      />
      <span v-if="searching" class="btn-spin" aria-hidden="true" />
    </div>

    <!-- Several matches: choose. One match opens itself. -->
    <div v-if="!picked && results.length > 1" class="card is-grid">
      <div class="card-head"><span>{{ results.length }} élève(s)</span></div>
      <ul class="reins-hits">
        <li v-for="c in results" :key="c.studentId">
          <button type="button" @click="select(c)">
            <span class="reins-hit-name">{{ named(c) }}</span>
            <span class="cell-sub">
              {{ c.matricule }} · {{ c.enrolled.classe.name }} · {{ c.enrolled.year.label }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div v-else-if="!picked && query.trim().length >= 2 && !searching && !results.length" class="card">
      <div class="empty">
        <div class="empty-title">Aucun élève trouvé</div>
        <div>
          Vérifiez le matricule ou le nom. Un élève jamais inscrit ici relève de
          l'inscription, pas de la réinscription.
        </div>
        <div class="empty-actions">
          <RouterLink class="btn primary" :to="{ name: 'enroll' }">Inscrire un élève</RouterLink>
        </div>
      </div>
    </div>

    <!-- THE PUPIL, and what may be opened for them. -->
    <div v-if="picked" class="card is-grid reins-card">
      <div class="card-head">
        <span>
          {{ named(picked) }}
          <span class="cell-sub">{{ picked.matricule }}</span>
        </span>
        <button class="btn sm ghost" type="button" @click="reset">Changer d'élève</button>
      </div>

      <!-- Where they are. Read, never asked. -->
      <dl class="reins-where">
        <div v-if="picked.enrolled.school || picked.enrolled.complex">
          <dt>Établissement</dt>
          <dd>{{ picked.enrolled.school ?? picked.enrolled.complex }}</dd>
        </div>
        <div><dt>Classe</dt><dd>{{ picked.enrolled.classe.name }}</dd></div>
        <div>
          <dt>Année</dt>
          <dd>
            {{ picked.enrolled.year.label }}
            <span v-if="picked.enrolled.year.closed" class="pill warn">close</span>
          </dd>
        </div>
        <div v-if="picked.enrolled.period">
          <dt>Période en cours</dt>
          <dd>{{ picked.enrolled.period.label }}</dd>
        </div>
        <div v-if="picked.owesXaf">
          <dt>Reste dû</dt>
          <dd class="is-danger">{{ money(picked.owesXaf) }}</dd>
        </div>
      </dl>

      <!-- Nothing to open, and the reason rather than an empty screen. -->
      <div v-if="!picked.options.length" class="empty">
        <div class="empty-title">Rien à ouvrir pour cet élève</div>
        <div>{{ picked.blocked }}</div>
      </div>

      <template v-else>
        <!--
          THE VALID NEXT STEPS, and only those.

          One at a trimestre boundary, two at the turn of a year. A période the
          pupil is already registered for is not here at all — see the API,
          which refuses it as well.
        -->
        <div class="reins-options">
          <label
            v-for="o in picked.options"
            :key="`${o.kind}:${o.id}`"
            class="reins-option"
            :class="{ 'is-on': choice === `${o.kind}:${o.id}` }"
          >
            <input v-model="choice" type="radio" :value="`${o.kind}:${o.id}`" name="option" />
            <span>
              <strong>{{ o.label }}</strong>
              <span class="cell-sub">
                {{ o.kind === "PERIOD" ? "Période" : "Année" }} · {{ o.detail }}
              </span>
            </span>
          </label>
        </div>

        <!-- The fee, taken in the same act. -->
        <div class="reins-pay">
          <div class="field">
            <label for="re-amount">
              Montant reçu
              <span v-if="picked.fee" class="cell-sub">{{ picked.fee.name }}</span>
              <span v-else class="cell-sub">aucun frais au tarif</span>
            </label>
            <input id="re-amount" v-model.number="payment.amount" type="number" min="1" step="1"
                   placeholder="0" />
          </div>
          <div class="field">
            <label for="re-method">Moyen</label>
            <select id="re-method" v-model="payment.method">
              <option v-for="(label, id) in api.PAYMENT_METHOD_FR" :key="id" :value="id">
                {{ label }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="re-ref">Référence</label>
            <input id="re-ref" v-model="payment.reference" maxlength="64" placeholder="MOMO-…" />
          </div>
        </div>

        <div class="reins-actions">
          <!-- Refusing the période is the same conversation at the same desk. -->
          <button
            v-if="chosen?.kind === 'PERIOD'"
            class="btn ghost"
            type="button"
            :disabled="working"
            @click="blocking = { periodId: chosen.id, label: chosen.label, reason: '' }"
          >Bloquer</button>
          <span class="reins-fill" />
          <button
            class="btn ghost"
            type="button"
            :disabled="working || !chosen"
            @click="confirm(false)"
          >Réinscrire sans paiement</button>
          <button
            class="btn primary"
            type="button"
            :disabled="working || !chosen || !payment.amount"
            @click="confirm(true)"
          >
            <span v-if="working" class="btn-spin" aria-hidden="true" />
            Réinscrire et encaisser
          </button>
        </div>
        <p class="hint" style="margin: 0">
          Les deux vont ensemble : si le règlement échoue, la réinscription n'a
          pas lieu.
        </p>
      </template>
    </div>

    <ConfirmDialog
      v-if="blocking && picked"
      :title="`Bloquer — ${named(picked)}`"
      :subtitle="blocking.label"
      confirm-label="Bloquer"
      danger
      :busy="working"
      :confirm-disabled="!blocking.reason.trim()"
      @close="blocking = null"
      @confirm="block"
    >
      <p>
        L'élève ne sera pas réinscrit(e) pour cette période tant que le blocage
        n'est pas levé. Il reste inscrit à l'année : ses notes se saisissent, ses
        factures courent, rien n'est annulé. Le motif est ce que lira la personne
        qui ouvrira ce dossier dans six semaines.
      </p>
      <textarea
        v-model="blocking.reason"
        rows="2"
        placeholder="Motif — scolarité du 1er trimestre impayée, dossier incomplet…"
      />
    </ConfirmDialog>
  </div>
</template>
