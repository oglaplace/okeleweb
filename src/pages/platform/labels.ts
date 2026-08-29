import type { EstablishmentType, ServiceTier } from "../../lib/api";

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
