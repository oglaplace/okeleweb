import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// École web (Vue 3), same stack as teamfarm-web.
//
// The dev server proxies /api to ecole-api so the console talks to real
// endpoints without CORS pain. In production the SAME built bundle is served
// from the cloud AND from an edge box in a school office — see src/lib/runtime.ts
// for why the API base is discovered at runtime rather than baked in here.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: process.env.VITE_API_ORIGIN || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  // firebase is only ever dynamically imported (src/lib/firebase.ts), so Vite's
  // dep scanner won't pre-bundle it — the first dynamic import would trigger an
  // on-the-fly optimize and a full reload, which reads as a blank flash in dev.
  optimizeDeps: {
    include: ["firebase/app", "firebase/auth"],
  },
});
