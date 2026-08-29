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
 * code three more times and conclude the software is broken. It has its own
 * screen, and the screen's job is to say who to call.
 */
const unlinked = computed(() => auth.unlinkedPhone);
const phoneReady = computed(() => /^\+242\d{9}$/.test(phone.value));

const serverLabel = computed(
  () => dep.configLabel ?? dep.info?.label ?? (dep.mode === "EDGE" ? "Serveur local" : "Cloud"),
);
const serverState = computed(() => (dep.unreachable ? "Sans réponse" : "En ligne"));

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
    // The unlinked case renders its own screen; do not also shout at them.
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
    <div class="login-frame">
      <!-- The sheet: laid out like the document this product prints. -->
      <div class="sheet">
        <div class="sheet-head">
          <div class="sheet-mark">
            <span class="sheet-mark-badge" aria-hidden="true">T</span>
            <span class="sheet-wordmark">TeYa</span>
          </div>
          <div class="sheet-kicker">Scolarité · Notes · Bulletins</div>
        </div>

        <div class="sheet-meta">
          <div>
            <div class="sheet-meta-label">Serveur</div>
            <div class="sheet-meta-value">{{ serverLabel }}</div>
          </div>
          <div>
            <div class="sheet-meta-label">État</div>
            <div class="sheet-meta-value">{{ serverState }}</div>
          </div>
        </div>

        <div class="sheet-body">
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
            <div class="login-title">Connexion</div>
            <div class="login-sub">
              {{
                step === "phone"
                  ? "Le numéro déclaré par votre établissement."
                  : "Le code à six chiffres reçu par SMS."
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
                <span class="hint">Celui qui reçoit vos SMS.</span>
              </div>
              <button
                class="btn primary block"
                type="submit"
                :disabled="working || !phoneReady"
              >
                <span v-if="working" class="btn-spin" aria-hidden="true" />
                {{ working ? "Envoi…" : "Recevoir le code" }}
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
                <span v-if="!firebaseConfigured" class="hint">
                  Mode démo : le code est 123456.
                </span>
                <span v-else class="hint">Envoyé au {{ phone }}.</span>
              </div>
              <div class="login-actions">
                <button class="btn primary" type="submit" :disabled="working">
                  <span v-if="working" class="btn-spin" aria-hidden="true" />
                  {{ working ? "Vérification…" : "Se connecter" }}
                </button>
                <button class="btn ghost" type="button" @click="step = 'phone'">
                  Changer de numéro
                </button>
              </div>
            </form>
          </template>
        </div>

        <div class="sheet-foot">
          <span class="sheet-sign">Le Chef d'établissement</span>
          <ThemeToggle />
        </div>
      </div>

      <!-- The pitch is the artefact, not a paragraph about it. -->
      <aside class="proof">
        <p class="proof-lede">
          Le conseil de classe est prêt avant que vous n'entriez en salle.
        </p>
        <p class="proof-sub">
          Les notes saisies une fois deviennent moyennes, rangs, mentions et
          bulletins — avec les coefficients de votre série, pas ceux d'un logiciel
          importé.
        </p>

        <div class="proof-card">
          <div class="proof-card-head">Bulletin · 2e trimestre · 2nde C</div>

          <div class="proof-figures">
            <div>
              <div class="proof-fig-value">12,84</div>
              <div class="proof-fig-label">Moyenne</div>
            </div>
            <div>
              <div class="proof-fig-value">4<span style="font-size: 12px">/38</span></div>
              <div class="proof-fig-label">Rang</div>
            </div>
            <div>
              <div class="proof-fig-value" style="font-size: 15px">A. Bien</div>
              <div class="proof-fig-label">Mention</div>
            </div>
          </div>

          <div class="proof-lines">
            <div class="proof-line"><span>Mathématiques ×5</span><b>14,50</b></div>
            <div class="proof-line"><span>Physique-Chimie ×4</span><b>13,25</b></div>
            <div class="proof-line"><span>Français ×3</span><b>11,00</b></div>
            <div class="proof-line"><span>SVT ×3</span><b>12,75</b></div>
          </div>
        </div>

        <ul class="proof-points">
          <li>Coefficients par niveau et par série, changés sans nous appeler.</li>
          <li>Internet coupé : le serveur de l'établissement prend le relais.</li>
          <li>Les bulletins s'impriment depuis le navigateur, rien à installer.</li>
        </ul>
      </aside>
    </div>
  </div>
</template>
