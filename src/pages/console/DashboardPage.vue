<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";

const auth = useAuthStore();
const dep = useDeploymentStore();

const tierLabel = computed(() => {
  switch (dep.tier) {
    case "SOVEREIGN":
      return "Autonome";
    case "RESILIENT":
      return "Résilient";
    case "CONNECTED":
      return "Connecté";
    default:
      return "—";
  }
});

// What the formula actually buys, in the director's terms rather than ours.
const tierNote = computed(() => {
  switch (dep.tier) {
    case "SOVEREIGN":
      return "Vos données sont sur le serveur de l'établissement. Sauvegarde quotidienne chez nous.";
    case "RESILIENT":
      return "Serveur local pour la consultation, données conservées chez nous.";
    case "CONNECTED":
      return "Données conservées chez nous. Une connexion internet est nécessaire.";
    default:
      return "";
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ dep.complexName ?? "Tableau de bord" }}</h1>
        <div class="page-sub">
          Bonjour {{ auth.profile?.fullName ?? "" }} — voici l'état de votre
          établissement.
        </div>
      </div>
    </div>

    <div class="grid-cards">
      <div class="stat">
        <div class="stat-label">Formule</div>
        <div class="stat-value">{{ tierLabel }}</div>
        <div class="stat-note">{{ tierNote }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Serveur</div>
        <div class="stat-value">{{ dep.mode === "EDGE" ? "Local" : "Distant" }}</div>
        <div class="stat-note">
          {{ dep.writable ? "Enregistrement possible" : "Lecture seule sur cet appareil" }}
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">Version</div>
        <div class="stat-value" style="font-size: var(--t-h3)">
          {{ dep.info?.appVersion ?? "—" }}
        </div>
        <div class="stat-note">Schéma {{ dep.info?.schemaVersion ?? "—" }}</div>
      </div>
    </div>

    <div class="card" style="margin-top: var(--s5)">
      <div class="card-head">Prochaines étapes</div>
      <div class="card-body">
        <p style="margin: 0; color: var(--ink-2)">
          Commencez par la <RouterLink to="/console/structure">structure</RouterLink> :
          créez les écoles, les cycles, les niveaux puis les classes. Les inscriptions,
          les coefficients et les bulletins s'y rattachent.
        </p>
      </div>
    </div>
  </div>
</template>
