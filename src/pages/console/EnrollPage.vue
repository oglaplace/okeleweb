<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import EnrollForm from "../../components/enrollment/EnrollForm.vue";

/**
 * Enrol a pupil, as a screen.
 *
 * The form itself lives in components/enrollment, because the same one opens
 * as a dialog over a class — see NodePage. This page is what the rail links to,
 * where no class has been chosen yet.
 */
const route = useRoute();
const scope = computed(() => (typeof route.query.scope === "string" ? route.query.scope : null));
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Inscrire un élève</h1>
        <div class="page-sub">
          L'élève, ses tuteurs et son inscription sont créés ensemble. Le matricule
          est attribué automatiquement.
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <EnrollForm :fixed-classe="scope" />
      </div>
    </div>
  </div>
</template>
