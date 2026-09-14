<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import PhoneInput from "../../components/ui/PhoneInput.vue";
import { ESTABLISHMENT_LABELS, TIER_LABELS, TIER_NOTES } from "./labels";
import Alert from "../../components/ui/Alert.vue";
import { useBanner } from "../../lib/banner";
import DialogShell from "../../components/ui/DialogShell.vue";
import AccessJournal from "../../components/console/AccessJournal.vue";

/**
 * One établissement's registration record.
 *
 * What is deliberately NOT here: any of the school's own data. A platform
 * account holds no tenant, so the API refuses every academic and financial
 * query it makes — see the API's shared/tenancy.ts. This page shows what an
 * operator legitimately administers (who can sign in, which formula, which
 * boxes) and nothing about a single pupil.
 */
const route = useRoute();
const busy = useBusyStore();
const id = route.params.id as string;

/* ── support : les accès de cet établissement ──────────────────────────────
 *
 * A school phones because its only administrator has left, or because somebody
 * holds the wrong thing and nobody inside can take it back. Until now the only
 * answer was a psql prompt.
 *
 * These go through the SAME service the school's own console uses — same
 * guards, same audit lines — with the tenant's scope opened around the call.
 * The peer and escalation rules are lifted, because they describe colleagues
 * acting on each other and say nothing about an operator acting on a customer.
 * The act is written down instead of constrained: every one lands in that
 * établissement's own journal, marked "(support)", where its members read it.
 */
const members = ref<api.TeamMember[]>([]);
const events = ref<api.AccessEvent[]>([]);
const catalogue = ref<api.PermissionInfo[]>([]);
const permGroups = ref<{ id: api.PermissionGroup; label: string }[]>([]);
const accessLoading = ref(true);

const editing = ref<string | null>(null);
const draft = ref<Set<string>>(new Set());
const draftRole = ref("");
const savingAccess = ref(false);

const editingMember = computed(() =>
  members.value.find((m) => m.accountId === editing.value) ?? null,
);

const inGroup = (g: api.PermissionGroup) =>
  catalogue.value.filter((p) => p.group === g);

function startEdit(m: api.TeamMember) {
  editing.value = m.accountId;
  draft.value = new Set(m.permissions);
  draftRole.value = m.role === "Sans rôle" ? "" : m.role;
}

function togglePerm(key: string) {
  const next = new Set(draft.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  draft.value = next;
}

const accessDirty = computed(() => {
  const m = editingMember.value;
  if (!m) return false;
  const before = [...m.permissions].sort().join(",");
  const after = [...draft.value].sort().join(",");
  return before !== after || draftRole.value.trim() !== (m.role === "Sans rôle" ? "" : m.role);
});

async function loadAccess() {
  accessLoading.value = true;
  try {
    const [res, cat] = await Promise.all([
      api.platform.accounts(id),
      catalogue.value.length
        ? Promise.resolve({ permissions: catalogue.value, groups: permGroups.value })
        : api.team.catalogue(),
    ]);
    members.value = res.members;
    events.value = res.events;
    catalogue.value = cat.permissions;
    permGroups.value = cat.groups;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Accès illisibles.";
  } finally {
    accessLoading.value = false;
  }
}

async function saveAccess() {
  const m = editingMember.value;
  if (!m || !accessDirty.value) return;
  savingAccess.value = true;
  error.value = null;
  try {
    await busy.run(
      () => api.platform.setAccountPermissions(
        id, m.accountId, [...draft.value], draftRole.value.trim() || undefined),
      { title: "Mise à jour des accès", detail: m.fullName },
    );
    notice.value = `Accès de ${m.fullName} mis à jour.`;
    editing.value = null;
    await Promise.all([load(), loadAccess()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Mise à jour impossible.";
  } finally {
    savingAccess.value = false;
  }
}

async function toggleAccountActive(m: api.TeamMember) {
  error.value = null;
  try {
    await busy.run(
      () => api.platform.setAccountActive(id, m.accountId, !m.active),
      { title: "Mise à jour du compte", detail: m.fullName },
    );
    notice.value = m.active ? `${m.fullName} suspendu(e).` : `${m.fullName} réactivé(e).`;
    await Promise.all([load(), loadAccess()]);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Action impossible.";
  }
}

/** The richer row for one listed account, when access has loaded. */
const memberOf = (accountId: string) =>
  members.value.find((m) => m.accountId === accountId) ?? null;

const data = ref<api.TenantDetail | null>(null);
const loading = ref(true);
const { notice, error } = useBanner();

// Add-administrator form.
const adding = ref(false);
const newName = ref("");
const newPhone = ref("");
const newRole = ref("Administrateur");
const addBusy = ref(false);
const addError = ref<string | null>(null);

const phoneValid = computed(() => /^\+242\d{9}$/.test(newPhone.value));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await busy.run(() => api.platform.tenant(id));
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

async function addAdmin() {
  if (!phoneValid.value || newName.value.trim().length < 2) return;
  addBusy.value = true;
  addError.value = null;
  try {
    // Blocking: this mints a Firebase identity for someone who is probably on
    // the phone waiting to be told they can sign in.
    await busy.run(
      () =>
        api.platform.addAdmin(id, {
          phone: newPhone.value,
          fullName: newName.value.trim(),
          ...(newRole.value.trim() ? { role: newRole.value.trim() } : {}),
        }),
      {
        title: "Ajout de l'administrateur",
        detail: "Création du compte et des droits sur cet établissement.",
      },
    );
    notice.value = `${newName.value.trim()} peut désormais se connecter.`;
    newName.value = "";
    newPhone.value = "";
    adding.value = false;
    await load();
  } catch (e) {
    addError.value = e instanceof api.ApiError ? e.message : "Ajout impossible.";
  } finally {
    addBusy.value = false;
  }
}

async function setActive(active: boolean) {
  try {
    await busy.run(
      () => api.platform.updateTenant(id, { active }),
      {
        title: active ? "Réactivation" : "Suspension",
        detail: active
          ? "L'établissement redevient accessible à son personnel."
          : "Le personnel de l'établissement ne pourra plus se connecter.",
      },
    );
    notice.value = active ? "Établissement réactivé." : "Établissement suspendu.";
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Modification impossible.";
  }
}

/** Two initials for the row mark, same convention as the sidebar avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "—";

onMounted(() => {
  void load();
  void loadAccess();
});
</script>

<template>
  <div>
    <RouterLink class="crumb-back" :to="{ name: 'tenants' }">← Établissements</RouterLink>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="width: 35%" />
        <div class="skeleton" style="width: 60%" />
      </div>
    </div>

    <!-- The load failed: this banner is the whole page, so it has no
         close button — there is nothing behind it to reveal. -->
    <Alert v-else-if="error" :closable="false">{{ error }}</Alert>

    <template v-else-if="data">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ data.tenant.name }}</h1>
          <div class="page-sub">
            {{ ESTABLISHMENT_LABELS[data.tenant.establishmentType ?? "COMPLEXE"] }} ·
            {{ data.tenant.slug }} · enregistré le {{ dateFmt(data.tenant.createdAt) }}
          </div>
        </div>
        <div class="page-actions">
          <button
            v-if="data.tenant.active"
            class="btn"
            type="button"
            @click="setActive(false)"
          >
            Suspendre
          </button>
          <button v-else class="btn primary" type="button" @click="setActive(true)">
            Réactiver
          </button>
        </div>
      </div>

      <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>

      <div class="grid-cards" style="margin-bottom: var(--s5)">
        <div class="stat">
          <div class="stat-label">Formule</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ TIER_LABELS[data.tenant.tier] }}
          </div>
          <div class="stat-note">{{ TIER_NOTES[data.tenant.tier] }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Écriture</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ data.tenant.authority === "EDGE" ? "Serveur local" : "Cloud" }}
          </div>
          <div class="stat-note">
            {{
              data.tenant.migrationLockedAt
                ? "Migration en cours — écritures suspendues."
                : "Nœud autorisé à enregistrer."
            }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Année en cours</div>
          <div class="stat-value" style="font-size: var(--t-h2)">
            {{ data.academicYears.find((y) => y.isCurrent)?.label ?? "—" }}
          </div>
          <div class="stat-note">{{ data.academicYears.length }} année(s) enregistrée(s)</div>
        </div>
      </div>

      <div class="stack">
        <div class="card is-grid">
          <div class="card-head">
            Personnes pouvant se connecter
            <button
              v-if="!adding"
              class="btn sm"
              type="button"
              @click="adding = true"
            >
              Ajouter
            </button>
          </div>

          <div v-if="adding" class="card-body" style="border-bottom: 1px solid var(--line-soft)">
            <Alert v-if="addError" kind="error" @close="addError = null">{{ addError }}</Alert>
            <div class="field-row">
              <div class="field">
                <label for="new-name">Nom complet</label>
                <input id="new-name" v-model="newName" autocomplete="off" />
              </div>
              <div class="field">
                <label for="new-phone">Téléphone</label>
                <PhoneInput
                  id="new-phone"
                  v-model="newPhone"
                  :invalid="newPhone.length > 0 && !phoneValid"
                />
              </div>
              <div class="field">
                <label for="new-role">Fonction</label>
                <input id="new-role" v-model="newRole" autocomplete="off" />
              </div>
            </div>
            <div class="form-actions">
              <button
                class="btn primary"
                type="button"
                :disabled="addBusy || !phoneValid || newName.trim().length < 2"
                @click="addAdmin"
              >
                <span v-if="addBusy" class="btn-spin" aria-hidden="true" />
                {{ addBusy ? "Ajout…" : "Ajouter l'administrateur" }}
              </button>
              <button class="btn ghost" type="button" @click="adding = false">Annuler</button>
            </div>
          </div>

          <div v-if="!data.admins.length" class="empty">
            Aucun compte. Personne ne peut ouvrir cet établissement.
          </div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Personne</th>
                  <th>Téléphone</th>
                  <th>Dernière connexion</th>
                  <th>État</th>
                  <th class="c-text" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in data.admins" :key="a.id">
                  <td class="c-name">
                    <span class="cell-id">
                      <span class="row-mark" aria-hidden="true">{{ initials(a.fullName) }}</span>
                      <span class="row-text">
                        <span class="cell-strong">{{ a.fullName }}</span>
                        <span class="cell-sub">{{ a.roles.join(", ") || "—" }}</span>
                      </span>
                    </span>
                  </td>
                  <td>{{ a.phone }}</td>
                  <td>{{ dateFmt(a.lastSeenAt) }}</td>
                  <td>
                    <span v-if="a.active" class="pill ok">Actif</span>
                    <span v-else class="pill danger">Désactivé</span>
                  </td>
                  <td class="c-text">
                    <!-- The support console may act on ANY account here: the
                         peer rules order colleagues, not an operator and a
                         customer. Every click is written to the journal below. -->
                    <div class="row-actions" v-if="memberOf(a.id)">
                      <button class="btn sm" type="button" @click="startEdit(memberOf(a.id)!)">
                        Accès ({{ memberOf(a.id)!.permissions.length }})
                      </button>
                      <button class="btn sm ghost" type="button"
                              @click="toggleAccountActive(memberOf(a.id)!)">
                        {{ a.active ? "Suspendre" : "Réactiver" }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            Journal des accès
            <span class="unit-meta">visible aussi par l'établissement</span>
          </div>
          <AccessJournal
            :events="events"
            :catalogue="catalogue"
            :loading="accessLoading"
            empty="Aucune modification d'accès enregistrée."
          />
        </div>

        <div class="card">
          <div class="card-head">Structure</div>
          <div class="card-body">
            <p style="color: var(--ink-2); margin: 0">
              Racine :
              <strong>{{ data.root?.name ?? "—" }}</strong>
              <span class="unit-meta"> · {{ data.root?.code ?? "—" }}</span>
            </p>
            <p style="color: var(--ink-3); font-size: var(--t-small); margin: var(--s2) 0 0">
              Les écoles, cycles, niveaux et classes se créent depuis la console de
              l'établissement, par son administrateur.
            </p>
          </div>
        </div>

        <div v-if="data.edgeNodes.length" class="card is-grid">
          <div class="card-head">Serveurs locaux</div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th class="c-name">Nom</th>
                  <th>État</th>
                  <th>Version</th>
                  <th>Dernier contact</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in data.edgeNodes" :key="n.id">
                  <td class="c-name cell-strong">{{ n.name }}</td>
                  <td>
                    <span class="pill" :class="n.status === 'ACTIVE' ? 'ok' : 'warn'">
                      {{ n.status }}
                    </span>
                  </td>
                  <td>{{ n.appVersion ?? "—" }}</td>
                  <td>{{ dateFmt(n.lastSeenAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>

    <!-- ── LES ACCÈS, VUS DU SUPPORT ──────────────────────────────────────
         Same matrix the school sees, and deliberately so: an operator who
         repairs an access should be looking at exactly what its holder will
         see afterwards. The peer and escalation rules are lifted here — they
         order colleagues, not an operator and a customer — so every box is
         editable, and every save is written to the journal above marked
         "(support)". -->
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
        <label for="sup-role">Fonction</label>
        <input id="sup-role" v-model="draftRole" placeholder="Directeur, Comptable…" />
      </div>

      <div class="perm-grid">
        <div v-for="g in permGroups" :key="g.id" class="perm-group">
          <div class="perm-group-head">{{ g.label }}</div>
          <label v-for="p in inGroup(g.id)" :key="p.key" class="perm-row">
            <input type="checkbox" :checked="draft.has(p.key)" @change="togglePerm(p.key)" />
            <span>
              <strong :class="{ 'is-danger': p.danger }">{{ p.label }}</strong>
              <span class="perm-desc">{{ p.description }}</span>
            </span>
          </label>
        </div>
      </div>

      <Alert kind="warn">
        Cette modification apparaîtra dans le journal de l'établissement, à
        votre nom, suivi de « (support) ».
      </Alert>

      <div class="row-actions">
        <button class="btn primary" type="button"
                :disabled="!accessDirty || savingAccess" @click="saveAccess">
          Enregistrer les accès
        </button>
        <button class="btn ghost" type="button" @click="editing = null">Annuler</button>
      </div>
    </DialogShell>
</template>
