<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import Icon from "../../components/ui/Icon.vue";
import PhoneInput from "../../components/ui/PhoneInput.vue";
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

const meDirty = computed(
  () =>
    me.value.fullName.trim() !== (auth.profile?.fullName ?? "") ||
    me.value.email.trim() !== "",
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
    if (auth.profile) auth.profile.fullName = updated.fullName;
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

const inGroup = (g: api.PermissionGroup) =>
  catalogue.value.filter((p) => p.group === g);

/* ── l'équipe ────────────────────────────────────────────────────────────── */
const members = ref<api.TeamMember[]>([]);
const editing = ref<string | null>(null);
/** The ticks being edited, before they are saved. */
const draft = ref<Set<string>>(new Set());
const draftRole = ref("");
const saving = ref(false);

const editingMember = computed(() =>
  members.value.find((m) => m.accountId === editing.value) ?? null,
);

function startEdit(m: api.TeamMember) {
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
    await loadTeam();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Action impossible.";
  }
}

/* ── inviter ─────────────────────────────────────────────────────────────── */
const inviting = ref(false);
const invite = ref({ fullName: "", phone: "", role: "Personnel" });
const invitePerms = ref<Set<string>>(new Set());

const canInvite = computed(
  () => invite.value.fullName.trim().length >= 2 && invite.value.phone.trim().length >= 6,
);

async function sendInvite() {
  if (!canInvite.value) return;
  error.value = null;
  try {
    await busy.run(
      () => api.team.invite({
        fullName: invite.value.fullName.trim(),
        phone: invite.value.phone.trim(),
        role: invite.value.role.trim() || "Personnel",
        permissions: [...invitePerms.value],
      }),
      { title: "Invitation", detail: "Création du compte et des accès." },
    );
    notice.value =
      `${invite.value.fullName} peut maintenant se connecter avec ce numéro.`;
    inviting.value = false;
    invite.value = { fullName: "", phone: "", role: "Personnel" };
    invitePerms.value = new Set();
    await loadTeam();
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

/* ── chargement ──────────────────────────────────────────────────────────── */
async function loadTeam() {
  if (!mayAdmin.value) return;
  const res = await api.team.list();
  members.value = res.members;
}

onMounted(async () => {
  me.value.fullName = auth.profile?.fullName ?? "";
  try {
    const cat = await api.team.catalogue();
    catalogue.value = cat.permissions;
    groups.value = cat.groups;
    await loadTeam();
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
            <label for="inv-role">Fonction</label>
            <input id="inv-role" v-model="invite.role" autocomplete="off"
                   placeholder="Comptable, Censeur…" />
          </div>
        </div>
        <div class="perm-grid">
          <div v-for="g in groups" :key="g.id" class="perm-group">
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
          <button class="btn ghost" type="button" @click="inviting = false">Annuler</button>
        </div>
      </div>

      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 45%" /><div class="skeleton" style="width: 70%" />
      </div>

      <div v-else-if="!members.length" class="empty">
        <div class="empty-title">Vous êtes seul(e) pour l'instant</div>
        <div>Invitez un collègue pour lui confier une partie du travail.</div>
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
            <template v-for="m in members" :key="m.accountId">
              <tr :class="{ 'is-muted': !m.active }">
                <td class="c-name">
                  <span class="cell-strong">{{ m.fullName }}</span>
                  <span class="cell-sub">
                    {{ m.phone }}<template v-if="!m.active"> · suspendu</template>
                  </span>
                </td>
                <td class="c-text">{{ m.role }}</td>
                <td class="c-text">
                  <span v-if="!m.permissions.length" class="cell-sub">aucun</span>
                  <span v-else>{{ m.permissions.length }} droit(s)</span>
                  <!-- A scoped grant is honoured by the API but not edited
                       here; saying so beats a disabled button with no reason. -->
                  <span v-if="m.scoped" class="cell-sub">limité à une unité</span>
                </td>
                <td class="c-text">{{ when(m.lastSeenAt) }}</td>
                <td class="c-text">
                  <div class="row-actions">
                    <button class="btn sm" type="button" :disabled="m.scoped"
                            @click="editing === m.accountId ? (editing = null) : startEdit(m)">
                      {{ editing === m.accountId ? "Fermer" : "Modifier" }}
                    </button>
                    <button class="btn sm ghost" type="button" @click="toggleActive(m)">
                      {{ m.active ? "Suspendre" : "Réactiver" }}
                    </button>
                  </div>
                </td>
              </tr>

              <!-- la matrice, ouverte sous la ligne -->
              <tr v-if="editing === m.accountId">
                <td colspan="5" class="perm-cell">
                  <div class="field" style="max-width: 280px">
                    <label :for="`role-${m.accountId}`">Fonction</label>
                    <input :id="`role-${m.accountId}`" v-model="draftRole"
                           placeholder="Comptable, Censeur…" />
                  </div>
                  <div class="perm-grid">
                    <div v-for="g in groups" :key="g.id" class="perm-group">
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
                  <div class="row-actions">
                    <button class="btn primary" type="button" :disabled="!dirty || saving"
                            @click="saveGrants">
                      Enregistrer les accès
                    </button>
                    <button class="btn ghost" type="button" @click="editing = null">Annuler</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
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

.perm-cell {
  background: var(--surface-2);
  padding: var(--s4);
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--s4);
  margin: var(--s3) 0;
}
.perm-group-head {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: var(--s2);
}
.perm-row {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  padding: 5px 0;
  cursor: pointer;
}
.perm-row input {
  margin-top: 3px;
  flex: none;
}
.perm-row strong {
  display: block;
  font-size: var(--t-small);
  font-weight: 600;
  color: var(--ink);
}
/* Money and authority itself. Grantable like any other, just not ordinary. */
.perm-row strong.is-danger {
  color: var(--warn);
}
.perm-desc {
  display: block;
  font-size: var(--t-small);
  color: var(--ink-3);
  line-height: 1.35;
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
