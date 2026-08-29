import type { BlueprintModule, EstablishmentType, ServiceTier } from "../../lib/api";

/**
 * The buyer's words for our enum values.
 *
 * Kept in one file because the same six strings appear on the list, the form
 * and the detail page, and three copies is how "Université" becomes "Universite"
 * on exactly one screen.
 */
export const ESTABLISHMENT_LABELS: Record<EstablishmentType, string> = {
  COMPLEXE: "Complexe scolaire",
  PRESCOLAIRE: "École préscolaire",
  PRIMAIRE: "École primaire",
  COLLEGE: "Collège",
  LYCEE: "Lycée",
  UNIVERSITE: "Université",
};

/** What the scaffold actually creates, so the choice is not a guess. */
export const ESTABLISHMENT_NOTES: Record<EstablishmentType, string> = {
  COMPLEXE: "Plusieurs écoles sous une même direction. Vous les créerez ensuite.",
  PRESCOLAIRE: "Une école, cycle préscolaire.",
  PRIMAIRE: "Une école, cycle primaire.",
  COLLEGE: "Une école, premier cycle.",
  LYCEE: "Une école, second cycle.",
  UNIVERSITE: "Un établissement supérieur. Facultés et filières à créer ensuite.",
};

export const TIER_LABELS: Record<ServiceTier, string> = {
  CONNECTED: "Connecté",
  RESILIENT: "Résilient",
  SOVEREIGN: "Autonome",
};

export const TIER_NOTES: Record<ServiceTier, string> = {
  CONNECTED: "Données chez nous. Une connexion internet est nécessaire.",
  RESILIENT: "Serveur local pour la consultation, données conservées chez nous.",
  SOVEREIGN: "Données sur le serveur de l'établissement, sauvegardées chez nous.",
};

// ─── blueprint modules ───────────────────────────────────────────────────────


/**
 * The structure catalogue, in the operator's words.
 *
 * `basis` is the important field and the reason this is not just a name map: it
 * says WHERE each shape comes from. Five of these are the January 2026 reform;
 * one — administration — is convention, and saying so is the difference between
 * a default and a claim about the law.
 */
export const MODULE_LABELS: Record<BlueprintModule, string> = {
  PRESCOLAIRE: "Préscolaire",
  PRIMAIRE: "Primaire",
  COLLEGE: "Collège",
  LYCEE_GENERAL: "Lycée général",
  LYCEE_TECHNIQUE: "Lycée technique",
  SUPERIEUR: "Enseignement supérieur",
  ADMINISTRATION: "Administration",
};

export const MODULE_SUMMARIES: Record<BlueprintModule, string> = {
  PRESCOLAIRE: "Petite, moyenne et grande section.",
  PRIMAIRE: "CP, CE1, CE2, CM1, CM2 — cinq années.",
  COLLEGE: "De la 6e à la 3e, jusqu'au BEPC.",
  LYCEE_GENERAL: "2nde, 1ère, Terminale + séries A, C, D.",
  LYCEE_TECHNIQUE: "Filières industrielle et tertiaire + séries E, F, G.",
  SUPERIEUR: "Faculté, filières, Licence 1–3 et Master 1–2.",
  ADMINISTRATION: "Direction, censorat, surveillance, économat, vie scolaire.",
};

/** Where the shape comes from. Shown so nobody mistakes a convention for a law. */
export const MODULE_BASIS: Record<BlueprintModule, string> = {
  PRESCOLAIRE: "Réforme 2026 — 3e année obligatoire",
  PRIMAIRE: "Réforme 2026 — 5 ans, CP unique, CEP",
  COLLEGE: "Architecture maintenue — BEPC",
  LYCEE_GENERAL: "Architecture maintenue — baccalauréat",
  LYCEE_TECHNIQUE: "Réforme 2026 — BET puis bac technique",
  SUPERIEUR: "Réforme 2026 — LMD généralisé",
  ADMINISTRATION: "Usage courant — pas une obligation légale",
};

export const MODULE_ORDER: BlueprintModule[] = [
  "PRESCOLAIRE", "PRIMAIRE", "COLLEGE", "LYCEE_GENERAL",
  "LYCEE_TECHNIQUE", "SUPERIEUR", "ADMINISTRATION",
];

/** Mirrors the API's DEFAULT_MODULES so the form can preselect without a round trip. */
export const DEFAULT_MODULES: Record<string, BlueprintModule[]> = {
  COMPLEXE: ["PRESCOLAIRE", "PRIMAIRE", "COLLEGE", "LYCEE_GENERAL", "ADMINISTRATION"],
  PRESCOLAIRE: ["PRESCOLAIRE", "ADMINISTRATION"],
  PRIMAIRE: ["PRIMAIRE", "ADMINISTRATION"],
  COLLEGE: ["COLLEGE", "ADMINISTRATION"],
  LYCEE: ["LYCEE_GENERAL", "ADMINISTRATION"],
  UNIVERSITE: ["SUPERIEUR", "ADMINISTRATION"],
};
