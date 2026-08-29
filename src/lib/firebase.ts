// Firebase phone-OTP wrapper for the console login.
//
// Same identity model as teamfarm: staff sign in with phone + OTP, and the
// resulting Firebase ID token is the Bearer token for /api/*. The backend's
// requireAuth verifies it and resolves the caller's tenant and grants.
//
// Two modes:
//   configured (VITE_FIREBASE_API_KEY set) -> real Firebase phone auth
//   otherwise                              -> mock (OTP code "123456")
//
// Unlike teamfarm-web there are NO baked-in project keys: École is a
// multi-tenant product that may point at different Firebase projects per
// deployment, so config is env-only and a missing key degrades to mock rather
// than silently authenticating against someone else's project.
const CFG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configured = Boolean(CFG.apiKey && CFG.authDomain);
const useMock = (import.meta.env.VITE_USE_MOCK ?? "false").toString() === "true";
export const firebaseConfigured = configured && !useMock;

let authModule: typeof import("firebase/auth") | null = null;
let authInstance: import("firebase/auth").Auth | null = null;
let recaptcha: import("firebase/auth").RecaptchaVerifier | null = null;
let confirmation: import("firebase/auth").ConfirmationResult | null = null;

async function ensureAuth() {
  if (authInstance) return { auth: authInstance, mod: authModule! };
  const { initializeApp } = await import("firebase/app");
  const mod = await import("firebase/auth");
  const clean = Object.fromEntries(
    Object.entries(CFG).filter(([, v]) => v != null),
  ) as Record<string, string>;
  const app = initializeApp(clean);
  authInstance = mod.getAuth(app);
  authModule = mod;
  return { auth: authInstance, mod };
}

export const phoneAuth = {
  configured: firebaseConfigured,

  /** Send an OTP to `phone` in E.164 (Congo: +242…). */
  async sendOtp(phone: string, recaptchaContainerId: string): Promise<void> {
    if (!firebaseConfigured) {
      await new Promise((r) => setTimeout(r, 400));
      if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/\s/g, ""))) {
        throw new Error("Entrez un numéro valide au format international.");
      }
      confirmation = { verificationId: "mock" } as never;
      return;
    }
    const { auth, mod } = await ensureAuth();
    if (!recaptcha) {
      recaptcha = new mod.RecaptchaVerifier(auth, recaptchaContainerId, { size: "invisible" });
    }
    confirmation = await mod.signInWithPhoneNumber(auth, phone, recaptcha);
  },

  /** Confirm the code and return a fresh Firebase ID token. */
  async confirmOtp(code: string): Promise<string> {
    if (!confirmation) throw new Error("Demandez d'abord un code.");
    if (!firebaseConfigured) {
      await new Promise((r) => setTimeout(r, 400));
      if (code !== "123456") throw new Error("Code incorrect. (Code de démo : 123456.)");
      return "mock.firebase.idtoken";
    }
    const cred = await confirmation.confirm(code);
    return cred.user.getIdToken();
  },

  async getIdToken(forceRefresh = false): Promise<string | null> {
    if (!firebaseConfigured) return localStorage.getItem("ec_token");
    const { auth } = await ensureAuth();
    return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
  },

  async signOut(): Promise<void> {
    if (!firebaseConfigured) return;
    const { auth, mod } = await ensureAuth();
    await mod.signOut(auth);
  },
};
