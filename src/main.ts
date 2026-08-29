import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useDeploymentStore } from "./stores/deployment";
import { initTheme } from "./lib/theme";
import "./index.css";
import "./styles/app.css";

// Before anything renders: a stored dark preference applied after first paint
// is a white flash, and on a cheap Android that flash is the whole boot.
initTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);

// Discover the deployment BEFORE mounting. Every screen — including login —
// needs to be able to say "the server is unreachable", and finding that out
// after first paint produces a flash of a working-looking UI that isn't.
void useDeploymentStore()
  .init()
  .finally(() => app.mount("#app"));
