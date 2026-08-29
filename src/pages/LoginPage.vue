<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useDeploymentStore } from "../stores/deployment";
import { firebaseConfigured } from "../lib/firebase";
import ThemeToggle from "../components/ThemeToggle.vue";

const auth = useAuthStore();
const dep = useDeploymentStore();
const router = useRouter();

const step = ref<"phone" | "code">("phone");
const phone = ref("+242");
const code = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

/**
 * The phone authenticated but is attached to nothing.
 *
 * Kept separate from `error` because it is not a failure the user can retry
 * their way out of — offering the form again would let them enter a correct
 * code three more times and conclude the software is broken. It has its own
 * screen, and the screen's job is to say who to call.
 */
const unlinked = computed(() => auth.unlinkedPhone);

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
    await auth.verifyOtp(code.value.trim(), phone.value.trim());
    // One destination. The landing route decides which console this account
    // belongs to, so nothing here has to know.
    await router.replace({ name: "landing" });
  } catch (e) {
    // The unlinked case renders its own screen; do not also shout at them.
    if (!auth.unlinkedPhone) {
      error.value = e instanceof Error ? e.message : "Code refusé.";
    }
  } finally {
    busy.value = false;
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
    <!-- The half a buyer sees in a demo. It carries the positioning, because
         this screen is often the only one they look at closely. -->
    <aside class="login-pitch">
      <div class="login-brand">
        <span class="login-brand-mark" aria-hidden="true">É</span>
        École
      </div>

      <div>
        <h1 class="login-headline">La scolarité, tenue comme une comptabilité.</h1>
        <p class="login-lede">
          Inscriptions, notes, conseils de classe et bulletins officiels — pour les
          complexes scolaires, lycées et universités du Congo-Brazzaville.
        </p>
      </div>

      <ul class="login-points">
        <li>Bulletins conformes, imprimés depuis le navigateur.</li>
        <li>Coefficients par niveau et par série, modifiables sans développeur.</li>
        <li>Fonctionne sur le serveur de l'établissement quand internet tombe.</li>
      </ul>

      <div class="login-foot">Brazzaville · Pointe-Noire</div>
    </aside>

    <div class="login-panel">
      <div class="login-card">
        <!-- The phone works, the account does not exist. Nothing to retry. -->
        <template v-if="unlinked">
          <div class="login-title">Numéro non rattaché</div>
          <div class="login-sub">
            Le numéro <strong>{{ unlinked }}</strong> est valide, mais il n'est rattaché
            à aucun établissement.
          </div>
          <div class="form-error">
            Demandez à l'administrateur de votre établissement de vous ajouter, puis
            réessayez.
          </div>
          <button class="btn block" type="button" @click="restart">
            Essayer un autre numéro
          </button>
        </template>

        <template v-else>
          <div class="login-title">Connexion</div>
          <div class="login-sub">
            {{
              step === "phone"
                ? "Identifiez-vous avec le numéro déclaré par votre établissement."
                : "Saisissez le code à six chiffres reçu par SMS."
            }}
          </div>

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
              <input
                id="phone"
                v-model="phone"
                type="tel"
                autocomplete="tel"
                placeholder="+242 06 000 00 00"
              />
              <span class="hint">Format international, comme sur votre carte SIM.</span>
            </div>
            <button class="btn primary block" type="submit" :disabled="busy">
              {{ busy ? "Envoi…" : "Recevoir le code" }}
            </button>
          </form>

          <form v-else @submit.prevent="verify">
            <div class="field">
              <label for="code">Code reçu par SMS</label>
              <input
                id="code"
                v-model="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="123456"
              />
              <span v-if="!firebaseConfigured" class="hint">Mode démo : le code est 123456.</span>
              <span v-else class="hint">Envoyé au {{ phone }}.</span>
            </div>
            <div class="login-actions">
              <button class="btn primary" type="submit" :disabled="busy">
                {{ busy ? "Vérification…" : "Se connecter" }}
              </button>
              <button class="btn ghost" type="button" @click="step = 'phone'">
                Changer de numéro
              </button>
            </div>
          </form>
        </template>

        <div class="login-meta">
          <span>{{ dep.configLabel ?? dep.info?.label ?? "Serveur École" }}</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  </div>
</template>
