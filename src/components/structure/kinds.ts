import type { OrgUnitKind } from "../../lib/api";

/**
 * A kind, plus the one row in the grille tarifaire that is not an OrgUnit.
 *
 * "STAFF" never comes out of the structure endpoints — only the tariff grid
 * emits it, for the single row that prices what employees pay. It lives in the
 * same map so every screen that labels a kind labels that row too.
 */
export type TariffKind = OrgUnitKind | "STAFF";

/** The buyer's word for each kind. */
export const KIND_FR: Record<TariffKind, string> = {
  // The row is named "Employés"; the KIND is what sort of row it is.
  STAFF: "Personnel",
  COMPLEX: "Complexe",
  ORG_DIVISION: "Direction",
  DEPARTMENT: "Département",
  SCHOOL: "École",
  CYCLE: "Cycle",
  FACULTY: "Faculté",
  FILIERE: "Filière",
  PARCOURS: "Parcours",
  NIVEAU: "Niveau",
  CLASSE: "Classe",
};

/**
 * Three letters, for the tree.
 *
 * The rail is 244px and a name like "Cours élémentaire 2" already fills it; a
 * full kind label beside every row would push the names into ellipsis, which is
 * the one thing the tree exists to show.
 */
export const KIND_SHORT: Record<OrgUnitKind, string> = {
  COMPLEX: "CPX",
  ORG_DIVISION: "DIR",
  DEPARTMENT: "DEP",
  SCHOOL: "ÉCO",
  CYCLE: "CYC",
  FACULTY: "FAC",
  FILIERE: "FIL",
  PARCOURS: "PAR",
  NIVEAU: "NIV",
  CLASSE: "CLS",
};
