import { defineStore } from "pinia";

/**
 * What the app is doing right now, so the operator is never watching a frozen
 * screen and guessing.
 *
 * Two levels, because two things are genuinely different:
 *
 *   · a THIN top bar for any request in flight — the ambient "it heard you"
 *     that costs no layout and interrupts nothing.
 *   · a BLOCKING overlay for operations that write something irreversible and
 *     take real time. Registering an établissement mints a Firebase identity
 *     and opens a Postgres transaction; on a Brazzaville connection that is
 *     seconds, and a second click during those seconds is a second attempt at
 *     the same thing.
 *
 * A counter rather than a boolean: two overlapping requests must not have the
 * first one to finish declare the app idle.
 */
export const useBusyStore = defineStore("busy", {
  state: () => ({
    pending: 0,
    /** Set only for blocking work. Null means the overlay is not shown. */
    blocking: null as { title: string; detail: string } | null,
  }),

  getters: {
    active: (s) => s.pending > 0,
  },

  actions: {
    /**
     * Wraps a promise. Returns whatever it returns and rethrows what it throws,
     * so a call site reads exactly as it did before — the indicator must never
     * become a reason to restructure error handling.
     */
    async run<T>(work: () => Promise<T>, block?: { title: string; detail: string }): Promise<T> {
      this.pending += 1;
      if (block) this.blocking = block;
      try {
        return await work();
      } finally {
        this.pending = Math.max(0, this.pending - 1);
        if (block) this.blocking = null;
      }
    },
  },
});
