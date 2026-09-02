<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";

/**
 * ONE PUPIL'S DOSSIER — the folder a secretary keeps, on a screen.
 *
 * Everything the school knows about a child lived somewhere else: the roster in
 * the class sheet, the invoice in finances, the bulletin behind a conseil, the
 * absences nowhere anyone looks. Clicking a name got you a bulletin, which is
 * one document about one période — useful, and not the same question as "tell
 * me about this pupil".
 *
 * Sectioned rather than tabbed. A tab hides what it is not showing, and the
 * reason to open this screen is usually to hold two of these things side by
 * side: an économe looking at a balance wants to see which class, a titulaire
 * looking at absences wants the tuteur's number in the same glance. The nav
 * scrolls rather than switches.
 */
const route = useRoute();
const router = useRouter();

const studentId = computed(() => String(route.params.id));
const dossier = ref<api.StudentDossier | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    dossier.value = await api.sheets.student(studentId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Dossier indisponible.";
    dossier.value = null;
  } finally {
    loading.value = false;
  }
}
watch(studentId, load, { immediate: true });

/**
 * Where the operator came from — the class AND the sheet they were reading.
 *
 * Without the tab this landed on Général every time, which for someone who
 * opened the pupil from the Finances sheet is a different screen from the one
 * they left. The tab rides along in the query.
 */
const backTo = computed(() =>
  typeof route.query.from === "string" && route.query.from
    ? {
        name: "unit" as const,
        params: { id: route.query.from },
        query: typeof route.query.tab === "string" && route.query.tab
          ? { tab: route.query.tab }
          : {},
      }
    : null,
);

const fullName = computed(() =>
  dossier.value
    ? `${dossier.value.identity.lastName.toUpperCase()} ${dossier.value.identity.firstName}`
    : "",
);

const XAF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = (v: number) => `${XAF.format(v)} XAF`;
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

/*
 * THE ENUMS, IN FRENCH.
 *
 * `PARTIALLY_PAID` and `MTN_MOMO` are column values, not words. They were
 * appearing verbatim in front of a secretary who has never seen the schema and
 * has no reason to, and "MOBILE_MONEY" in a receipt column is the software
 * showing its plumbing. Unknown values fall through to themselves rather than
 * to a blank, so a value added server-side is ugly here instead of invisible.
 */
const INVOICE_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement réglée",
  PAID: "Réglée",
  CANCELLED: "Annulée",
  OVERDUE: "En retard",
};
const METHOD_FR: Record<string, string> = {
  CASH: "Espèces",
  MTN_MOMO: "MTN MoMo",
  AIRTEL_MONEY: "Airtel Money",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  OTHER: "Autre",
};
const DECISION_FR: Record<string, string> = {
  ADMIS: "Admis(e) en classe supérieure",
  ADMIS_SOUS_CONDITION: "Admis(e) sous condition",
  REDOUBLE: "Redouble",
  EXCLU: "Exclu(e)",
  RATTRAPAGE: "Session de rattrapage",
  EN_ATTENTE: "En attente du conseil",
};
const fr = (map: Record<string, string>, v: string) => map[v] ?? v;

const SECTIONS = [
  { id: "identite", label: "Identité" },
  { id: "scolarite", label: "Scolarité" },
  { id: "finances", label: "Finances" },
  { id: "resultats", label: "Résultats" },
  { id: "assiduite", label: "Assiduité" },
];

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── the portrait ────────────────────────────────────────────────────────────
/**
 * Optional at registration, addable at any time.
 *
 * A school that cannot enrol a child because nobody brought a photo is a school
 * that turns children away for a photo, so the field is never required — it is
 * simply missing until someone fills it, from here.
 */
const photoBusy = ref(false);
const photoError = ref<string | null>(null);

async function onPickPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !dossier.value) return;
  photoError.value = null;
  photoBusy.value = true;
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Lecture impossible"));
      reader.readAsDataURL(file);
    });
    await api.people.setPhoto(dossier.value.identity.personId, data);
    notice.value = "Photo enregistrée.";
    await load();
  } catch (e) {
    photoError.value = e instanceof api.ApiError ? e.message : "Envoi impossible.";
  } finally {
    photoBusy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}

async function removePhoto() {
  if (!dossier.value?.identity.photoUrl) return;
  photoBusy.value = true;
  try {
    await api.people.removePhoto(dossier.value.identity.personId);
    await load();
  } catch (e) {
    photoError.value = e instanceof api.ApiError ? e.message : "Suppression impossible.";
  } finally {
    photoBusy.value = false;
  }
}

/**
 * The portrait itself.
 *
 * The dossier answers a URL, not bytes. When it is external (a school that
 * already had photos on a server) the browser can load it directly; when it is
 * ours it sits behind the bearer token, so the bytes come through the API layer
 * and become a blob. Revoked on every change or the page leaks one portrait per
 * pupil viewed.
 */
const photoSrc = ref<string | null>(null);
let objectUrl: string | null = null;

async function loadPhoto() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  photoSrc.value = null;
  const url = dossier.value?.identity.photoUrl;
  if (!url) return;
  if (/^https?:/.test(url)) {
    photoSrc.value = url;
    return;
  }
  objectUrl = await api.people.photoObjectUrl(dossier.value!.identity.personId);
  photoSrc.value = objectUrl;
}
watch(dossier, loadPhoto);
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

const initials = computed(() =>
  dossier.value
    ? (dossier.value.identity.firstName[0] ?? "") + (dossier.value.identity.lastName[0] ?? "")
    : "",
);
</script>

<template>
  <div class="dossier-page">
    <div class="bulletin-bar">
      <RouterLink v-if="backTo" class="btn sm ghost" :to="backTo">← Retour à la classe</RouterLink>
      <button v-else class="btn sm ghost" type="button" @click="router.back()">← Retour</button>

      <!-- Scrolls rather than switches: the reason to open this screen is
           usually to hold two of these sections in one glance. -->
      <nav v-if="dossier" class="dossier-nav">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          class="dossier-navlink"
          type="button"
          @click="jump(s.id)"
        >{{ s.label }}</button>
      </nav>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="photoError" @close="photoError = null">{{ photoError }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <Alert v-else-if="error" :closable="false">{{ error }}</Alert>

    <template v-else-if="dossier">
      <!-- ── who ───────────────────────────────────────────────────────── -->
      <header id="identite" class="dossier-head">
        <div class="dossier-photo">
          <img v-if="photoSrc" :src="photoSrc" :alt="`Photo de ${fullName}`" />
          <span v-else class="dossier-initials" aria-hidden="true">{{ initials }}</span>

          <label class="dossier-photo-btn" :class="{ 'is-busy': photoBusy }">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="photoBusy"
              @change="onPickPhoto"
            />
            {{ photoSrc ? "Changer" : "Ajouter une photo" }}
          </label>
          <button
            v-if="photoSrc && !photoBusy"
            class="dossier-photo-rm"
            type="button"
            @click="removePhoto"
          >Retirer</button>
        </div>

        <div class="dossier-id">
          <h1 class="dossier-name">{{ fullName }}</h1>
          <div class="dossier-sub">
            Matricule {{ dossier.identity.matricule }}
            <template v-if="dossier.schooling.find((s) => s.isCurrent)">
              · {{ dossier.schooling.find((s) => s.isCurrent)!.classe }}
            </template>
          </div>

          <dl class="dossier-facts">
            <!-- One fact, not two: an état civil says "né le … à …", and
                 splitting it left a column headed "À" that means nothing on
                 its own. -->
            <div>
              <dt>Né(e) le</dt>
              <dd>
                {{ day(dossier.identity.birthDate) }}
                <template v-if="dossier.identity.birthPlace">
                  à {{ dossier.identity.birthPlace }}
                </template>
              </dd>
            </div>
            <div v-if="dossier.identity.gender"><dt>Sexe</dt><dd>{{ dossier.identity.gender }}</dd></div>
            <div v-if="dossier.identity.phone"><dt>Téléphone</dt><dd>{{ dossier.identity.phone }}</dd></div>
            <div v-if="dossier.identity.email"><dt>Email</dt><dd>{{ dossier.identity.email }}</dd></div>
            <div v-if="dossier.identity.address"><dt>Adresse</dt><dd>{{ dossier.identity.address }}</dd></div>
          </dl>
        </div>
      </header>

      <!-- The number a titulaire needs WHILE looking at anything else. -->
      <section v-if="dossier.guardians.length" class="dossier-section">
        <h2>Tuteurs</h2>
        <div class="dossier-grid">
          <div v-for="g in dossier.guardians" :key="g.personId" class="dossier-card">
            <div class="dossier-card-title">{{ g.lastName.toUpperCase() }} {{ g.firstName }}</div>
            <!-- The rôles sit with the relationship rather than beside the
                 name: two tags after a long name wrapped, and a card whose
                 first line breaks reads as two people. -->
            <div class="dossier-card-note">
              {{ g.relationship }}
              <span v-if="g.isPrimary" class="dossier-tag">contact</span>
              <span v-if="g.isPayer" class="dossier-tag">payeur</span>
            </div>
            <div v-if="g.phone" class="dossier-card-line">{{ g.phone }}</div>
            <div v-if="g.email" class="dossier-card-line">{{ g.email }}</div>
          </div>
        </div>
      </section>

      <!-- ── where they have been ──────────────────────────────────────── -->
      <section id="scolarite" class="dossier-section">
        <h2>Scolarité</h2>
        <table class="dossier-table">
          <thead>
            <tr><th>Année</th><th>Classe</th><th>Série</th><th>Statut</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in dossier.schooling" :key="e.id" :class="{ 'is-current': e.isCurrent }">
              <td>{{ e.year }}</td>
              <td>
                <RouterLink :to="{ name: 'unit', params: { id: e.classeId } }">{{ e.classe }}</RouterLink>
              </td>
              <td>{{ e.serie ?? "—" }}</td>
              <td>
                <template v-if="e.withdrawnOn">Sorti le {{ day(e.withdrawnOn) }}</template>
                <template v-else-if="e.isRepeating">Redoublant</template>
                <template v-else-if="e.isCurrent">En cours</template>
                <template v-else>Terminée</template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── what they owe ─────────────────────────────────────────────── -->
      <section id="finances" class="dossier-section">
        <h2>Finances</h2>
        <div class="dossier-figures">
          <div><span>Facturé</span><strong>{{ money(dossier.finance.billedXaf) }}</strong></div>
          <div><span>Réglé</span><strong>{{ money(dossier.finance.paidXaf) }}</strong></div>
          <div>
            <span>Solde</span>
            <strong :class="{ 'is-warn': dossier.finance.balanceXaf > 0 }">
              {{ money(dossier.finance.balanceXaf) }}
            </strong>
          </div>
        </div>

        <h3 v-if="dossier.finance.invoices.length" class="dossier-h3">Factures</h3>
        <table v-if="dossier.finance.invoices.length" class="dossier-table">
          <thead>
            <tr><th>Facture</th><th>Émise</th><th>Échéance</th><th>Statut</th><th class="c-num">Montant</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in dossier.finance.invoices" :key="i.id">
              <td>{{ i.number }}</td>
              <td>{{ day(i.issuedOn) }}</td>
              <td>{{ day(i.dueOn) }}</td>
              <td>{{ fr(INVOICE_FR, i.status) }}</td>
              <td class="c-num">{{ money(i.totalXaf) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="dossier-empty">Aucune facture émise.</p>

        <h3 v-if="dossier.finance.payments.length" class="dossier-h3">Règlements</h3>
        <table v-if="dossier.finance.payments.length" class="dossier-table">
          <thead>
            <tr><th>Règlement</th><th>Moyen</th><th>Référence</th><th class="c-num">Montant</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in dossier.finance.payments" :key="p.id">
              <td>{{ day(p.paidOn) }}</td>
              <td>{{ fr(METHOD_FR, p.method) }}</td>
              <td>{{ p.reference ?? "—" }}</td>
              <td class="c-num">{{ money(p.amountXaf) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── how they are doing ────────────────────────────────────────── -->
      <section id="resultats" class="dossier-section">
        <h2>Résultats</h2>
        <table v-if="dossier.academic.marksheets.length" class="dossier-table">
          <thead>
            <tr><th>Année</th><th>Période</th><th>Classe</th><th class="c-num">Moyenne</th><th class="c-num">Rang</th><th>Mention</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="m in dossier.academic.marksheets" :key="m.id">
              <td>{{ m.year }}</td>
              <td>{{ m.period }}</td>
              <td>{{ m.classe }}</td>
              <td class="c-num">{{ m.average ? Number(m.average).toFixed(2) : "—" }}</td>
              <td class="c-num">{{ m.rank ?? "—" }}<small v-if="m.rankOf">/{{ m.rankOf }}</small></td>
              <td>{{ m.mention ?? "—" }}</td>
              <td>
                <RouterLink
                  class="btn sm ghost"
                  :to="{
                    name: 'bulletin',
                    params: { id: dossier.identity.studentId },
                    query: { ...(m.periodId ? { period: m.periodId } : {}), from: route.query.from },
                  }"
                >Bulletin</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="dossier-empty">
          Aucun bulletin édité — le conseil de classe ne s'est pas encore tenu.
          <RouterLink
            class="btn sm ghost"
            :to="{ name: 'bulletin', params: { id: dossier.identity.studentId }, query: { from: route.query.from } }"
          >Voir le bulletin provisoire</RouterLink>
        </p>

        <h3 v-if="dossier.academic.decisions.length" class="dossier-h3">Décisions du conseil</h3>
        <div v-if="dossier.academic.decisions.length" class="dossier-grid">
          <div v-for="d in dossier.academic.decisions" :key="d.year" class="dossier-card">
            <div class="dossier-card-title">{{ d.year }}</div>
            <div class="dossier-card-note">{{ fr(DECISION_FR, d.kind) }}</div>
            <div v-if="d.note" class="dossier-card-line">{{ d.note }}</div>
          </div>
        </div>
      </section>

      <!-- ── how often they are there ──────────────────────────────────── -->
      <section id="assiduite" class="dossier-section">
        <h2>Assiduité<span v-if="dossier.attendance.classe" class="dossier-h2-note">
          · {{ dossier.attendance.classe }}</span></h2>
        <div class="dossier-figures">
          <div><span>Séances</span><strong>{{ dossier.attendance.sessions }}</strong></div>
          <div><span>Présent</span><strong>{{ dossier.attendance.present }}</strong></div>
          <div><span>Retards</span><strong>{{ dossier.attendance.late }}</strong></div>
          <div>
            <span>Absences</span>
            <strong :class="{ 'is-warn': dossier.attendance.absent > 0 }">{{ dossier.attendance.absent }}</strong>
          </div>
          <div><span>Excusé</span><strong>{{ dossier.attendance.excused }}</strong></div>
          <div>
            <span>Taux</span>
            <strong>{{ dossier.attendance.rate === null ? "—" : `${dossier.attendance.rate} %` }}</strong>
          </div>
        </div>
        <p v-if="!dossier.attendance.sessions" class="dossier-empty">
          Aucune séance pointée — l'appel se fait à partir de l'emploi du temps.
        </p>
      </section>
    </template>
  </div>
</template>
