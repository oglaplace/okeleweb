<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import Icon from "../../components/ui/Icon.vue";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import DialogShell from "../../components/ui/DialogShell.vue";
import AccessJournal from "../../components/console/AccessJournal.vue";
import { useAuthStore } from "../../stores/auth";
import { useBusyStore } from "../../stores/busy";
import { useBanner } from "../../lib/banner";

/**
 * MON COMPTE, ET QUI PEUT QUOI.
 *
 * The guards were built first and built well: a hundred-odd routes each name
 * the permission they need, Grant already carries (role, scope, permissions),
 * and the audit test refuses to let a new route ship undecided. What was
 * missing was any way for a DIRECTOR to use it. Every complex shipped with one
 * account holding everything and no screen could cut it down, so the comptable
 * was given the director's phone and the whole model sat switched off.
 *
 * Two halves, deliberately on one screen. The top is yours and always open —
 * your name, and a plain reading of what your own access lets you do, because
 * "pourquoi je ne vois pas les tarifs" is the question this answers without
 * anyone having to ask it. The bottom is everyone else's, and it is the only
 * part behind `team.admin`.
 */
const auth = useAuthStore();
const busy = useBusyStore();
const { notice, error } = useBanner();

const mayAdmin = computed(() => auth.isComplexAdmin);

/* ── mon compte ──────────────────────────────────────────────────────────── */
const me = ref({ fullName: "", email: "" });
const savingMe = ref(false);

/*
 * Compared against what the account ACTUALLY holds, both sides.
 *
 * This read `email.trim() !== ""` — "dirty whenever the box has anything in
 * it" — which was wrong in both directions: you could not clear an address,
 * and because the box was never filled from the profile in the first place,
 * saving a corrected name posted `email: null` and silently wiped one.
 */
const meDirty = computed(
  () =>
    me.value.fullName.trim() !== (auth.profile?.fullName ?? "") ||
    me.value.email.trim() !== (auth.profile?.email ?? ""),
);

async function saveMe() {
  if (!me.value.fullName.trim()) return;
  savingMe.value = true;
  error.value = null;
  try {
    const updated = await busy.run(
      () => api.team.updateSelf({
        fullName: me.value.fullName.trim(),
        email: me.value.email.trim() || null,
      }),
      { title: "Mise à jour du compte", detail: "Enregistrement de vos informations." },
    );
    if (auth.profile) {
      auth.profile.fullName = updated.fullName;
      auth.profile.email = updated.email ?? null;
    }
    me.value.email = updated.email ?? "";
    notice.value = "Compte mis à jour.";
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Mise à jour impossible.";
  } finally {
    savingMe.value = false;
  }
}

/* ── le catalogue ────────────────────────────────────────────────────────── */
const catalogue = ref<api.PermissionInfo[]>([]);
const groups = ref<{ id: api.PermissionGroup; label: string }[]>([]);
const loading = ref(true);

/** My own ticks, explained — the same list, read-only. */
const mine = computed(() =>
  catalogue.value.filter((p) => auth.can(p.key)),
);

/*
 * ON N'OFFRE QUE CE QU'ON DÉTIENT.
 *
 * The API refuses granting a permission the caller does not hold, so showing
 * the full catalogue would be showing boxes that can only produce an error.
 * A director sees everything because they hold everything; a chef comptable
 * sees the finance rows and nothing else.
 */
const grantable = computed(() =>
  catalogue.value.filter((p) => auth.can(p.key)),
);
const inGroup = (g: api.PermissionGroup) =>
  grantable.value.filter((p) => p.group === g);
/** Groups with nothing in them for this caller are not shown at all. */
const visibleGroups = computed(() =>
  groups.value.filter((g) => inGroup(g.id).length > 0),
);

/* ── l'équipe ────────────────────────────────────────────────────────────── */
const members = ref<api.TeamMember[]>([]);
/**
 * Les employés sans compte.
 *
 * Calculés par l'API, jamais stockés : c'est l'écart entre « qui travaille
 * ici » et « qui peut entrer », et le directeur vient sur cet écran pour le
 * regarder. Une liste vide est une bonne nouvelle, pas un écran vide.
 */
const pending = ref<api.PendingMember[]>([]);
const editing = ref<string | null>(null);
/** The ticks being edited, before they are saved. */
const draft = ref<Set<string>>(new Set());
const draftRole = ref("");
const saving = ref(false);

const editingMember = computed(() =>
  members.value.find((m) => m.accountId === editing.value) ?? null,
);

function startEdit(m: api.TeamMember) {
  // The API decides; this only stops the click reaching a refusal.
  if (!m.manageable) return;
  editing.value = m.accountId;
  draft.value = new Set(m.permissions);
  draftRole.value = m.role === "Sans rôle" ? "" : m.role;
}

function toggle(key: string) {
  const next = new Set(draft.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  draft.value = next;
}

/**
 * Cocher TOUT revient à se donner un égal — et un égal ne se modifie plus.
 *
 * The consequence of the peer rule, said before the click rather than
 * discovered afterwards: promote somebody to your own set and neither of you
 * can touch the other again.
 */
const makesPeer = computed(() => {
  const held = auth.profile?.permissions ?? [];
  if (!held.length) return false;
  return held.every((p) => draft.value.has(p)) && draft.value.size >= held.length;
});

/** Has anything actually changed? Saving an unchanged list is a wasted write. */
const dirty = computed(() => {
  const m = editingMember.value;
  if (!m) return false;
  const before = [...m.permissions].sort().join(",");
  const after = [...draft.value].sort().join(",");
  return before !== after || draftRole.value.trim() !== (m.role === "Sans rôle" ? "" : m.role);
});

async function saveGrants() {
  const m = editingMember.value;
  if (!m || !dirty.value) return;
  saving.value = true;
  error.value = null;
  try {
    await busy.run(
      () => api.team.setPermissions(m.accountId, [...draft.value], draftRole.value.trim() || undefined),
      { title: "Mise à jour des accès", detail: m.fullName },
    );
    notice.value = `Accès de ${m.fullName} mis à jour.`;
    editing.value = null;
    await loadTeam();
  } catch (e) {
    // The API refuses the two lockouts — last team.admin, and your own. Its
    // message says which and what to do instead, so it is shown verbatim.
    error.value = e instanceof api.ApiError ? e.message : "Mise à jour impossible.";
  } finally {
    saving.value = false;
  }
}

async function toggleActive(m: api.TeamMember) {
  error.value = null;
  try {
    await busy.run(() => api.team.setActive(m.accountId, !m.active));
    notice.value = m.active ? `${m.fullName} suspendu(e).` : `${m.fullName} réactivé(e).`;
    await Promise.all([loadTeam(), loadJournal()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Action impossible.";
  }
}

/* ── inviter ─────────────────────────────────────────────────────────────── */
const inviting = ref(false);
const invite = ref({
  fullName: "", phone: "", email: "", role: "Personnel",
  /** Renseigné quand l'invitation part d'un employé déjà en fiche. */
  personId: null as string | null,
});
const invitePerms = ref<Set<string>>(new Set());

const canInvite = computed(
  () => invite.value.fullName.trim().length >= 2 && invite.value.phone.trim().length >= 6,
);

/**
 * « Donner l'accès » depuis la liste d'attente.
 *
 * Le même formulaire, pré-rempli avec ce que la fiche sait déjà — et
 * `personId` emporté avec, pour que le compte créé SOIT cet employé et non
 * un homonyme de plus dans la base.
 */
function grantTo(p: api.PendingMember) {
  invite.value = {
    fullName: p.fullName,
    phone: p.phone ?? "",
    email: p.email ?? "",
    role: p.role,
    personId: p.personId,
  };
  invitePerms.value = new Set();
  inviting.value = true;
}

function cancelInvite() {
  inviting.value = false;
  invite.value = { fullName: "", phone: "", email: "", role: "Personnel", personId: null };
  invitePerms.value = new Set();
}

async function sendInvite() {
  if (!canInvite.value) return;
  error.value = null;
  try {
    await busy.run(
      () => api.team.invite({
        fullName: invite.value.fullName.trim(),
        phone: invite.value.phone.trim(),
        // Optional, and null rather than "" when left blank — an empty string
        // is not an address and the column should say so.
        email: invite.value.email.trim() || null,
        role: invite.value.role.trim() || "Personnel",
        permissions: [...invitePerms.value],
        personId: invite.value.personId,
      }),
      { title: "Invitation", detail: "Création du compte et des accès." },
    );
    notice.value =
      `${invite.value.fullName} peut maintenant se connecter avec ce numéro.`;
    cancelInvite();
    await Promise.all([loadTeam(), loadJournal()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Invitation impossible.";
  }
}

function toggleInvite(key: string) {
  const next = new Set(invitePerms.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  invitePerms.value = next;
}

/* ── le journal ──────────────────────────────────────────────────────────── */
/**
 * RÉSERVÉ À CEUX QUI ADMINISTRENT LES ACCÈS.
 *
 * Il était chargé pour tout le monde, sur l'idée qu'un registre de qui a reçu
 * quoi tient les gens honnêtes précisément parce qu'il n'est pas lui-même
 * privilégié. Trop optimiste: il nomme qui peut encaisser, qui peut délibérer,
 * qui a été suspendu — la carte de ce qu'il faudrait obtenir pour arriver à
 * ses fins. L'API le refuse désormais; l'écran ne le demande plus.
 */
const events = ref<api.AccessEvent[]>([]);
const journalLoading = ref(true);

async function loadJournal() {
  if (!mayAdmin.value) {
    journalLoading.value = false;
    return;
  }
  try {
    events.value = (await api.team.history(50)).events;
  } catch {
    // A trail that fails to load must not take the settings screen with it.
    events.value = [];
  } finally {
    journalLoading.value = false;
  }
}

/* ── chargement ──────────────────────────────────────────────────────────── */
async function loadTeam() {
  if (!mayAdmin.value) return;
  const res = await api.team.list();
  members.value = res.members;
  pending.value = res.pending;
}

onMounted(async () => {
  me.value.fullName = auth.profile?.fullName ?? "";
  me.value.email = auth.profile?.email ?? "";
  try {
    const cat = await api.team.catalogue();
    catalogue.value = cat.permissions;
    groups.value = cat.groups;
    await Promise.all([loadTeam(), loadJournal()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR") : "jamais";
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Paramètres</h1>
        <div class="page-sub">
          Votre compte, et — si vous en avez le droit — ce que chaque collègue
          peut faire dans l'établissement.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <!-- ── mon compte ───────────────────────────────────────────────────── -->
    <div class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">Mon compte</div>
      <div class="card-body">
        <div class="field-row">
          <div class="field">
            <label for="me-name">Nom complet</label>
            <input id="me-name" v-model="me.fullName" autocomplete="name" />
          </div>
          <div class="field">
            <label for="me-mail">E-mail</label>
            <input id="me-mail" v-model="me.email" type="email" autocomplete="email"
                   placeholder="facultatif" />
            <span class="hint">Pour recevoir les documents. La connexion reste par téléphone.</span>
          </div>
          <div class="field">
            <label>Téléphone</label>
            <!-- Not editable here: the number IS the identity, and changing it
                 is changing which Firebase account this is. -->
            <input :value="auth.profile?.phone ?? ''" disabled />
            <span class="hint">C'est votre identifiant de connexion.</span>
          </div>
        </div>
        <button class="btn primary" type="button"
                :disabled="savingMe || !me.fullName.trim() || !meDirty"
                @click="saveMe">
          Enregistrer
        </button>
      </div>
    </div>

    <!-- ── mes accès ────────────────────────────────────────────────────── -->
    <div class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        Mes accès
        <span class="unit-meta">{{ auth.profile?.complexName }}</span>
      </div>
      <div class="card-body">
        <p v-if="!mine.length && !loading" class="verify-sub" style="margin: 0">
          Aucun droit particulier ne vous est accordé pour l'instant.
          Demandez à la direction de vous en attribuer.
        </p>
        <ul v-else class="perm-mine">
          <li v-for="p in mine" :key="p.key">
            <Icon name="check" :size="13" />
            <span><strong>{{ p.label }}</strong> — {{ p.description }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ── en attente d'accès ───────────────────────────────────────────── -->
    <!--
      L'écart entre « qui travaille ici » et « qui peut entrer ».

      Placé AVANT la liste de l'équipe, parce que c'est la seule chose de cet
      écran qui demande une action : la liste du dessous décrit un état, celle-ci
      décrit un oubli. Absente quand il n'y en a pas — un bloc « rien à faire »
      permanent finit par ne plus être lu du tout.
    -->
    <div v-if="mayAdmin && pending.length" class="card" style="margin-bottom: var(--s4)">
      <div class="card-head">
        En attente d'accès
        <span class="unit-meta">
          {{ pending.length }} personne(s) du personnel n'ont pas encore de compte
        </span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Personne</th>
              <th class="c-text">Fonction</th>
              <th class="c-text">Affectation</th>
              <th class="c-text" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pending" :key="p.employmentId">
              <td class="c-name">
                <span class="cell-strong">{{ p.fullName }}</span>
                <span class="cell-sub">
                  <template v-if="p.phone">{{ p.phone }}</template>
                  <!-- Dit avant le clic : le formulaire s'ouvrira avec un
                       champ téléphone vide, et c'est par là qu'on se connecte. -->
                  <template v-else>numéro à renseigner</template>
                  <template v-if="p.email"> · {{ p.email }}</template>
                </span>
              </td>
              <td class="c-text">{{ p.role }}</td>
              <td class="c-text">{{ p.unit ?? "—" }}</td>
              <td class="c-text">
                <button class="btn sm primary" type="button" @click="grantTo(p)">
                  Donner l'accès
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── l'équipe ─────────────────────────────────────────────────────── -->
    <div v-if="mayAdmin" class="card">
      <div class="card-head">
        Accès de l'équipe
        <button v-if="!inviting" class="btn sm" type="button" @click="inviting = true">
          Inviter un collègue
        </button>
      </div>

      <!-- inviter -->
      <div v-if="inviting" class="card-body" style="border-bottom: 1px solid var(--line-soft)">
        <!-- Pré-rempli depuis la fiche : on le dit, pour que le nom qui
             apparaît tout seul dans le formulaire ne surprenne personne. -->
        <p v-if="invite.personId" class="verify-sub" style="margin: 0 0 var(--s3)">
          <strong>{{ invite.fullName }}</strong> fait déjà partie du personnel.
          Choisissez ce qu'il ou elle pourra faire, et confirmez le numéro de
          connexion.
        </p>
        <div class="field-row">
          <div class="field">
            <label for="inv-name">Nom complet</label>
            <input id="inv-name" v-model="invite.fullName" autocomplete="off" />
          </div>
          <div class="field">
            <label for="inv-ph">Téléphone</label>
            <PhoneInput id="inv-ph" v-model="invite.phone" />
            <span class="hint">C'est avec ce numéro qu'il ou elle se connectera.</span>
          </div>
          <div class="field">
            <label for="inv-mail">E-mail</label>
            <input id="inv-mail" v-model="invite.email" type="email" autocomplete="off"
                   placeholder="facultatif" />
            <span class="hint">Pour les documents. La connexion reste par téléphone.</span>
          </div>
          <div class="field">
            <label for="inv-role">Fonction</label>
            <input id="inv-role" v-model="invite.role" autocomplete="off"
                   placeholder="Comptable, Censeur…" />
          </div>
        </div>
        <div class="perm-grid">
          <div v-for="g in visibleGroups" :key="g.id" class="perm-group">
            <div class="perm-group-head">{{ g.label }}</div>
            <label v-for="p in inGroup(g.id)" :key="p.key" class="perm-row">
              <input type="checkbox" :checked="invitePerms.has(p.key)" @change="toggleInvite(p.key)" />
              <span>
                <strong :class="{ 'is-danger': p.danger }">{{ p.label }}</strong>
                <span class="perm-desc">{{ p.description }}</span>
              </span>
            </label>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn primary" type="button" :disabled="!canInvite" @click="sendInvite">
            Créer le compte
          </button>
          <button class="btn ghost" type="button" @click="cancelInvite">Annuler</button>
        </div>
      </div>

      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 45%" /><div class="skeleton" style="width: 70%" />
      </div>

      <div v-else-if="!members.length" class="empty">
        <div class="empty-title">Vous êtes seul(e) pour l'instant</div>
        <div v-if="pending.length">
          Le personnel est enregistré, mais personne n'a encore de compte —
          donnez l'accès depuis la liste ci-dessus.
        </div>
        <div v-else>Invitez un collègue pour lui confier une partie du travail.</div>
      </div>

      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Personne</th>
              <th class="c-text">Fonction</th>
              <th class="c-text">Accès</th>
              <th class="c-text">Dernière visite</th>
              <th class="c-text" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.accountId" :class="{ 'is-muted': !m.active }">
              <td class="c-name">
                <span class="cell-strong">{{ m.fullName }}</span>
                <span class="cell-sub">
                  {{ m.phone }}<template v-if="m.email"> · {{ m.email }}</template>
                  <template v-if="!m.active"> · suspendu</template>
                </span>
              </td>
              <td class="c-text">{{ m.role }}</td>
              <td class="c-text">
                <span v-if="!m.permissions.length" class="cell-sub">aucun</span>
                <span v-else>{{ m.permissions.length }} droit(s)</span>
                <!-- Why this row cannot be touched, in the API's own words.
                     A disabled button with no reason is the thing that makes
                     a screen feel broken. -->
                <span v-if="m.blockedReason" class="cell-sub">{{ m.blockedReason }}</span>
              </td>
              <td class="c-text">{{ when(m.lastSeenAt) }}</td>
              <td class="c-text">
                <div class="row-actions">
                  <button class="btn sm" type="button"
                          :disabled="!m.manageable" :title="m.blockedReason ?? undefined"
                          @click="startEdit(m)">
                    Modifier
                  </button>
                  <button class="btn sm ghost" type="button"
                          :disabled="!m.manageable" :title="m.blockedReason ?? undefined"
                          @click="toggleActive(m)">
                    {{ m.active ? "Suspendre" : "Réactiver" }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── le journal ───────────────────────────────────────────────────── -->
    <div v-if="mayAdmin" class="card" style="margin-top: var(--s4)">
      <div class="card-head">
        Journal des accès
        <span class="unit-meta">qui a changé quoi, et quand</span>
      </div>
      <AccessJournal
        :events="events"
        :catalogue="catalogue"
        :loading="journalLoading"
        empty="Les modifications d'accès apparaîtront ici."
      />
    </div>

    <!-- ── LA MATRICE, DANS UN DIALOGUE ───────────────────────────────────
         Elle vivait dans une cellule de tableau, et c'est ce qui était cassé :
         `.table-wrap` scrolle horizontalement et `table.data` impose 560px de
         large, donc une grille de cinq groupes à 260px minimum poussait le
         tableau bien au-delà de l'écran. Il fallait scroller latéralement pour
         atteindre « Enregistrer », et les cases de droite étaient hors champ.
         DialogShell est la surface que le reste de la console utilise déjà
         pour exactement ça. -->
    <DialogShell
      v-if="editingMember"
      :title="`Accès de ${editingMember.fullName}`"
      :subtitle="editingMember.role"
      :detail="editingMember.phone"
      icon="settings"
      wide
      @close="editing = null"
    >
      <div class="field" style="max-width: 320px">
        <label for="edit-role">Fonction</label>
        <input id="edit-role" v-model="draftRole" placeholder="Comptable, Censeur…" />
        <span class="hint">Le libellé affiché. Ce sont les cases ci-dessous qui décident.</span>
      </div>

      <div class="perm-grid">
        <div v-for="g in visibleGroups" :key="g.id" class="perm-group">
          <div class="perm-group-head">{{ g.label }}</div>
          <label v-for="p in inGroup(g.id)" :key="p.key" class="perm-row">
            <input type="checkbox" :checked="draft.has(p.key)" @change="toggle(p.key)" />
            <span>
              <strong :class="{ 'is-danger': p.danger }">{{ p.label }}</strong>
              <span class="perm-desc">{{ p.description }}</span>
            </span>
          </label>
        </div>
      </div>

      <Alert v-if="makesPeer" kind="warn">
        Avec toutes ces cases, cette personne aura exactement vos droits — vous
        ne pourrez plus modifier son accès, ni elle le vôtre.
      </Alert>

      <div class="row-actions">
        <button class="btn primary" type="button" :disabled="!dirty || saving"
                @click="saveGrants">
          Enregistrer les accès
        </button>
        <button class="btn ghost" type="button" @click="editing = null">Annuler</button>
      </div>
    </DialogShell>
  </div>
</template>

<style scoped>
.perm-mine {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.perm-mine li {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  font-size: var(--t-small);
  color: var(--ink-2);
}
.perm-mine :deep(svg) {
  color: var(--ok);
  flex: none;
  margin-top: 2px;
}

.row-actions {
  display: flex;
  gap: var(--s2);
  align-items: center;
}
tr.is-muted td {
  opacity: 0.55;
}
</style>
