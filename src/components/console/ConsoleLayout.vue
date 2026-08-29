<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";
import DeploymentBadge from "./DeploymentBadge.vue";

const auth = useAuthStore();
const dep = useDeploymentStore();
const router = useRouter();

// Once signed in, re-read deployment WITH the tenant so tier and writability
// are real rather than the anonymous probe's nulls.
onMounted(() => void dep.refreshForSession());

async function logout() {
  await auth.signOut();
  await router.replace({ name: "login" });
}
</script>

<template>
  <div class="console">
    <aside class="side">
      <div class="brand">
        <span class="brand-mark">École</span>
        <span class="brand-sub">Console</span>
      </div>

      <RouterLink to="/console" class="nav-item" active-class="active" exact-active-class="active">
        Tableau de bord
      </RouterLink>
      <RouterLink to="/console/structure" class="nav-item" active-class="active">
        Structure
      </RouterLink>

      <div class="side-foot">
        <div class="unit-meta">{{ auth.profile?.complexName ?? "—" }}</div>
        <button class="btn" type="button" @click="logout">Se déconnecter</button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="unit-meta">{{ dep.configLabel ?? dep.info?.label ?? "" }}</div>
        <DeploymentBadge />
      </header>

      <!-- The one place the service ladder is visible to a user, and only when
           something is wrong. Silence would be the worst possible answer. -->
      <div
        v-if="dep.banner"
        class="banner"
        :class="{ 'is-offline': dep.unreachable }"
        role="status"
      >
        {{ dep.banner }}
      </div>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
