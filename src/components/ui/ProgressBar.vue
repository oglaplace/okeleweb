<script setup lang="ts">
import { useBusyStore } from "../../stores/busy";

/**
 * A 2px indeterminate bar across the top of the app.
 *
 * Indeterminate on purpose: the API returns one response, so any percentage
 * would be a number we invented. A bar that lies about progress is worse than
 * one that only says "still working" — the second is believed.
 */
const busy = useBusyStore();
</script>

<template>
  <Transition name="topbar">
    <div v-if="busy.active" class="topprogress" role="status" aria-label="Traitement en cours">
      <div class="topprogress-run" />
    </div>
  </Transition>
</template>
