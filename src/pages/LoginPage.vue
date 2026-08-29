<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useDeploymentStore } from "../stores/deployment";
import { firebaseConfigured } from "../lib/firebase";

const auth = useAuthStore();
const dep = useDeploymentStore();
const router = useRouter();

const step = ref<"phone" | "code">("phone");
const phone = ref("+242");
const code = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function send() {
  busy.value = true;
  error.value = null;
  try {
    await auth.sendOtp(phone.value.trim(), "recaptcha");
    step.value = "code";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Envoi impossible.";
  } finally {
    busy.value = false;
  }
}

async function verify() {
  busy.value = true;
  error.value = null;
  try {
    await auth.verifyOtp(code.value.trim());
    await router.replace({ name: "dashboard" });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Code refusé.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login-card">
      <div class="login-title">École</div>
      <div class="login-sub">Console d'administration du complexe scolaire</div>

      <!-- Shown BEFORE sign-in on purpose: "the server is unreachable" is the
           answer to most login failures, and finding out after three rejected
           codes is how a school decides the software is broken. -->
      <div v-if="dep.unreachable" class="form-error">
        Le serveur ne répond pas. Vérifiez la connexion avant de vous identifier.
      </div>
      <div v-else-if="error" class="form-error">{{ error }}</div>

      <form v-if="step === 'phone'" @submit.prevent="send">
        <div class="field">
          <label for="phone">Numéro de téléphone</label>
          <input id="phone" v-model="phone" type="tel" autocomplete="tel" placeholder="+242 06 000 00 00" />
          <span class="hint">Format international, comme sur votre carte SIM.</span>
        </div>
        <button class="btn primary" type="submit" :disabled="busy">
          {{ busy ? "Envoi…" : "Recevoir le code" }}
        </button>
      </form>

      <form v-else @submit.prevent="verify">
        <div class="field">
          <label for="code">Code reçu par SMS</label>
          <input id="code" v-model="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
          <span v-if="!firebaseConfigured" class="hint">Mode démo : le code est 123456.</span>
        </div>
        <button class="btn primary" type="submit" :disabled="busy">
          {{ busy ? "Vérification…" : "Se connecter" }}
        </button>
        <button class="btn" type="button" style="margin-left: 8px" @click="step = 'phone'">
          Changer de numéro
        </button>
      </form>
    </div>
  </div>
</template>
