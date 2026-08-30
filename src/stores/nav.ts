import { defineStore } from "pinia";
import type { Router } from "vue-router";

/**
 * The navigation stack, made visible.
 *
 * The console is a place people work in for hours, and it is full of one-way
 * doors: an action opens a form, the form opens a node, the node opens a class.
 * Without a back control the only way out of a three-deep path is the rail —
 * which throws away everything you had selected on the way in.
 *
 * The stack is the browser's own, deliberately. Keeping a parallel array in
 * sync with back/forward, deep links and reloads is a bug factory, and it can
 * disagree with the URL bar. vue-router records the previous location in
 * `history.state.back`, so that IS the stack: it survives a reload, it moves
 * with the browser's own buttons, and it is null exactly when there is nothing
 * behind us — the case where a back button must not be shown, because pressing
 * it would leave the application.
 *
 * `fallback` covers the deep-link case: someone opening a bulletin link from
 * WhatsApp has no history, and "up one level in the breadcrumb" is the honest
 * answer there rather than a dead control.
 */
export const useNavStore = defineStore("nav", {
    state: () => ({
        /** The fullPath behind us, or null at the bottom of the stack. */
        previous: null as string | null,
    }),

    getters: {
        canGoBack: (s) => s.previous !== null,
    },

    actions: {
        /** Re-read after every settled navigation. */
        sync() {
            const state = window.history.state as { back?: string | null } | null;
            const back = state?.back ?? null;
            // The login screen is not somewhere to go back TO: signing in
            // replaces it, and offering it as a destination is offering a
            // sign-out that does not sign out.
            this.previous = back && !back.startsWith("/login") ? back : null;
        },

        /** Attached once, in main.ts, so every route change keeps this true. */
        attach(router: Router) {
            router.afterEach(() => this.sync());
            this.sync();
        },
    },
});
