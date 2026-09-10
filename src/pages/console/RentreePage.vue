<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";

/**
 * RÉINSCRIPTION — one box, one pupil, one act.
 *
 * Everything the counter needs is derived from where the pupil actually is:
 * école, année, période, what they owe, what the school charges them. The
 * operator types a matricule (dashes optional — they are printed
 * "M-2026-0431" and read out loud as "M20260431") or a name, and the form
 * fills itself in with what the file says.
 *
 * SUGGESTIONS, NOT RULES. The période they are leaving and the one they are
 * joining are both proposed and both editable: a family pays ahead for the
 * whole year, a transfer arrives mid-semester, a school runs its own order.
 * A suggestion that cannot be overridden is a rule wearing a friendly face.
 *
 * And the money is a FEE, not a number. The type is chosen (searchably), its
 * price for this pupil is shown, and the difference between that price and
 * what was handed over is stated in words before anything is written — reste
 * à payer, or avance. Both halves land together or neither does.
 */
type Candidate = api.ReinscriptionLookup["candidates"][number];

const query = ref("");
const searching = ref(false);
const results = ref<Candidate[]>([]);
const cursor = ref(0);
const picked = ref<Candidate | null>(null);
const working = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const box = ref<HTMLInputElement | null>(null);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;
const named = (c: { lastName: string; firstName: string }) =>
  `${c.lastName.toUpperCase()} ${c.firstName}`;

onMounted(() => box.value?.focus());

// ── the search ──────────────────────────────────────────────────────────────
/**
 * Answers arrive as the reading stops, and never out of order.
 *
 * A matricule is read off a card in one breath, so the box searches itself
 * rather than waiting for a button. `seq` throws away a slow answer that
 * arrives after a faster later one — the bug where the list flickers back to
 * what you typed three characters ago.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

watch(query, (q) => {
  if (timer) clearTimeout(timer);
  if (picked.value) picked.value = null;
  if (q.trim().length < 2) { results.value = []; searching.value = false; return; }
  searching.value = true;
  timer = setTimeout(() => void search(), 220);
});

async function search() {
  const q = query.value.trim();
  if (q.length < 2) return;
  const mine = ++seq;
  try {
    const res = await api.academics.reinscriptionLookup(q);
    if (mine !== seq) return;
    results.value = res.candidates;
    cursor.value = 0;
    // One hit is the common case at a counter: open it rather than making
    // somebody click the only row on screen.
    if (res.candidates.length === 1) select(res.candidates[0]!);
  } catch (e) {
    if (mine !== seq) return;
    error.value = e instanceof api.ApiError ? e.message : "Recherche impossible.";
    results.value = [];
  } finally {
    if (mine === seq) searching.value = false;
  }
}

/** ↑ ↓ to move, Enter to open, Escape to clear — hands stay on the keyboard. */
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") { clear(); return; }
  if (!results.value.length || picked.value) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    cursor.value = (cursor.value + 1) % results.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    cursor.value = (cursor.value - 1 + results.value.length) % results.value.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = results.value[cursor.value];
    if (hit) select(hit);
  }
}

/** The typed part, marked in the row — so it is obvious WHY a row matched. */
function marked(text: string): { text: string; hit: boolean }[] {
  const q = query.value.trim();
  if (!q) return [{ text, hit: false }];
  const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const i = fold(text).indexOf(fold(q));
  if (i < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, i), hit: false },
    { text: text.slice(i, i + q.length), hit: true },
    { text: text.slice(i + q.length), hit: false },
  ].filter((p) => p.text);
}

// ── the form, filled from the file ──────────────────────────────────────────
const form = ref({
  option: "" as string,
  /** Where they are going. A field, because the counter is who knows. */
  classeId: "" as string,
  feeTypeId: "" as string,
  amount: null as number | null,
  method: "CASH",
  reference: "",
});

function select(c: Candidate) {
  picked.value = c;
  const period = c.options.find((o) => o.kind === "PERIOD");
  form.value = {
    // The période the school declared it is in — see the API's lookup.
    option: period
      ? `PERIOD:${c.suggested.toPeriodId ?? period.id}`
      : c.options[0] ? `${c.options[0].kind}:${c.options[0].id}` : "",
    // Suggested from the money, and empty when nothing can be inferred.
    classeId: c.suggestedClasseId ?? "",
    // The réinscription fee, when the school has one installed.
    feeTypeId: c.fees.find((f) => f.code === "REINSCRIPTION")?.id
      ?? c.fees.find((f) => f.code === "INSCRIPTION")?.id
      ?? "",
    amount: null,
    method: "CASH",
    reference: "",
  };
  // The box shows what is chosen, so it reads as a value and not as an empty
  // search waiting to be filled.
  feeQuery.value = c.fees.find((f) => f.id === form.value.feeTypeId)?.name ?? "";
  feeOpen.value = false;
}

async function clear() {
  picked.value = null;
  results.value = [];
  query.value = "";
  await nextTick();
  box.value?.focus();
}

/** Every période of their calendar, for both selects. */
const periods = computed(() => picked.value?.periods ?? []);

/** The chosen target: a période of this calendar, or next year. */
const chosen = computed(() => {
  const [kind, id] = form.value.option.split(":");
  if (kind === "PERIOD") {
    const p = periods.value.find((x) => x.id === id);
    return p ? { kind: "PERIOD" as const, id: p.id, label: p.label } : null;
  }
  const o = picked.value?.options.find((x) => `${x.kind}:${x.id}` === form.value.option);
  return o ? { kind: o.kind, id: o.id, label: o.label, classeId: o.classeId } : null;
});

/** Périodes that may be joined: still open and not already theirs. */
const openPeriods = computed(() =>
  periods.value.filter((p) => !p.closed && p.status !== "ACTIVE"),
);

/**
 * Where the suggested période came from, in words.
 *
 * Declared by the school, or guessed from today's date — and a counter being
 * told which term a pupil is joining deserves to know which of the two it is.
 */
const periodBasis = computed(() => {
  const declared = picked.value?.enrolled.period?.basis === "DECLARED";
  return declared
    ? "Période en cours déclarée par l'établissement. Modifiable."
    : "Aucune période déclarée en cours — déduite du calendrier. Modifiable.";
});

/** Why the classe is what it is — or why it is empty. */
const classeBasis = computed(() => {
  switch (picked.value?.classeBasis) {
    case "SAME_YEAR_PAID":
      return "L'inscription de l'année en cours est déjà réglée : il reste dans sa classe.";
    case "NEXT_LEVEL":
      return "Dernier règlement sur une année antérieure : classe suivante proposée.";
    default:
      return "Impossible de déduire la classe — choisissez-la.";
  }
});

const yearOption = computed(() => picked.value?.options.find((o) => o.kind === "YEAR") ?? null);

// ── the money ───────────────────────────────────────────────────────────────
/**
 * ONE FIELD FOR THE FEE — type to narrow, click to choose.
 *
 * It was a filter box sitting above a select: two controls for one decision,
 * and the filter looked like a second thing to fill in. This is the box you
 * type in AND the list you pick from, which is how every other search on this
 * screen already behaves.
 */
const feeQuery = ref("");
const feeOpen = ref(false);
const feeCursor = ref(0);

const fee = computed(() => picked.value?.fees.find((f) => f.id === form.value.feeTypeId) ?? null);
const fees = computed(() => {
  const all = picked.value?.fees ?? [];
  const q = feeQuery.value.trim().toLowerCase();
  /*
   * The box holds the CHOSEN name, and opening it must not filter by that.
   *
   * Otherwise the list of six shows one — the one already picked — and the
   * only way to see the others is to delete the text, which nobody guesses.
   * The chosen name means "no filter"; anything else is a search.
   */
  if (!q || q === fee.value?.name.toLowerCase()) return all;
  return all.filter((f) => `${f.name} ${f.code}`.toLowerCase().includes(q));
});

/** What a fee costs for the target on screen — one tranche, or the year. */
const priceOf = (f: Candidate["fees"][number]) =>
  chosen.value?.kind === "YEAR" ? f.totalXaf : f.perTrancheXaf;

function chooseFee(f: Candidate["fees"][number] | null) {
  form.value.feeTypeId = f?.id ?? "";
  feeQuery.value = f?.name ?? "";
  feeOpen.value = false;
  /*
   * THE FEE DOES NOT TYPE THE AMOUNT.
   *
   * What the school charges and what the family handed over are two different
   * facts, and pre-filling one with the other invites the operator to press
   * enter on a figure nobody counted. The fee's price is shown beside the box
   * — « attendu : 25 000 XAF » — and it is what the difference is measured
   * against once the amount is entered; that is all it is for.
   */
}

/** Same keys as the pupil search — one gesture for both lists. */
function onFeeKey(event: KeyboardEvent) {
  if (event.key === "Escape") { feeOpen.value = false; return; }
  if (!feeOpen.value) return;
  const list = fees.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    feeCursor.value = (feeCursor.value + 1) % Math.max(1, list.length);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    feeCursor.value = (feeCursor.value - 1 + list.length) % Math.max(1, list.length);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = list[feeCursor.value];
    if (hit) chooseFee(hit);
  }
}

/**
 * WHAT THIS COSTS, from the grille, for THIS pupil.
 *
 * One instalment for a période — coming back for a trimestre is not paying the
 * year — and the whole line for a year. Null when the school prices nothing,
 * which is a real answer and not zero.
 */
const expected = computed(() => {
  if (!fee.value) return null;
  return chosen.value?.kind === "YEAR" ? fee.value.totalXaf : fee.value.perTrancheXaf;
});

/** Entered minus expected: over is credit, under is what is still owed. */
const difference = computed(() => {
  const want = expected.value;
  const got = form.value.amount;
  if (want === null || got === null) return null;
  return got - want;
});


async function confirm(withPayment: boolean) {
  const pupil = picked.value;
  const option = chosen.value;
  if (!pupil || !option || working.value) return;
  if (withPayment && !form.value.amount) return;
  working.value = true;
  error.value = null;

  const payment = withPayment && form.value.amount
    ? {
        amountXaf: form.value.amount,
        method: form.value.method as api.PaymentMethod,
        ...(form.value.feeTypeId ? { feeTypeId: form.value.feeTypeId } : {}),
        ...(form.value.reference.trim() ? { reference: form.value.reference.trim() } : {}),
      }
    : undefined;

  try {
    const res = option.kind === "PERIOD"
      ? await api.academics.reinscribePeriod(option.id, pupil.studentId,
          payment ? { payment } : {})
      : await api.academics.reinscribeYear({
          studentId:      pupil.studentId,
          academicYearId: option.id,
          // The FIELD, not the label: whatever the counter left in the box.
          classeId:       form.value.classeId || pupil.enrolled.classe.id,
          ...(payment ? { payment } : {}),
        });
    /*
     * WHAT THE LEDGER DID, in the ledger's own words.
     *
     * The form's arithmetic ("this is 5 000 more than the fee") is a guide
     * before the write; afterwards the only honest figures are the ones the
     * API came back with — the balance still owing on the facture, and the
     * credit it is holding.
     */
    const led = res.invoice;
    notice.value =
      `${named(pupil)} réinscrit(e) — ${option.label}`
      + (res.receipt ? ` · reçu n° ${res.receipt.number}` : "")
      + (led && led.creditXaf ? ` · ${money(led.creditXaf)} portés en avance` : "")
      + (led && led.balanceXaf ? ` · reste ${money(led.balanceXaf)} sur la facture` : "")
      + ".";
    await clear();
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
 * still entered, factures still run, nothing is cancelled.
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
    await clear();
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
          Matricule (avec ou sans tirets) ou nom. Le reste — école, année,
          période, tarif — est déduit du dossier.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <!-- ONE BOX. ↑ ↓ to move, Entrée to open, Échap to clear. -->
    <div class="card reins-search" :class="{ 'is-busy': searching }">
      <svg class="reins-glass" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.7" aria-hidden="true">
        <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4" />
      </svg>
      <input
        ref="box"
        v-model="query"
        class="reins-box"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="M20260431, ou Mabiala Grâce…"
        aria-label="Matricule ou nom de l'élève"
        @keydown="onKey"
      />
      <span v-if="searching" class="btn-spin" aria-hidden="true" />
      <button
        v-else-if="query"
        class="reins-clear"
        type="button"
        aria-label="Effacer"
        @click="clear"
      >×</button>
    </div>

    <!-- Several matches: arrow keys, or a click. -->
    <div v-if="!picked && results.length > 1" class="card is-grid">
      <div class="card-head">
        <span>{{ results.length }} élève(s)</span>
        <span class="unit-meta">↑ ↓ pour choisir · Entrée pour ouvrir</span>
      </div>
      <ul class="reins-hits" role="listbox">
        <li v-for="(c, i) in results" :key="c.studentId">
          <button
            type="button"
            role="option"
            :aria-selected="i === cursor"
            :class="{ 'is-cursor': i === cursor }"
            @mouseenter="cursor = i"
            @click="select(c)"
          >
            <span class="reins-hit-name">
              <span v-for="(part, k) in marked(`${c.lastName.toUpperCase()} ${c.firstName}`)"
                    :key="k" :class="{ 'is-hit': part.hit }">{{ part.text }}</span>
            </span>
            <span class="cell-sub">
              <span v-for="(part, k) in marked(c.matricule)" :key="k"
                    :class="{ 'is-hit': part.hit }">{{ part.text }}</span>
              · {{ c.enrolled.classe.name }} · {{ c.enrolled.year.label }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div
      v-else-if="!picked && query.trim().length >= 2 && !searching && !results.length"
      class="card"
    >
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

    <!-- THE PUPIL, and the act. -->
    <div v-if="picked" class="card is-grid reins-card">
      <div class="card-head">
        <span>
          {{ named(picked) }}
          <span class="cell-sub">{{ picked.matricule }}</span>
        </span>
        <button class="btn sm ghost" type="button" @click="clear">Changer d'élève</button>
      </div>

      <!-- Where they are. Read from the file, never asked for. -->
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
        <div v-if="picked.owesXaf">
          <dt>Reste dû</dt><dd class="is-danger">{{ money(picked.owesXaf) }}</dd>
        </div>
        <div v-if="picked.creditXaf">
          <dt>Avance disponible</dt><dd class="is-ok">{{ money(picked.creditXaf) }}</dd>
        </div>
      </dl>

      <div v-if="!picked.options.length && !openPeriods.length" class="empty">
        <div class="empty-title">Rien à ouvrir pour cet élève</div>
        <div>{{ picked.blocked }}</div>
      </div>

      <template v-else>
        <!--
          UNE SEULE PÉRIODE, ET LA CLASSE D'ARRIVÉE.

          The form used to ask where the pupil was coming FROM as well, with
          two generations of inference behind it — the calendar, then the
          pupil's own marks — both of which an operator had to check. The act
          only ever needed its target, and the school now declares which
          période it is in, so there is one field and one source.

          The classe is a FIELD. It was a label, and the counter is exactly who
          knows a pupil is repeating, changing série or leaving for another
          school. The suggestion follows the money and says so; when nothing
          can be inferred it is left EMPTY rather than guessed.
        -->
        <div class="reins-form">
          <div class="field">
            <label for="re-to">Réinscrire pour</label>
            <select id="re-to" v-model="form.option">
              <optgroup v-if="openPeriods.length" label="Périodes">
                <option v-for="p in openPeriods" :key="p.id" :value="`PERIOD:${p.id}`">
                  {{ p.label }}{{ p.id === picked.suggested.toPeriodId ? " — en cours" : "" }}
                </option>
              </optgroup>
              <optgroup v-if="yearOption" label="Année">
                <option :value="`YEAR:${yearOption.id}`">
                  {{ yearOption.label }} — {{ yearOption.detail }}
                </option>
              </optgroup>
            </select>
            <span class="hint">{{ periodBasis }}</span>
          </div>

          <div class="field">
            <label for="re-classe">Classe</label>
            <select id="re-classe" v-model="form.classeId">
              <option value="">— à choisir —</option>
              <option v-for="c in picked.classes" :key="c.id" :value="c.id">
                {{ c.niveau ? `${c.niveau} · ` : "" }}{{ c.name }}{{
                  c.id === picked.enrolled.classe.id ? " — actuelle" : ""
                }}
              </option>
            </select>
            <!-- A période registration does not move anybody; only a new
                 year's enrolment does. Said rather than silently ignored. -->
            <span v-if="chosen?.kind === 'PERIOD'" class="hint">
              Réinscription à une période : l'élève reste en
              {{ picked.enrolled.classe.name }}. La classe choisie ici ne vaut
              que pour une réinscription d'année.
            </span>
            <span v-else class="hint">{{ classeBasis }}</span>
          </div>
        </div>

        <!--
          LE RÈGLEMENT — un type de frais, pas un montant en l'air.

          The type carries the price the grille sets for THIS pupil, bourses
          included, so the counter quotes what the child is charged rather than
          a list price somebody adjusts in their head. What is typed may differ
          — families pay in parts, and round up — and the difference is stated
          in words before anything is written.
        -->
        <div class="reins-form">
          <!--
            ONE FIELD: the box you type in IS the list you pick from.

            A filter above a select was two controls for one decision, and the
            filter read as another thing to fill in. Twenty fee types is a
            school where "cantine" is faster typed than found; three is a
            school where the list is simply open.
          -->
          <div class="field field-wide reins-combo">
            <label for="re-fee">Type de frais</label>
            <input
              id="re-fee"
              v-model="feeQuery"
              type="text"
              autocomplete="off"
              role="combobox"
              :aria-expanded="feeOpen"
              :placeholder="`Chercher parmi ${picked.fees.length} type(s)…`"
              @focus="($event.target as HTMLInputElement).select(); feeOpen = true; feeCursor = 0"
              @input="feeOpen = true; feeCursor = 0"
              @keydown="onFeeKey"
              @blur="feeOpen = false"
            />
            <ul v-if="feeOpen" class="reins-combo-list" role="listbox">
              <li>
                <button
                  type="button"
                  :class="{ 'is-cursor': feeCursor === -1 }"
                  @mousedown.prevent="chooseFee(null)"
                >Aucun — motif libre</button>
              </li>
              <li v-for="(f, i) in fees" :key="f.id">
                <button
                  type="button"
                  role="option"
                  :aria-selected="f.id === form.feeTypeId"
                  :class="{ 'is-cursor': i === feeCursor, 'is-on': f.id === form.feeTypeId }"
                  @mouseenter="feeCursor = i"
                  @mousedown.prevent="chooseFee(f)"
                >
                  <span>{{ f.name }}</span>
                  <span class="cell-sub">
                    {{ f.priced ? money(priceOf(f) ?? 0) : "non tarifé" }}
                  </span>
                </button>
              </li>
              <li v-if="!fees.length" class="reins-combo-empty">Aucun type ne correspond.</li>
            </ul>
            <span class="hint">
              {{ fee ? fee.name : "Aucun type choisi — le règlement portera un motif libre." }}
            </span>
          </div>

          <div class="field">
            <label for="re-amount">Montant reçu</label>
            <input id="re-amount" v-model.number="form.amount" type="number" min="0" step="1"
                   placeholder="0" />
            <span v-if="expected !== null" class="hint">Attendu : {{ money(expected) }}</span>
            <span v-else class="hint">Ce type n'est pas au tarif de cet élève.</span>
          </div>

          <div class="field">
            <label for="re-method">Moyen</label>
            <select id="re-method" v-model="form.method">
              <option v-for="(label, id) in api.PAYMENT_METHOD_FR" :key="id" :value="id">
                {{ label }}
              </option>
            </select>
          </div>

          <div class="field">
            <label for="re-ref">Référence</label>
            <input id="re-ref" v-model="form.reference" maxlength="64" placeholder="MOMO-…" />
          </div>
        </div>

        <!-- The arithmetic, said out loud before anything is written. -->
        <p v-if="difference !== null && difference !== 0" class="reins-diff"
           :class="difference > 0 ? 'is-ok' : 'is-danger'">
          <template v-if="difference > 0">
            {{ money(difference) }} de plus que le tarif — portés en avance sur son
            compte, et imputés sur ce qui vient à échéance en premier.
          </template>
          <template v-else>
            {{ money(-difference) }} de moins que le tarif — le solde reste dû et
            apparaît dans les impayés.
          </template>
        </p>
        <p v-else-if="difference === 0" class="reins-diff is-ok">
          Le compte est juste : {{ money(form.amount ?? 0) }}.
        </p>

        <div class="reins-actions">
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
            :disabled="working || !chosen || !form.amount"
            @click="confirm(true)"
          >
            <span v-if="working" class="btn-spin" aria-hidden="true" />
            Réinscrire et encaisser
          </button>
        </div>

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
