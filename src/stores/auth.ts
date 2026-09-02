import { defineStore } from "pinia";
import * as api from "../lib/api";
import { phoneAuth } from "../lib/firebase";
import { useDeploymentStore } from "./deployment";

// Console sessions should not linger open on a shared office machine.
const IDLE_MS = 30 * 60 * 1000;
let idleTimer: number | undefined;

export interface Profile {
  accountId: string;
  fullName: string;
  phone: string;
  /**
   * True for an operator of the product itself, who belongs to no
   * établissement. They get the platform console; everyone else gets their own
   * school's.
   */
  isPlatformAdmin: boolean;
  /** Whose face this account is — null for a shared office login. */
  personId: string | null;
  permissions: string[];
  /** Null for platform staff — see above. */
  tenantId: string | null;
  complexName: string | null;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    profile: null as Profile | null,
    loading: true,
    /**
     * The phone authenticated, but no account is attached to it. Distinct from
     * "signed out" and from "wrong code": nothing the user types will fix it,
     * so the login screen says so instead of offering the form again.
     */
    unlinkedPhone: null as string | null,
  }),
  getters: {
    isAuthed: (s) => s.profile !== null,
    isPlatformAdmin: (s) => s.profile?.isPlatformAdmin ?? false,
    /** Signed in AND attached to an établissement — the school console's gate. */
    hasComplex: (s) => Boolean(s.profile && s.profile.tenantId),
    can:
      (s) =>
      (permission: string): boolean =>
        s.profile?.permissions.includes(permission) ?? false,
    /** Initials for the avatar, from the name the account was registered under. */
    initials: (s) =>
      (s.profile?.fullName ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("") || "?",
  },
  actions: {
    /**
     * Restore a session by asking the API who we are.
     *
     * `/platform/me` answers identity; it used to be `/platform/me/deployment`,
     * which answers LOCATION, and conflating the two is what made a platform
     * account impossible to sign in with — that endpoint returns a null tenant
     * for them, which this store read as a broken account and responded to by
     * discarding the token. A super administrator legitimately has no tenant.
     */
    async restore() {
      this.loading = true;
      if (!api.getToken()) {
        this.loading = false;
        return;
      }
      try {
        this.adopt(await api.me());
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
      this.unlinkedPhone = null;
      await phoneAuth.sendOtp(phone, recaptchaId);
    },

    async verifyOtp(code: string, phone: string) {
      const token = await phoneAuth.confirmOtp(code);
      api.setToken(token);
      try {
        this.adopt(await api.me());
      } catch (err) {
        api.clearToken();
        this.profile = null;
        // Their code was right and their number is real; they simply have not
        // been registered. Recorded so the screen can say that, rather than
        // repeating a form that will fail identically.
        if (api.isNoAccountError(err)) {
          this.unlinkedPhone = phone;
        }
        throw err;
      }
    },

    /** Fold an identity response into the store. */
    adopt(identity: api.Identity) {
      this.profile = {
        accountId: identity.account.id,
        fullName: identity.account.fullName,
        phone: identity.account.phone,
        isPlatformAdmin: identity.account.isPlatformAdmin,
        personId: identity.account.personId ?? null,
        permissions: identity.account.permissions,
        tenantId: identity.deployment.tenant?.id ?? null,
        complexName: identity.deployment.tenant?.name ?? null,
      };
      this.unlinkedPhone = null;
      useDeploymentStore().info = identity.deployment;
      this.armIdleTimer();
    },

    async signOut() {
      await phoneAuth.signOut().catch(() => {});
      api.clearToken();
      this.profile = null;
      this.unlinkedPhone = null;
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
