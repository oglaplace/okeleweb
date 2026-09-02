<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { useDeploymentStore } from "../../stores/deployment";
import DeploymentBadge from "./DeploymentBadge.vue";
import ThemeToggle from "../ThemeToggle.vue";
import ActionRail from "../structure/ActionRail.vue";
import Breadcrumb from "./Breadcrumb.vue";
import HintPanel from "./HintPanel.vue";
import OrgPane from "./OrgPane.vue";
import ScopePane from "./ScopePane.vue";
import Inbox from "./Inbox.vue";
import Icon from "../ui/Icon.vue";
import { byId } from "../../lib/actions";
import { scopeOf } from "../../lib/trail";

const auth = useAuthStore();
const dep = useDeploymentStore();
const route = useRoute();
const router = useRouter();

// Once signed in, re-read deployment WITH the tenant so tier and writability
// are real rather than the anonymous probe's nulls.
onMounted(() => void dep.refreshForSession());

/**
 * THE SIGNED-IN PERSON'S OWN PORTRAIT.
 *
 * Not a page. Uploading your own photo is a ten-second act that belongs where
 * your name already is, and a settings screen built to hold one file input is a
 * screen nobody finds.
 *
 * Rules restated from the API for the same reason PhotoInput restates them: a
 * 3 Mo photo refused after crossing a mobile link is a wasted minute. The
 * server still enforces them.
 */
const MY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MY_PHOTO_MAX = 2 * 1024 * 1024;

const myPhoto = ref<string | null>(null);
const myPhotoBusy = ref(false);
const myPhotoError = ref<string | null>(null);
let myPhotoUrl: string | null = null;

async function loadMyPhoto() {
  const personId = auth.profile?.personId;
  if (!personId) return;
  const url = await api.people.photoObjectUrl(personId);
  if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl);
  myPhotoUrl = url;
  myPhoto.value = url;
}
watch(() => auth.profile?.personId, loadMyPhoto, { immediate: true });
onBeforeUnmount(() => {
  if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl);
});

async function onMyPhoto(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = "";
  const personId = auth.profile?.personId;
  if (!file || !personId) return;

  myPhotoError.value = null;
  if (!MY_PHOTO_TYPES.includes(file.type)) {
    myPhotoError.value = "JPEG, PNG ou WebP";
    return;
  }
  if (file.size > MY_PHOTO_MAX) {
    myPhotoError.value = "Photo trop lourde (2 Mo max)";
    return;
  }

  myPhotoBusy.value = true;
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
    await api.people.setPhoto(personId, data);
    await loadMyPhoto();
  } catch (e) {
    myPhotoError.value = e instanceof api.ApiError ? e.message : "Envoi impossible";
  } finally {
    myPhotoBusy.value = false;
  }
}

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

/**
 * Which unit the console is pointed at, read from the URL.
 *
 * Derived rather than remembered: arriving by breadcrumb, by back button or by
 * a pasted link must light up the same row in the tree as clicking it did.
 */
const selected = computed(() => scopeOf(route));

/** Screens whose content is a grid rather than prose. */
const FLUID_ROUTES = new Set(["unit", "marks", "classe"]);
const fluid = computed(() => FLUID_ROUTES.has(String(route.name)));

/** The action being run, when the route is a generic action page. */
const actionSpec = computed(() =>
  String(route.name) === "action" ? byId(String(route.params.id ?? "")) : undefined,
);

/**
 * What goes in the second column — and whether there is one.
 *
 * Two things belong there and they are the same job: the structure you navigate
 * by, and the structure you pick a target from. An action that needs a scope
 * asks for it HERE, in the column, instead of stacking a picker card on top of
 * its own form.
 *
 * Nothing at all on the rest: on the mark-entry grid a permanent tree stole
 * 280px from a screen that needs every pixel, and on a complex-wide form it
 * offered navigation nobody was about to use.
 */
const TREE_ROUTES = new Set(["structure", "unit"]);
const pane = computed<"tree" | "scope" | null>(() => {
  if (TREE_ROUTES.has(String(route.name))) return "tree";
  const spec = actionSpec.value;
  // Including the ones with a screen of their own: "voir une classe" from the
  // rail has to ask WHICH class, and this is where that question is asked. The
  // action page forwards the moment it is answered, so the pane lives exactly
  // as long as the question does.
  if (spec && !spec.planned && (spec.scope?.length ?? 0) > 0) return "scope";
  return null;
});

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
        <!-- The label is a SPAN, not a bare text node: `.rail-collapsed
             .nav-item span` is what hides it, and a text node matches no
             selector — so this one item stayed readable while every other
             label vanished. -->
        <RouterLink
          to="/console"
          class="nav-item"
          active-class="active"
          exact-active-class="active"
          title="Tableau de bord"
        >
          <Icon name="home" /><span>Tableau de bord</span>
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
          <!-- Sideways: the rail moves horizontally, so a vertical chevron
               was pointing at an axis nothing travels on. -->
          <Icon :name="collapsed ? 'chevronRight' : 'chevronLeft'" :size="14" />
          <span class="rail-collapse-label">Replier</span>
        </button>

        <div class="who">
          <!--
            Your own face, and the one control for putting it there.

            The office can add anyone's portrait from their dossier; this is the
            other half of the same permission — a teacher, an économe, a pupil
            old enough to sign in, changing their own without asking anyone.
            Offered only when the account IS a person: a shared "secrétariat"
            login has no face to change, and the API would refuse it anyway.
          -->
          <label
            v-if="auth.profile?.personId"
            class="avatar is-mine"
            :class="{ 'is-busy': myPhotoBusy }"
            :title="myPhoto ? 'Changer ma photo' : 'Ajouter ma photo'"
          >
            <img v-if="myPhoto" :src="myPhoto" :alt="`Photo de ${auth.profile.fullName}`" />
            <span v-else aria-hidden="true">{{ auth.initials }}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="myPhotoBusy"
              @change="onMyPhoto"
            />
          </label>
          <span v-else class="avatar" aria-hidden="true">{{ auth.initials }}</span>

          <span class="who-text">
            <span class="who-name">{{ auth.profile?.fullName ?? "—" }}</span>
            <span class="who-role">{{ myPhotoError ?? auth.profile?.complexName ?? "—" }}</span>
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
          <Inbox />
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
      <div class="workspace" :class="{ 'no-tree': !pane }">
        <OrgPane v-if="pane === 'tree'" :selected="selected" />
        <ScopePane v-else-if="pane === 'scope' && actionSpec" :spec="actionSpec" />

        <main class="content">
          <!--
            Where a screen puts a toolbar that belongs to the whole column.
            OUTSIDE `.content-inner`, so it escapes both the column padding and
            the 1080px reading width: an action bar inset by 30px on each side
            reads as a card, and a card is not what a toolbar is. The node page
            fills it by teleport — see NodePage.
          -->
          <div id="node-toolbar" class="content-toolbar" />

          <!--
            The unit page is a spreadsheet, and a spreadsheet capped at a
            reading width is half a spreadsheet behind a scrollbar. Reading
            width is right for prose and forms; it is wrong for a grid.
          -->
          <div class="content-inner" :class="{ 'is-fluid': fluid }">
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
