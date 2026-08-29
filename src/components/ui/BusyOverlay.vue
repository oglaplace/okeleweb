<script setup lang="ts">
import { useBusyStore } from "../../stores/busy";

/**
 * Shown only while an operation is writing something that cannot be half-done.
 *
 * It takes the pointer, which is the point: registering an établissement is one
 * transaction on the server, and two clicks on a slow connection is two
 * attempts to claim the same slug. The overlay makes the second click
 * impossible rather than making the API refuse it politely afterwards.
 *
 * The indicator is an arc that both spins and breathes — no percentage, no
 * step list. We cannot observe the server's progress through the transaction,
 * and inventing a stepper that advances on a timer would be a fabrication the
 * operator would eventually catch out.
 */
const busy = useBusyStore();
</script>

<template>
  <Transition name="scrim">
    <div v-if="busy.blocking" class="scrim" role="alertdialog" aria-live="assertive" aria-busy="true">
      <div class="scrim-card">
        <div class="orbit" aria-hidden="true">
          <span class="orbit-ring" />
          <span class="orbit-arc" />
        </div>
        <div class="scrim-title">{{ busy.blocking.title }}</div>
        <div class="scrim-detail">{{ busy.blocking.detail }}</div>
      </div>
    </div>
  </Transition>
</template>
