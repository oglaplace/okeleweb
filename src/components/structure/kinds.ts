import type { OrgUnitKind } from "../../lib/api";

/** The buyer's word for each kind. */
export const KIND_FR: Record<OrgUnitKind, string> = {
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
