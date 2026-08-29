<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";
import DeploymentBadge from "./DeploymentBadge.vue";
import ThemeToggle from "../ThemeToggle.vue";

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
        <span class="brand-mark" aria-hidden="true">T</span>
        <span class="brand-text">
          <span class="brand-name">TeYa</span>
          <span class="brand-sub">Console</span>
        </span>
      </div>

      <!-- The only scrolling region of the rail. -->
      <nav class="side-nav">
        <div class="nav-group">Établissement</div>
        <RouterLink to="/console" class="nav-item" active-class="active" exact-active-class="active">
          Tableau de bord
        </RouterLink>
        <RouterLink to="/console/structure" class="nav-item" active-class="active">
          Structure
        </RouterLink>
      </nav>

      <!-- Pinned: sign-out must stay reachable while a long list scrolls. -->
      <div class="side-foot">
        <div class="who">
          <span class="avatar" aria-hidden="true">{{ auth.initials }}</span>
          <span class="who-text">
            <span class="who-name">{{ auth.profile?.fullName ?? "—" }}</span>
            <span class="who-role">{{ auth.profile?.complexName ?? "—" }}</span>
          </span>
        </div>
        <button class="btn sm" type="button" @click="logout">Se déconnecter</button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="unit-meta">{{ dep.configLabel ?? dep.info?.label ?? "" }}</div>
        <div class="topbar-tools">
          <DeploymentBadge />
          <ThemeToggle />
        </div>
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
        <div class="content-inner">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
