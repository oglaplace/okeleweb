<script setup lang="ts">
/**
 * Shown for the one moment between opening the app and knowing who you are.
 *
 * The router's guard restores the session and then routes here-or-there, so
 * nothing on this page is ever interacted with. It exists because the
 * alternative — a blank white rectangle while a token is verified over a
 * metered Brazzaville connection — is indistinguishable from a broken app.
 */
</script>

<template>
  <div class="boot">
    <div class="boot-mark" aria-hidden="true">T</div>
    <div class="boot-name">TeYa</div>
    <div class="spinner" role="status" aria-label="Chargement" />
  </div>
</template>
