<script setup lang="ts">
import { RouterView } from "vue-router";
import ProgressBar from "./components/ui/ProgressBar.vue";
import BusyOverlay from "./components/ui/BusyOverlay.vue";

/**
 * Both indicators live at the root rather than inside each page: an operation
 * usually outlives the screen that started it (registering an établissement
 * navigates to the new one), and an indicator unmounted mid-flight is worse
 * than none — it says "finished" at the moment it is least true.
 */
</script>

<template>
  <ProgressBar />
  <RouterView />
  <BusyOverlay />
</template>
