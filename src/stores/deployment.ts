import { defineStore } from "pinia";
import * as api from "../lib/api";
import { loadConfig, type DeploymentInfo } from "../lib/runtime";

/**
 * Where am I, and can I write?
 *
 * The rest of the console is deliberately blind to the service ladder — pages
 * call the API and render what comes back. This store is the one place that
 * knows, and it exists to answer two questions the user actually feels:
 *
 *   · "why did my save fail?"  → not the write authority, or migrating
 *   · "is this thing working?" → the server is unreachable
 *
 * Both are states a school WILL hit — the internet drops on CONNECTED, the box
 * loses power on SOVEREIGN — and silence is the worst possible answer to either.
 */

/** Re-probe roughly every half minute; cheap, unauthenticated, no tenant data. */
const PROBE_MS = 30_000;
let probeTimer: number | undefined;

export const useDeploymentStore = defineStore("deployment", {
  state: () => ({
    info: null as DeploymentInfo | null,
    /** Last probe failed at the network level — nothing answered. */
    unreachable: false,
    loading: true,
    configLabel: null as string | null,
  }),

  getters: {
    mode: (s) => s.info?.mode ?? null,
    tier: (s) => s.info?.tenant?.tier ?? null,
    complexName: (s) => s.info?.tenant?.name ?? null,

    /** Writes are expected to succeed. False during a migration drain, or when
     *  the browser reached a node that is not the authority. */
    writable: (s) => s.info?.tenant?.writable ?? false,

    migrating: (s) => Boolean(s.info?.tenant?.migrationLockedAt),

    /** Anything the user should be warned about before they lose work. */
    degraded(): boolean {
      return this.unreachable || (this.info?.tenant !== null && !this.writable);
    },

    /** One sentence, in the buyer's language, for the banner. */
    banner(): string | null {
      if (this.unreachable) {
        return this.mode === "EDGE"
          ? "Le serveur de l'établissement ne répond pas. Prévenez l'administrateur."
          : "Connexion au serveur perdue. Vos modifications ne seront pas enregistrées.";
      }
      if (this.migrating) {
        return "Migration en cours vers une autre formule. Les enregistrements sont suspendus quelques minutes.";
      }
      if (this.info?.tenant && !this.writable) {
        return "Cet appareil est en lecture seule pour ce complexe. Les modifications se font sur le serveur principal.";
      }
      return null;
    },

    /** Short label for the header badge. */
    badge(): string {
      if (this.unreachable) return "Hors ligne";
      if (this.mode === "EDGE") return "Serveur local";
      return "Cloud";
    },
  },

  actions: {
    /** Boot: read /config.json, then ask the API what it is. */
    async init() {
      const cfg = await loadConfig();
      this.configLabel = cfg.label;
      await this.probe();
      this.armProbe();
      this.loading = false;
    },

    /**
     * Unauthenticated probe. Deliberately does not require a session — the
     * login screen needs to say "server unreachable" before anyone signs in,
     * which is exactly when a school is most confused about what is wrong.
     */
    async probe() {
      try {
        this.info = await api.platformInfo();
        this.unreachable = false;
      } catch (err) {
        if (api.isOfflineError(err)) {
          this.unreachable = true;
        }
        // A non-network error (4xx/5xx) still means a server answered, so the
        // node is up — leave `unreachable` alone rather than crying offline.
      }
    },

    /** Re-read with the session's tenant, so tier and writability are real. */
    async refreshForSession() {
      try {
        this.info = await api.myDeployment();
        this.unreachable = false;
      } catch (err) {
        if (api.isOfflineError(err)) this.unreachable = true;
      }
    },

    armProbe() {
      if (probeTimer) window.clearInterval(probeTimer);
      probeTimer = window.setInterval(() => {
        void (this.info?.tenant ? this.refreshForSession() : this.probe());
      }, PROBE_MS);

      // The browser's own signal is a useful hint but not the truth — a laptop
      // on school wifi with no uplink reports "online" while the cloud is
      // unreachable. Use it only to probe sooner, never to set state.
      window.addEventListener("online", () => void this.probe());
      window.addEventListener("offline", () => {
        this.unreachable = true;
      });
    },
  },
});
