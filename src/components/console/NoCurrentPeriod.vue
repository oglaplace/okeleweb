<script setup lang="ts">
import { RouterLink } from "vue-router";

/**
 * AUCUNE PÉRIODE EN COURS — said once, in one place.
 *
 * Every screen that writes against a période used to work out which one from
 * today's date. That is a guess about a school, wrong in all the ordinary ways
 * — a trimestre running late, a rentrée pushed a week, a conseil still
 * finishing a term the calendar says closed on Friday — and ten screens each
 * guessing separately could disagree on the same afternoon.
 *
 * The school declares it now. When it has not, the honest answer is this
 * banner rather than a silent fallback to the first trimestre: marks written
 * into a term that ended in décembre are a mess somebody unpicks by hand.
 */
defineProps<{
  /** What the operator was trying to do, for the sentence. */
  what?: string;
}>();
</script>

<template>
  <div class="alert is-warn no-print">
    <div class="alert-body">
      <strong>Aucune période en cours.</strong>
      L'établissement n'a pas déclaré la période dans laquelle il travaille, donc
      {{ what ?? "cet écran" }} n'a pas de période sur laquelle s'ouvrir — et rien
      n'est déduit du calendrier à sa place. Déclarez la période en cours : l'écran
      s'ouvre dessus.
      <RouterLink :to="{ name: 'calendar' }">Ouvrir le calendrier →</RouterLink>
    </div>
  </div>
</template>
