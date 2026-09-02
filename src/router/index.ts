import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
// The login screen is the entry point on every deployment, so it is bundled
// into the main chunk — an edge box on a slow LAN should not wait on a second
// request to show a sign-in form.
import LoginPage from "../pages/LoginPage.vue";

/**
 * Two applications behind one login.
 *
 * `/console` is a school's own office: structure, marks, bulletins. `/admin` is
 * the platform — the operator's view of every établissement on the fleet. Which
 * one you get is decided by what your account IS, not by a menu, because the
 * two audiences never overlap: a director has no business seeing the fleet, and
 * a platform account holds no tenant, so every school screen would be empty for
 * them by construction (see the API's shared/tenancy.ts).
 */
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from) => (to.path === from.path ? false : { top: 0 }),
  routes: [
    /**
     * The landing route resolves to whichever console the account belongs to.
     *
     * A real component rather than a `redirect`, deliberately: vue-router
     * applies `redirect` while RESOLVING, before any guard runs, so a redirect
     * here could never consult the identity it needs — and the identity may not
     * be loaded yet on a cold open. So this renders a boot screen for the one
     * moment `restore()` is in flight, and the guard below moves on.
     */
    { path: "/", name: "landing", component: () => import("../pages/BootPage.vue") },
    { path: "/login", name: "login", component: LoginPage },

    {
      path: "/console",
      component: () => import("../components/console/ConsoleLayout.vue"),
      meta: { requiresComplex: true },
      children: [
        { path: "", name: "dashboard", component: () => import("../pages/console/DashboardPage.vue") },
        { path: "structure", name: "structure", component: () => import("../pages/console/StructurePage.vue") },
        { path: "inscription", name: "enroll", component: () => import("../pages/console/EnrollPage.vue") },
        { path: "personnel", name: "staff", component: () => import("../pages/console/StaffPage.vue") },
        { path: "import", name: "import", component: () => import("../pages/console/ImportPage.vue") },
        /**
         * One route for every declarative action — see lib/actions.ts. Actions
         * with a screen of their own keep their route above; this serves the
         * rest, which are all "pick a node, fill a form".
         */
        { path: "action/:id", name: "action", component: () => import("../pages/console/ActionPage.vue") },
        /** One unit: what it is, what it holds, and everything doable to it. */
        { path: "unit/:id", name: "unit", component: () => import("../pages/console/NodePage.vue") },
        { path: "classes/:id", name: "classe", component: () => import("../pages/console/ClassePage.vue") },
        { path: "classes/:id/notes", name: "marks", component: () => import("../pages/console/MarkEntryPage.vue") },
        { path: "classes/:id/bulletins", name: "bulletins", component: () => import("../pages/console/BulletinsPage.vue") },
        /**
         * ONE PUPIL'S BULLETIN — reached by clicking their row in the sheet.
         *
         * A route rather than a dialog: this is a document, it gets printed and
         * sent, and a parent who asks for "the link to my child's bulletin"
         * should get one.
         */
        { path: "eleve/:id/bulletin", name: "bulletin", component: () => import("../pages/console/BulletinPage.vue") },
        /**
         * ONE PUPIL'S DOSSIER — the whole folder, not one période of it.
         *
         * Clicking a name in the roster used to open a bulletin, which answers
         * "how did this child do in the second trimestre" when the question was
         * usually "who is this child": which class, whose son, what is owed,
         * how often absent. The bulletin is still a click away from here.
         */
        { path: "eleve/:id", name: "student", component: () => import("../pages/console/StudentPage.vue") },
        /**
         * ONE PUPIL'S MONEY — the échéancier, the règlements, the reçus.
         *
         * Its own route rather than a section of the dossier: this is the
         * screen open while a parent is at the guichet, and it has to be
         * reachable in one click from the class finance sheet and printable on
         * its own.
         */
        { path: "eleve/:id/finances", name: "student-finance", component: () => import("../pages/console/StudentFinancePage.vue") },
        /** Who owes what, across the whole scope the operator can see. */
        { path: "impayes", name: "unpaid", component: () => import("../pages/console/UnpaidPage.vue") },
      ],
    },

    {
      path: "/admin",
      component: () => import("../components/platform/PlatformLayout.vue"),
      meta: { requiresPlatform: true },
      children: [
        { path: "", name: "tenants", component: () => import("../pages/platform/TenantsPage.vue") },
        { path: "nouveau", name: "tenant-new", component: () => import("../pages/platform/NewTenantPage.vue") },
        { path: ":id", name: "tenant", component: () => import("../pages/platform/TenantPage.vue") },
      ],
    },

    { path: "/:pathMatch(.*)*", redirect: { name: "landing" } },
  ],
});

router.beforeEach(async (to) => {
  const guarded = to.meta.requiresComplex || to.meta.requiresPlatform;
  if (!guarded && to.name !== "landing") return true;

  const auth = useAuthStore();
  if (auth.loading) await auth.restore();
  if (!auth.isAuthed) return { name: "login" };

  // One rule, applied in both directions: an account goes to the console it
  // belongs to. Sending a platform admin to /console would show them a shell
  // whose every request 403s, which reads as a broken product rather than as a
  // wrong turn.
  const home = auth.isPlatformAdmin ? { name: "tenants" } : { name: "dashboard" };
  if (to.name === "landing") return home;
  if (to.meta.requiresPlatform && !auth.isPlatformAdmin) return home;
  if (to.meta.requiresComplex && !auth.hasComplex) return home;

  return true;
});

export default router;
