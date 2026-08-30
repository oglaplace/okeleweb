<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import EnrollForm from "../../components/enrollment/EnrollForm.vue";

/**
 * Enrol a pupil, as a screen.
 *
 * The form itself lives in components/enrollment, because the same one opens
 * as a dialog over a class — see NodePage. This page is what the rail links to,
 * where no class has been chosen yet.
 */
const route = useRoute();
const router = useRouter();
const scope = computed(() => (typeof route.query.scope === "string" ? route.query.scope : null));

/**
 * Enrolled from the rail: go and look at the class.
 *
 * The form used to stay put and clear itself, which is right when you are
 * working IN a class and wrong when you arrived from a menu — you asked to
 * enrol someone and were shown an empty form again, with no evidence anything
 * happened. The class page is the evidence: the pupil is in the roster, and its
 * own "Inscrire un élève" opens the same form in place, so enrolling a whole
 * list still works — now with the list visible while you do it.
 */
function onEnrolled(result: { classeId: string }) {
  void router.push({ name: "unit", params: { id: result.classeId } });
}
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
        <EnrollForm :fixed-classe="scope" @enrolled="onEnrolled" />
      </div>
    </div>
  </div>
</template>
