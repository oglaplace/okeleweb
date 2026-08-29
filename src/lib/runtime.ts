/**
 * Runtime configuration — the single decision that lets ONE bundle serve every
 * rung of the service ladder.
 *
 * The same `dist/` is served three ways:
 *
 *   CONNECTED  cloud only        → apiBase "https://api.…/api"
 *   RESILIENT  cloud + edge box  → whichever the browser reached
 *   SOVEREIGN  edge box owns it  → apiBase "/api" on the box itself
 *
 * If the API base were a build-time `VITE_` variable, each of those would need
 * its own build, and moving a school between rungs would mean re-issuing the
 * frontend. So it is READ AT BOOT from `/config.json`, a small file sitting
 * next to index.html that the deployer owns.
 *
 * Everything else in the app treats the tier as invisible. Only the badge in
 * the header and the offline banner ever mention it.
 */

export interface RuntimeConfig {
  apiBase: string;
  /** Shown in the header on an edge box, e.g. "Bureau — Lycée Saint-Exupéry". */
  label: string | null;
}

export interface DeploymentInfo {
  mode: "CLOUD" | "EDGE";
  label: string | null;
  appVersion: string;
  schemaVersion: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    locale: string;
    currency: string;
    tier: "CONNECTED" | "RESILIENT" | "SOVEREIGN";
    authority: "CLOUD" | "EDGE";
    migrationLockedAt: string | null;
    /** Whether THIS node accepts writes for this complex right now. */
    writable: boolean;
  } | null;
}

const FALLBACK: RuntimeConfig = { apiBase: "/api", label: null };

let cached: RuntimeConfig | null = null;

/**
 * Loads /config.json once.
 *
 * A dev override wins so `vite dev` can point at a local API without editing a
 * file that ships. Any failure falls back to same-origin `/api`, which is
 * correct on an edge box and correct in the cloud when the API is served from
 * the same host — the only case it gets wrong is a misconfigured deploy, and
 * that surfaces immediately as a failed /platform/info call rather than silently.
 */
export async function loadConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;

  const override = import.meta.env.VITE_API_URL;
  if (override) {
    cached = { apiBase: override, label: null };
    return cached;
  }

  try {
    // cache: "no-store" matters — a stale config.json cached from the cloud
    // deploy would point an edge box at an API it cannot reach when the
    // internet is down, which is the exact moment it must not.
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as Partial<RuntimeConfig>;
    cached = {
      apiBase: raw.apiBase || FALLBACK.apiBase,
      label: raw.label ?? null,
    };
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

/** Synchronous accessor for code paths that run after boot. */
export function config(): RuntimeConfig {
  return cached ?? FALLBACK;
}

/** Test seam + a way for the installer story to be exercised in dev. */
export function overrideConfig(next: RuntimeConfig): void {
  cached = next;
}
