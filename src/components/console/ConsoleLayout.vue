<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";
import DeploymentBadge from "./DeploymentBadge.vue";
import ThemeToggle from "../ThemeToggle.vue";
import ActionRail from "../structure/ActionRail.vue";
import Breadcrumb from "./Breadcrumb.vue";
import HintPanel from "./HintPanel.vue";
import OrgPane from "./OrgPane.vue";
import Icon from "../ui/Icon.vue";

const auth = useAuthStore();
const dep = useDeploymentStore();
const router = useRouter();

// Once signed in, re-read deployment WITH the tenant so tier and writability
// are real rather than the anonymous probe's nulls.
onMounted(() => void dep.refreshForSession());

/**
 * The rail collapses to its group icons, like Cloudflare's.
 *
 * Remembered, because a console someone works in all day should open the way
 * they left it — and a director on a 1366×768 screen collapses it once and
 * means it.
 */
const collapsed = ref(localStorage.getItem("ec_rail_collapsed") === "1");
function toggleRail() {
  collapsed.value = !collapsed.value;
  localStorage.setItem("ec_rail_collapsed", collapsed.value ? "1" : "0");
}

/** The unit selected in the organisation pane, shared with the content. */
const selected = ref<string | null>(null);

async function logout() {
  await auth.signOut();
  await router.replace({ name: "login" });
}
</script>

<template>
  <div class="console" :class="{ 'rail-collapsed': collapsed }">
    <aside class="side">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">T</span>
        <span class="brand-text">
          <span class="brand-name">TeYa</span>
          <span class="brand-sub">Console</span>
        </span>
      </div>

      <!--
        The only scrolling region of the rail, and now it carries three things:
        the pages, the shortcuts, and the complex itself as a tree. All of it
        scrolls together and none of it can push "se déconnecter" off screen —
        that is the whole point of the three-region shell.
      -->
      <nav class="side-nav">
        <RouterLink to="/console" class="nav-item" active-class="active" exact-active-class="active">
          <Icon name="home" /> Tableau de bord
        </RouterLink>

        <!--
          The tree used to live here and no longer does. At 244px a seven-level
          structure is all ellipsis; it belongs in the main column, where the
          Structure action sends it. The rail's job is the catalogue.
        -->
        <ActionRail ref="rail" :collapsed="collapsed" />
      </nav>

      <!-- Pinned: sign-out must stay reachable while a long list scrolls. -->
      <div class="side-foot">
        <!-- Cloudflare puts this at the very bottom of the rail, and it is the
             right place: collapsing is a preference, not a destination. -->
        <button
          class="rail-collapse"
          type="button"
          :title="collapsed ? 'Déplier le menu' : 'Replier le menu'"
          :aria-label="collapsed ? 'Déplier le menu' : 'Replier le menu'"
          @click="toggleRail"
        >
          <Icon :name="collapsed ? 'chevronRight' : 'chevronDown'" :size="14" />
          <span class="rail-collapse-label">Replier</span>
        </button>

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
        <Breadcrumb />
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

      <!-- Three panes: rail, organisation, work. The tree is present for every
           action rather than living inside one screen. -->
      <div class="workspace">
        <OrgPane :selected="selected" @select="(u) => (selected = u.id)" />

        <main class="content">
          <div class="content-inner">
            <RouterView />
          </div>
        </main>
      </div>

      <!-- Not part of the working column: state phrased as advice, in a corner
           that can be dismissed. -->
      <HintPanel />
    </div>
  </div>
</template>
