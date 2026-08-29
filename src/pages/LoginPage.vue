<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useBusyStore } from "../stores/busy";
import { useDeploymentStore } from "../stores/deployment";
import { firebaseConfigured } from "../lib/firebase";
import PhoneInput from "../components/ui/PhoneInput.vue";
import ThemeToggle from "../components/ThemeToggle.vue";

const auth = useAuthStore();
const busy = useBusyStore();
const dep = useDeploymentStore();
const router = useRouter();

const step = ref<"phone" | "code">("phone");
const phone = ref("");
const code = ref("");
const working = ref(false);
const error = ref<string | null>(null);

/**
 * The phone authenticated but is attached to nothing.
 *
 * Kept separate from `error` because it is not a failure the user can retry
 * their way out of — offering the form again would let them enter a correct
 * code three more times and conclude the software is broken.
 */
const unlinked = computed(() => auth.unlinkedPhone);
const phoneReady = computed(() => /^\+242\d{9}$/.test(phone.value));

const serverLabel = computed(
  () => dep.configLabel ?? dep.info?.label ?? (dep.mode === "EDGE" ? "Serveur local" : "Cloud"),
);

async function send() {
  if (!phoneReady.value) return;
  working.value = true;
  error.value = null;
  try {
    await busy.run(() => auth.sendOtp(phone.value, "recaptcha"));
    step.value = "code";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Envoi impossible.";
  } finally {
    working.value = false;
  }
}

async function verify() {
  working.value = true;
  error.value = null;
  try {
    await busy.run(() => auth.verifyOtp(code.value.trim(), phone.value));
    // One destination. The landing route decides which console this account
    // belongs to, so nothing here has to know.
    await router.replace({ name: "landing" });
  } catch (e) {
    if (!auth.unlinkedPhone) {
      error.value = e instanceof Error ? e.message : "Code refusé.";
    }
  } finally {
    working.value = false;
  }
}

function restart() {
  void auth.signOut();
  step.value = "phone";
  code.value = "";
  error.value = null;
}
</script>

<template>
  <div class="login">
    <div class="login-col">
      <!-- The only bold element on the screen. -->
      <div class="login-brand">
        <span class="login-mark" aria-hidden="true">T</span>
        <div>
          <div class="login-wordmark">TeYa</div>
          <div class="login-tagline">Gestion scolaire</div>
        </div>
      </div>

      <div class="login-card">
        <!-- The phone works, the account does not exist. Nothing to retry. -->
        <template v-if="unlinked">
          <div class="login-title">Numéro non rattaché</div>
          <div class="login-sub">
            Le numéro <strong>{{ unlinked }}</strong> est valide, mais il n'est
            rattaché à aucun établissement.
          </div>
          <div class="form-error">
            Demandez à l'administrateur de votre établissement de vous ajouter,
            puis réessayez.
          </div>
          <button class="btn block" type="button" @click="restart">
            Essayer un autre numéro
          </button>
        </template>

        <template v-else>
          <div class="login-title">
            {{ step === "phone" ? "Connexion" : "Vérification" }}
          </div>
          <div class="login-sub">
            {{
              step === "phone"
                ? "Entrez le numéro déclaré par votre établissement."
                : `Nous avons envoyé un code à six chiffres au ${phone}.`
            }}
          </div>

          <!-- Shown BEFORE sign-in on purpose: "the server is unreachable" is
               the answer to most login failures, and finding out after three
               rejected codes is how a school decides the software is broken. -->
          <div v-if="dep.unreachable" class="form-error">
            Le serveur ne répond pas. Vérifiez la connexion avant de vous identifier.
          </div>
          <div v-else-if="error" class="form-error">{{ error }}</div>

          <form v-if="step === 'phone'" @submit.prevent="send">
            <div class="field">
              <label for="phone">Numéro de téléphone</label>
              <PhoneInput id="phone" v-model="phone" :disabled="working" autofocus />
            </div>
            <button
              class="btn primary block"
              type="submit"
              :disabled="working || !phoneReady"
            >
              <span v-if="working" class="btn-spin" aria-hidden="true" />
              {{ working ? "Envoi…" : "Continuer" }}
            </button>
          </form>

          <form v-else @submit.prevent="verify">
            <div class="field">
              <label for="code">Code de vérification</label>
              <input
                id="code"
                v-model="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="123456"
              />
              <span v-if="!firebaseConfigured" class="hint">
                Mode démo : le code est 123456.
              </span>
            </div>
            <button class="btn primary block" type="submit" :disabled="working">
              <span v-if="working" class="btn-spin" aria-hidden="true" />
              {{ working ? "Vérification…" : "Se connecter" }}
            </button>
            <button
              class="btn ghost block"
              type="button"
              style="margin-top: var(--s2)"
              @click="step = 'phone'"
            >
              Changer de numéro
            </button>
          </form>
        </template>
      </div>

      <div class="login-foot">
        <span class="login-status">
          <span class="login-dot" :class="{ 'is-down': dep.unreachable }" aria-hidden="true" />
          <span class="login-server">{{ serverLabel }}</span>
        </span>
        <ThemeToggle />
      </div>
    </div>
  </div>
</template>
