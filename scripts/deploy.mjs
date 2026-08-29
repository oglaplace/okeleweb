#!/usr/bin/env node
/**
 * One-command deploy for the CONNECTED rung (Cloudflare Pages + cloud API).
 *
 * The whole reason this script exists rather than a plain `wrangler pages
 * deploy`: `apiBase` is deliberately NOT a build-time VITE_ variable (see
 * src/lib/runtime.ts), so it has to be written into dist/config.json AFTER
 * vite copies public/ over dist/. Doing that by hand is exactly the step that
 * gets forgotten, and forgetting it ships a bundle that calls /api on the
 * Pages origin and 404s on every request.
 *
 * It also refuses two deploys that fail silently rather than loudly:
 *   - no ECOLE_API_BASE  -> bundle points at the wrong origin
 *   - no Firebase keys   -> src/lib/firebase.ts degrades to mock auth, and the
 *                           console accepts OTP "123456" from anyone
 *
 * Usage:
 *   ECOLE_API_BASE=https://ecole-api.up.railway.app/api npm run deploy
 *   ECOLE_API_BASE=/api ECOLE_LABEL="Bureau — Lycée X" npm run deploy -- --no-upload
 *
 * Flags:
 *   --no-upload    build + write config, skip wrangler (edge-box tarball)
 *   --allow-mock   permit a build with no Firebase keys (demo only)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const noUpload = argv.includes("--no-upload");
const allowMock = argv.includes("--allow-mock");

const die = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};
const step = (msg) => console.log(`\n  → ${msg}`);

// ── 1. preflight ────────────────────────────────────────────────────────────
const apiBase = process.env.ECOLE_API_BASE;
const label = process.env.ECOLE_LABEL || null;

if (!apiBase) {
  die(
    "ECOLE_API_BASE is required.\n" +
      "    cloud:    ECOLE_API_BASE=https://<api-host>/api\n" +
      "    edge box: ECOLE_API_BASE=/api ECOLE_LABEL=\"Bureau — Lycée X\"",
  );
}
if (!apiBase.startsWith("/") && !/^https:\/\//.test(apiBase)) {
  die(`ECOLE_API_BASE must be an https:// URL or a root-relative path, got: ${apiBase}`);
}
if (apiBase.endsWith("/")) {
  die(`ECOLE_API_BASE must not end with a slash (lib/api.ts appends the path): ${apiBase}`);
}

// A build with no Firebase keys silently enables the mock OTP path.
const fbKey = process.env.VITE_FIREBASE_API_KEY;
const fbDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN;
if (!allowMock && !(fbKey && fbDomain)) {
  die(
    "VITE_FIREBASE_API_KEY and VITE_FIREBASE_AUTH_DOMAIN must be set.\n" +
      "    Without them src/lib/firebase.ts falls back to MOCK auth and the\n" +
      "    console accepts the demo code 123456 from anyone.\n" +
      "    Pass --allow-mock only for a throwaway demo build.",
  );
}
if (process.env.VITE_USE_MOCK === "true" && !allowMock) {
  die("VITE_USE_MOCK=true would ship mock auth. Unset it, or pass --allow-mock.");
}

// VITE_API_URL is a DEV escape hatch: runtime.ts checks it before /config.json
// and returns early if set. A build with it exported would therefore ignore the
// config.json written below — the exact failure this script exists to prevent,
// except silent, because the file on disk would look correct.
if (process.env.VITE_API_URL) {
  die(
    `VITE_API_URL is set (${process.env.VITE_API_URL}).\n` +
      "    src/lib/runtime.ts reads it before /config.json and returns early, so\n" +
      "    it would be baked into the bundle and override the config.json this\n" +
      "    script writes. Unset it — set ECOLE_API_BASE instead.",
  );
}

// ── 2. build ────────────────────────────────────────────────────────────────
step("building (vue-tsc + vite)");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// ── 3. write config.json (must be AFTER build: vite copies public/ -> dist/) ─
const dist = resolve(root, "dist");
if (!existsSync(dist)) die("dist/ missing after build");

const config = {
  apiBase,
  label,
  note: "Written at deploy time by scripts/deploy.mjs. Never baked into the bundle.",
};
writeFileSync(resolve(dist, "config.json"), JSON.stringify(config, null, 2) + "\n");
step(`wrote dist/config.json  apiBase=${apiBase}${label ? `  label=${label}` : ""}`);

// ── 4. upload ───────────────────────────────────────────────────────────────
if (noUpload) {
  step("--no-upload: dist/ is ready to copy onto the box");
  process.exit(0);
}
step("uploading to Cloudflare Pages");
execFileSync(
  "npx",
  ["wrangler", "pages", "deploy", "dist", "--project-name", process.env.ECOLE_PAGES_PROJECT || "ecole-web"],
  { cwd: root, stdio: "inherit" },
);
