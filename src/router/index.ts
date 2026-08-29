import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
// The login screen is the entry point on every deployment, so it is bundled
// into the main chunk — an edge box on a slow LAN should not wait on a second
// request to show a sign-in form.
import LoginPage from "../pages/LoginPage.vue";

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from) => (to.path === from.path ? false : { top: 0 }),
  routes: [
    { path: "/", redirect: "/console" },
    { path: "/login", name: "login", component: LoginPage },
    {
      path: "/console",
      component: () => import("../components/console/ConsoleLayout.vue"),
      meta: { requiresAuth: true },
      children: [
        { path: "", name: "dashboard", component: () => import("../pages/console/DashboardPage.vue") },
        { path: "structure", name: "structure", component: () => import("../pages/console/StructurePage.vue") },
        { path: "classes/:id", name: "classe", component: () => import("../pages/console/ClassePage.vue") },
        { path: "classes/:id/notes", name: "marks", component: () => import("../pages/console/MarkEntryPage.vue") },
        { path: "classes/:id/bulletins", name: "bulletins", component: () => import("../pages/console/BulletinsPage.vue") },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/console" },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const auth = useAuthStore();
  if (auth.loading) await auth.restore();
  return auth.isAuthed ? true : { name: "login" };
});

export default router;
