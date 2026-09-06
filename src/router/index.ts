import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useBusyStore } from "../stores/busy";
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

    /**
     * THE QR ON A PRINTED BULLETIN LANDS HERE.
     *
     * Outside every guard and outside the console shell: whoever scanned it has
     * no account, and the token in the URL is the only credential involved. A
     * short path because it is printed on paper and sometimes typed by hand.
     */
    { path: "/b/:token", name: "verify-bulletin", component: () => import("../pages/PublicBulletinPage.vue") },

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
         * The end of one year and the start of the next — the two acts a school
         * performs once a year and had no screen for at all.
         */
        { path: "rentree", name: "rentree", component: () => import("../pages/console/RentreePage.vue") },
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
        /**
         * THE GUICHET — take money from whoever is at the counter.
         *
         * Separate from Impayés on purpose: that screen is a state of the
         * world, this one is an act. A family paying an inscription in advance
         * owes nothing and is on no debtor list, and they are exactly who this
         * screen exists for.
         */
        { path: "encaisser", name: "collect", component: () => import("../pages/console/CollectPage.vue") },
        /**
         * THE PRICE LIST, as a grid rather than a form.
         *
         * Its own screen because it is a table somebody fills in and checks
         * against itself — the same job as the mark sheet and the timetable,
         * and the same shape.
         */
        { path: "tarifs", name: "tariffs", component: () => import("../pages/console/TariffsPage.vue") },
        /**
         * THE PRINTED GRILLE — its own address.
         *
         * A price list is printed, handed over, pinned to a wall and linked to;
         * all of those want a URL. As a modal it had none, so it could not be
         * reloaded or sent. The scope travels in the query for the same reason.
         */
        { path: "tarifs/imprimer", name: "tariffs-print", component: () => import("../pages/console/TariffPrintPage.vue") },
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

/**
 * THE CLICK THAT APPEARED TO DO NOTHING.
 *
 * Every screen below is a lazy `import()`, which is right — a school on a
 * metered connection should not download the bulletin engine to look at a class
 * list. But it means a menu click starts a chunk fetch and the page keeps
 * showing exactly what it showed before until that fetch lands. On a good link
 * that is 80ms and invisible; on a Brazzaville connection it is seconds of a
 * screen that looks frozen, so the operator clicks again, and again.
 *
 * The same 2px bar the login uses now runs for navigations too — see
 * busy.navigating. It costs no layout and it is the difference between "the
 * app is fetching the screen" and "the app ignored me".
 */
router.beforeEach(() => {
  useBusyStore().navigating = true;
  return true;
});

/** Fires for completed AND aborted navigations, which is what balances it. */
router.afterEach(() => {
  useBusyStore().navigating = false;
});

/**
 * And the failure that leaves you stuck for good.
 *
 * A chunk request that never arrives — the connection dropped mid-fetch, or the
 * server was redeployed and the hashed filename this tab remembers is gone —
 * rejects, vue-router abandons the navigation, and the URL never changes. From
 * the operator's side the menu item is simply dead, and it stays dead for the
 * life of the tab because the failed module is cached as failed.
 *
 * A full page load at the target URL is the only thing that recovers both
 * cases, and it is what the operator would eventually do by hand.
 */
router.onError((error, to) => {
  useBusyStore().navigating = false;
  const message = String((error as Error)?.message ?? error);
  const chunkFailed =
    /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message);
  if (chunkFailed && to?.fullPath && to.fullPath !== window.location.pathname) {
    window.location.assign(to.fullPath);
  }
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
