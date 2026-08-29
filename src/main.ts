import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useDeploymentStore } from "./stores/deployment";
import "./index.css";
import "./styles/app.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

// Discover the deployment BEFORE mounting. Every screen — including login —
// needs to be able to say "the server is unreachable", and finding that out
// after first paint produces a flash of a working-looking UI that isn't.
void useDeploymentStore()
  .init()
  .finally(() => app.mount("#app"));
