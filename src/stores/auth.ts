import { defineStore } from "pinia";
import * as api from "../lib/api";
import { phoneAuth } from "../lib/firebase";
import { useDeploymentStore } from "./deployment";

// Console sessions should not linger open on a shared office machine.
const IDLE_MS = 30 * 60 * 1000;
let idleTimer: number | undefined;

export interface Profile {
  accountId: string;
  tenantId: string;
  complexName: string;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    profile: null as Profile | null,
    loading: true,
  }),
  getters: {
    isAuthed: (s) => s.profile !== null,
  },
  actions: {
    /**
     * Restore a session by asking the API who we are.
     *
     * /platform/me/deployment doubles as the identity check: it is
     * authenticated, so a 401 means the token is dead, and it returns the
     * tenant context the console needs anyway.
     */
    async restore() {
      this.loading = true;
      if (!api.getToken()) {
        this.loading = false;
        return;
      }
      try {
        const info = await api.myDeployment();
        if (!info.tenant) throw new Error("Aucun complexe associé à ce compte.");
        this.profile = {
          accountId: "",
          tenantId: info.tenant.id,
          complexName: info.tenant.name,
        };
        useDeploymentStore().info = info;
        this.armIdleTimer();
      } catch (err) {
        // A network failure is NOT a bad session — clearing the token would
        // log the user out every time the internet blinked, which on a
        // CONNECTED school is constantly.
        if (!api.isOfflineError(err)) {
          api.clearToken();
          this.profile = null;
        }
      } finally {
        this.loading = false;
      }
    },

    async sendOtp(phone: string, recaptchaId: string) {
      await phoneAuth.sendOtp(phone, recaptchaId);
    },

    async verifyOtp(code: string) {
      const token = await phoneAuth.confirmOtp(code);
      api.setToken(token);
      try {
        const info = await api.myDeployment();
        if (!info.tenant) throw new Error("Aucun complexe associé à ce compte.");
        this.profile = {
          accountId: "",
          tenantId: info.tenant.id,
          complexName: info.tenant.name,
        };
        useDeploymentStore().info = info;
        this.armIdleTimer();
      } catch (err) {
        api.clearToken();
        this.profile = null;
        throw err;
      }
    },

    async signOut() {
      await phoneAuth.signOut().catch(() => {});
      api.clearToken();
      this.profile = null;
      if (idleTimer) window.clearTimeout(idleTimer);
    },

    armIdleTimer() {
      const reset = () => {
        if (idleTimer) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => void this.signOut(), IDLE_MS);
      };
      ["click", "keydown", "scroll"].forEach((e) =>
        window.addEventListener(e, reset, { passive: true }),
      );
      reset();
    },
  },
});
