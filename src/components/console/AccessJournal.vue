<script setup lang="ts">
import { computed } from "vue";
import * as api from "../../lib/api";

/**
 * LE JOURNAL DES ACCÈS — écrit depuis le début, lu par personne.
 *
 * Every change to somebody's rights already wrote an AuditLog line. Nothing in
 * the product ever read one back, so the trail existed only for whoever could
 * open a psql prompt — which is to say, for us and not for the school. "Qui m'a
 * retiré l'encaissement, et quand" is the question a trail is FOR.
 *
 * A component rather than a block inside the settings page, because the support
 * console shows the same thing about the same établissement and two tables that
 * drift apart would be two accounts of the same events.
 *
 * Each line says what CHANGED, not what the state became. "A gagné
 * l'encaissement" is the sentence somebody is looking for; two permission lists
 * side by side is a diff they have to do themselves.
 */
const props = withDefaults(
  defineProps<{
    events: api.AccessEvent[];
    /** Permission keys → French labels, from the catalogue. */
    catalogue: api.PermissionInfo[];
    loading?: boolean;
    /** Shown when nothing has happened yet. */
    empty?: string;
  }>(),
  { loading: false, empty: "Aucune modification d'accès pour l'instant." },
);

const labelOf = (key: string) =>
  props.catalogue.find((p) => p.key === key)?.label ?? key;

const ACTION_FR: Record<api.AccessEvent["action"], string> = {
  "grant.invite": "Compte créé",
  "grant.update": "Accès modifiés",
  "account.suspend": "Compte suspendu",
  "account.restore": "Compte réactivé",
};

/** "14 sept. 2026, 21:08" — a trail is read by date, not by relative time. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const rows = computed(() => props.events);
</script>

<template>
  <div v-if="loading" class="card-body stack">
    <div class="skeleton" style="width: 55%" /><div class="skeleton" style="width: 40%" />
  </div>

  <div v-else-if="!rows.length" class="empty">
    <div class="empty-title">Journal vide</div>
    <div>{{ props.empty }}</div>
  </div>

  <ul v-else class="journal">
    <li v-for="e in rows" :key="e.id" class="journal-row">
      <div class="journal-when">{{ when(e.at) }}</div>
      <div class="journal-what">
        <div class="journal-head">
          <span class="journal-action">{{ ACTION_FR[e.action] }}</span>
          <span class="journal-subject">{{ e.subject }}</span>
          <span v-if="e.role" class="kind-tag">{{ e.role }}</span>
        </div>

        <!-- What changed, as a sentence. Not two lists to compare. -->
        <div v-if="e.added.length" class="journal-diff is-added">
          <span>+</span>
          <span>{{ e.added.map(labelOf).join(", ") }}</span>
        </div>
        <div v-if="e.removed.length" class="journal-diff is-removed">
          <span>−</span>
          <span>{{ e.removed.map(labelOf).join(", ") }}</span>
        </div>
        <div
          v-if="e.action === 'grant.update' && !e.added.length && !e.removed.length"
          class="journal-diff"
        >
          <span class="hint">Seule la fonction a changé.</span>
        </div>

        <div class="journal-actor">par {{ e.actor }}</div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.journal {
  list-style: none;
  margin: 0;
  padding: 0;
}
.journal-row {
  display: flex;
  gap: var(--s4);
  padding: var(--s3) var(--s4);
  border-top: 1px solid var(--line-soft);
}
.journal-row:first-child {
  border-top: none;
}
.journal-when {
  flex: none;
  width: 150px;
  font-size: var(--t-small);
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.journal-what {
  min-width: 0;
  flex: 1;
}
.journal-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--s2);
}
.journal-action {
  font-size: var(--t-small);
  font-weight: 650;
  color: var(--ink-2);
}
.journal-subject {
  font-weight: 600;
  color: var(--ink);
}
.journal-diff {
  display: flex;
  gap: var(--s2);
  margin-top: 3px;
  font-size: var(--t-small);
  line-height: 1.35;
}
.journal-diff span:first-child {
  flex: none;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.journal-diff.is-added {
  color: var(--ok);
}
.journal-diff.is-removed {
  color: var(--danger);
}
.journal-actor {
  margin-top: 4px;
  font-size: var(--t-small);
  color: var(--ink-3);
}
</style>
