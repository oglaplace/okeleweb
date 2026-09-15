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
   * Carried through because the settings screen edits it.
   *
   * It was dropped here while `/platform/me` was returning it all along, and
   * the consequence was not a missing field on a screen — it was DATA LOSS:
   * the form opened with an empty box, and saving a corrected name sent
   * `email: null` and wiped an address nobody had touched.
   */
  email: string | null;
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
    /**
     * LES ÉTABLISSEMENTS À CHOISIR — une question, pas une panne.
     *
     * A vacataire sells hours to several complexes and signs in with one
     * number; the token says who they are and cannot say which school they
     * mean. Non-empty means the API asked, and nothing else will work until it
     * is answered.
     */
    tenantChoices: [] as api.TenantChoice[],
    /** Every établissement this person belongs to — for the switcher. */
    memberships: [] as api.Membership[],
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
    /**
     * ANY of them, mirroring `requirePermission('a','b')` on the API — which is
     * an OR, not an AND. A screen that reads with `finance.read` OR
     * `finance.write` must open for the holder of either; requiring both would
     * hide the encaissement screen from the person who does the encaissement.
     *
     * Undefined or empty means ungated: a read-only view with no key named is
     * open to anyone signed in, and the guard stays on the API either way.
     */
    canAny() {
      return (permission?: string | string[]): boolean => {
        if (!permission) return true;
        const held = this.profile?.permissions ?? [];
        const wanted = Array.isArray(permission) ? permission : [permission];
        return wanted.length === 0 || wanted.some((p) => held.includes(p));
      };
    },
    /** Who may hand out access. The gate on the whole team screen. */
    isComplexAdmin(): boolean {
      return this.profile?.permissions.includes("team.admin") ?? false;
    },
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
      /*
       * FIREBASE IS THE AUTHORITY, localStorage is only a cache of it.
       *
       * This used to return "signed out" whenever `ec_token` was missing, even
       * with a live Firebase session sitting in IndexedDB — a session the SDK
       * would have handed over a millisecond later. The copy is refreshed here
       * so the rest of the app, which reads the cached value when the SDK is
       * still waking up, is never the odd one out.
       */
      const live = await phoneAuth.getIdToken().catch(() => null);
      if (live) api.setToken(live);
      if (!api.getToken()) {
        this.loading = false;
        return;
      }
      try {
        this.adopt(await api.me());
      } catch (err) {
        /*
         * « Lequel ? » n'est pas « non ».
         *
         * The session is perfectly good; it simply has not said which school it
         * means. Keeping the token and surfacing the list is what turns this
         * from a dead end into a question — clearing it here was what left a
         * teacher employed by two complexes unable to enter either.
         */
        if (api.isTenantChoiceError(err)) {
          this.tenantChoices = api.tenantChoicesOf(err);
          this.profile = null;
          return;
        }
        /*
         * A stored choice that no longer holds — they were removed from that
         * school. Forget it and ask again rather than looping on a 403.
         */
        if (api.isNotAMemberError(err)) {
          api.clearTenant();
          try {
            this.adopt(await api.me());
            return;
          } catch (retry) {
            if (api.isTenantChoiceError(retry)) {
              this.tenantChoices = api.tenantChoicesOf(retry);
              this.profile = null;
              return;
            }
          }
        }
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
        /*
         * Again: « lequel ? » n'est pas « non ». The OTP was right, the number
         * is real, and the token stays — the screen asks which school and the
         * answer finishes the sign-in.
         */
        if (api.isTenantChoiceError(err)) {
          this.tenantChoices = api.tenantChoicesOf(err);
          this.profile = null;
          return;
        }
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

    /**
     * Répondre « celui-ci » — à la connexion comme en cours de route.
     *
     * The same act both times, which is why it is one method: answering the
     * question at sign-in and switching schools an hour later differ only in
     * whether a profile was already loaded. Switching therefore never signs
     * anybody out.
     */
    async chooseTenant(target: { tenantId: string | null }) {
      api.setTenant(api.tenantKeyOf(target));
      this.tenantChoices = [];
      this.loading = true;
      try {
        this.adopt(await api.me());
      } catch (err) {
        // The choice did not hold. Put the question back rather than stranding
        // them on a half-signed-in console.
        api.clearTenant();
        if (api.isTenantChoiceError(err)) {
          this.tenantChoices = api.tenantChoicesOf(err);
        }
        this.profile = null;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /** Fold an identity response into the store. */
    adopt(identity: api.Identity) {
      this.profile = {
        accountId: identity.account.id,
        fullName: identity.account.fullName,
        phone: identity.account.phone,
        email: identity.account.email ?? null,
        isPlatformAdmin: identity.account.isPlatformAdmin,
        personId: identity.account.personId ?? null,
        permissions: identity.account.permissions,
        tenantId: identity.deployment.tenant?.id ?? null,
        complexName: identity.deployment.tenant?.name ?? null,
      };
      this.unlinkedPhone = null;
      this.tenantChoices = [];
      this.memberships = identity.memberships ?? [];
      /*
       * Remember which school this session settled on.
       *
       * Without it a reload asks again — and for the many people who belong to
       * exactly one, the API never asked in the first place, so this is simply
       * how the header stays right after a refresh.
       */
      const mine = this.memberships.find((m) => m.current);
      if (mine) api.setTenant(api.tenantKeyOf(mine));
      else if (identity.deployment.tenant?.id) api.setTenant(identity.deployment.tenant.id);
      useDeploymentStore().info = identity.deployment;
      this.armIdleTimer();
    },

    async signOut() {
      await phoneAuth.signOut().catch(() => {});
      api.clearToken();
      // The chosen school goes with the session. Leaving it behind would send
      // the next person to sign in on this machine straight into somebody
      // else's établissement — or into a 403 they cannot read.
      api.clearTenant();
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
