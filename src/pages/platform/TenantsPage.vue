<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import { ESTABLISHMENT_LABELS, TIER_LABELS } from "./labels";

/**
 * Every établissement on this node.
 *
 * The search is client-side over an already-loaded list up to a point, then
 * re-queries: a Congolese operator's fleet is dozens, not thousands, and a
 * round trip per keystroke over a metered connection is the wrong trade at that
 * size. It re-queries when the "inactifs" filter changes, because that genuinely
 * asks the server for different rows.
 */
const router = useRouter();
const busy = useBusyStore();

const tenants = ref<api.TenantSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const q = ref("");
const includeInactive = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    tenants.value = await busy.run(() =>
      api.platform.tenants({ includeInactive: includeInactive.value }),
    );
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
    tenants.value = [];
  } finally {
    loading.value = false;
  }
}

const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return tenants.value;
  return tenants.value.filter(
    (t) => t.name.toLowerCase().includes(needle) || t.slug.includes(needle),
  );
});

const totals = computed(() => ({
  count: tenants.value.length,
  students: tenants.value.reduce((n, t) => n + t.counts.students, 0),
  accounts: tenants.value.reduce((n, t) => n + t.counts.accounts, 0),
}));

/** Initials for the row mark, same convention as the sidebar avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

watch(includeInactive, () => void load());
onMounted(() => void load());
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Établissements</h1>
        <div class="page-sub">
          Complexes scolaires, lycées et universités enregistrés sur ce serveur.
        </div>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" :to="{ name: 'tenant-new' }">
          Nouvel établissement
        </RouterLink>
      </div>
    </div>

    <div class="grid-cards" style="margin-bottom: var(--s5)">
      <div class="stat">
        <div class="stat-label">Établissements</div>
        <div class="stat-value">{{ totals.count }}</div>
        <div class="stat-note">{{ includeInactive ? "actifs et suspendus" : "actifs" }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Élèves inscrits</div>
        <div class="stat-value">{{ totals.students }}</div>
        <div class="stat-note">toutes années confondues</div>
      </div>
      <div class="stat">
        <div class="stat-label">Comptes</div>
        <div class="stat-value">{{ totals.accounts }}</div>
        <div class="stat-note">personnels pouvant se connecter</div>
      </div>
    </div>

    <div class="toolbar">
      <input
        v-model="q"
        class="search"
        type="search"
        placeholder="Rechercher un établissement…"
        aria-label="Rechercher un établissement"
      />
      <label class="toggle">
        <input v-model="includeInactive" type="checkbox" />
        Inclure les suspendus
      </label>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="card">
      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="width: 40%" />
        <div class="skeleton" style="width: 70%" />
        <div class="skeleton" style="width: 55%" />
      </div>

      <div v-else-if="!tenants.length" class="empty">
        <div class="empty-title">Aucun établissement</div>
        <div>
          Rien n'est encore enregistré sur ce serveur. Commencez par le premier
          complexe — vous y nommerez son directeur, qui pourra se connecter
          immédiatement.
        </div>
        <div class="empty-actions">
          <RouterLink class="btn primary" :to="{ name: 'tenant-new' }">
            Enregistrer le premier établissement
          </RouterLink>
        </div>
      </div>

      <div v-else-if="!shown.length" class="empty">
        Aucun résultat pour « {{ q }} ».
      </div>

      <template v-else>
        <!-- The key sits above the table: three-letter column heads need
             explaining before they are read, not after a page of rows. -->
        <dl class="legend">
          <div class="legend-item" title="Élèves inscrits, toutes années confondues">
            <dt>ÉLV</dt>
            <dd>Élèves</dd>
          </div>
          <div class="legend-item" title="Comptes du personnel pouvant se connecter">
            <dt>CPT</dt>
            <dd>Comptes</dd>
          </div>
          <div class="legend-item" title="Unités de structure : écoles, cycles, niveaux, classes">
            <dt>STR</dt>
            <dd>Structure</dd>
          </div>
        </dl>

        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="c-name">Établissement</th>
                <th class="c-text">Type</th>
                <th class="c-text">Formule</th>
                <th>ÉLV</th>
                <th>CPT</th>
                <th>STR</th>
                <th class="c-text">État</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in shown"
                :key="t.id"
                class="is-clickable"
                tabindex="0"
                @click="router.push({ name: 'tenant', params: { id: t.id } })"
                @keydown.enter="router.push({ name: 'tenant', params: { id: t.id } })"
              >
                <td class="c-name">
                  <span class="row-mark" aria-hidden="true">{{ initials(t.name) }}</span>
                  <span class="row-text">
                    <span class="cell-strong">{{ t.name }}</span>
                    <span class="cell-sub">{{ t.slug }}</span>
                  </span>
                </td>
                <td class="c-text">
                  {{ ESTABLISHMENT_LABELS[t.establishmentType ?? "COMPLEXE"] }}
                </td>
                <td class="c-text">{{ TIER_LABELS[t.tier] }}</td>
                <td>{{ t.counts.students }}</td>
                <td>{{ t.counts.accounts }}</td>
                <td>{{ t.counts.orgUnits }}</td>
                <td class="c-text">
                  <span v-if="t.migrationLockedAt" class="pill warn">Migration</span>
                  <span v-else-if="!t.active" class="pill danger">Suspendu</span>
                  <span v-else class="pill ok">Actif</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
