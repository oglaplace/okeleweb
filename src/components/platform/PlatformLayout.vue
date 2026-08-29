<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";
import ThemeToggle from "../ThemeToggle.vue";

/**
 * The fleet console.
 *
 * Same layout as a school's, deliberately — an operator demoing the product
 * should be moving inside one system, not two. The brand mark switches to ink
 * so the register is unmistakable: this side of the wall administers
 * établissements, the other side runs one.
 *
 * There is no deployment badge here. It answers "can I write to MY complex",
 * and a platform account has none; showing "lecture seule" to a super admin
 * would be false.
 */
const auth = useAuthStore();
const dep = useDeploymentStore();
const router = useRouter();

async function logout() {
  await auth.signOut();
  await router.replace({ name: "login" });
}
</script>

<template>
  <div class="console">
    <aside class="side is-platform">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">É</span>
        <span class="brand-text">
          <span class="brand-name">École</span>
          <span class="brand-sub">Plateforme</span>
        </span>
      </div>

      <div class="nav-group">Fleet</div>
      <RouterLink to="/admin" class="nav-item" active-class="active" exact-active-class="active">
        Établissements
      </RouterLink>
      <RouterLink to="/admin/nouveau" class="nav-item" active-class="active">
        Nouvel établissement
      </RouterLink>

      <div class="side-foot">
        <div class="who">
          <span class="avatar" aria-hidden="true">{{ auth.initials }}</span>
          <span class="who-text">
            <span class="who-name">{{ auth.profile?.fullName ?? "—" }}</span>
            <span class="who-role">Super administrateur</span>
          </span>
        </div>
        <button class="btn sm" type="button" @click="logout">Se déconnecter</button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="unit-meta">{{ dep.configLabel ?? dep.info?.label ?? "" }}</div>
        <div class="topbar-tools">
          <span class="pill accent">{{ dep.mode === "EDGE" ? "Serveur local" : "Cloud" }}</span>
          <ThemeToggle />
        </div>
      </header>

      <div v-if="dep.unreachable" class="banner is-offline" role="status">
        Le serveur ne répond pas. Aucune modification ne sera enregistrée.
      </div>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
