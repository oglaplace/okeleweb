import type * as api from "../../lib/api";

/**
 * The column sets, declared.
 *
 * A sheet is rows × a CHOICE of columns, and the choice is what the tabs at the
 * bottom switch. Declaring them as data rather than five hand-written tables is
 * the same bet the action registry makes and pays off the same way: adding a
 * column is one line, and every set gets the same alignment, formatting and
 * totals for free.
 */
export type CellType = "text" | "number" | "money" | "percent" | "date" | "grade" | "pill";

export interface SheetColumn {
  key: string;
  label: string;
  type?: CellType;
  /** Column width in ch units; numbers get a sensible default. */
  width?: number;
  /** Sum this column in the footer. Money and counts, never averages. */
  total?: boolean;
  /** Higher is worse — used to colour a balance or an absence count. */
  warnAbove?: number;
  hint?: string;
}

export interface SheetGroup {
  label: string;
  columns: SheetColumn[];
}

export interface SheetTab {
  id: string;
  label: string;
  /**
   * How many leading columns stay put while the rest scrolls sideways.
   *
   * Per tab, not global: a class sheet freezes matricule + nom + prénom, a
   * staff sheet has no matricule. Marks scroll fourteen columns to the right,
   * and a mark with no name beside it is a number nobody can act on.
   */
  frozen?: number;
  /** Flat columns, or groups when the header needs two rows (marks by période). */
  columns?: SheetColumn[];
  groups?: SheetGroup[];
  /** Shown under the tab strip when the set is empty for a structural reason. */
  empty?: string;
}

/** The two columns that identify a row, present on every tab. */
export const IDENTITY: SheetColumn[] = [
  { key: "matricule", label: "Matricule", width: 14 },
  { key: "lastName", label: "Nom", width: 18 },
  { key: "firstName", label: "Prénom", width: 16 },
];

export function studentTabs(sheet: api.StudentSheet): SheetTab[] {
  const tabs: SheetTab[] = [
    {
      id: "general",
      label: "Général",
      columns: [
        ...IDENTITY,
        { key: "gender", label: "Sexe", width: 7 },
        { key: "birthDate", label: "Naissance", type: "date", width: 12 },
        { key: "birthPlace", label: "Lieu", width: 16 },
        { key: "serie", label: "Série", width: 8 },
        { key: "isRepeating", label: "Redoublant", type: "pill", width: 12 },
        { key: "guardianName", label: "Tuteur", width: 20 },
        { key: "guardianRelationship", label: "Lien", width: 9 },
        { key: "guardianPhone", label: "Téléphone", width: 16 },
        { key: "guardianEmail", label: "Email", width: 22 },
      ],
    },
    {
      id: "finances",
      label: "Finances",
      columns: [
        ...IDENTITY,
        { key: "invoiceCount", label: "Factures", type: "number", width: 10 },
        { key: "billedXaf", label: "Facturé", type: "money", total: true },
        { key: "paidXaf", label: "Réglé", type: "money", total: true },
        {
          key: "balanceXaf",
          label: "Solde",
          type: "money",
          total: true,
          warnAbove: 1,
          hint: "Facturé moins réglé. Positif = impayé.",
        },
        { key: "lastPaymentOn", label: "Dernier règlement", type: "date", width: 16 },
      ],
    },
  ];

  /**
   * One group per période, each holding its subjects plus the official average
   * and rank. This is the tab the whole endpoint exists for: a conseil de classe
   * reads across a row and down a column, and no other screen lets it.
   */
  const gradeGroups: SheetGroup[] = sheet.periods.map((period) => ({
    label: period.label,
    columns: [
      ...sheet.subjects.map((subject) => ({
        key: `g:${period.id}:${subject.id}`,
        label: subject.code,
        type: "grade" as const,
        width: 7,
        hint: subject.name,
      })),
      { key: `g:${period.id}:avg`, label: "Moy.", type: "grade", width: 7 },
      { key: `g:${period.id}:rank`, label: "Rang", type: "number", width: 6 },
    ],
  }));

  tabs.push({
    id: "grades",
    label: "Notes",
    frozen: IDENTITY.length,
    groups: gradeGroups.length ? gradeGroups : undefined,
    columns: gradeGroups.length ? undefined : IDENTITY,
    empty: gradeGroups.length
      ? undefined
      : "Aucune période n'est ouverte pour cette année — il n'y a rien à noter.",
  });

  tabs.push({
    id: "attendance",
    label: "Assiduité",
    columns: [
      ...IDENTITY,
      { key: "sessions", label: "Séances", type: "number", total: true },
      { key: "present", label: "Présent", type: "number", total: true },
      { key: "absent", label: "Absent", type: "number", total: true, warnAbove: 1 },
      { key: "late", label: "Retards", type: "number", total: true, warnAbove: 1 },
      { key: "excused", label: "Excusé", type: "number", total: true },
      {
        key: "attendanceRate",
        label: "Assiduité",
        type: "percent",
        width: 11,
        hint: "Présences et retards sur séances pointées. Arriver en retard n'est pas être absent.",
      },
    ],
  });

  /**
   * The summary is not a sixth set of data — it is one column pulled from each
   * of the others. That is the whole point of it: the four numbers a director
   * looks at before deciding anything about a pupil.
   */
  const lastPeriod = sheet.periods[sheet.periods.length - 1];
  tabs.push({
    id: "summary",
    label: "Synthèse",
    columns: [
      ...IDENTITY,
      { key: "serie", label: "Série", width: 8 },
      ...(lastPeriod
        ? [
            {
              key: `g:${lastPeriod.id}:avg`,
              label: `Moy. ${lastPeriod.label}`,
              type: "grade" as const,
              width: 13,
            },
            { key: `g:${lastPeriod.id}:rank`, label: "Rang", type: "number" as const, width: 7 },
          ]
        : []),
      { key: "attendanceRate", label: "Assiduité", type: "percent", width: 11 },
      { key: "absent", label: "Absences", type: "number", total: true, warnAbove: 1 },
      { key: "balanceXaf", label: "Solde", type: "money", total: true, warnAbove: 1 },
      { key: "guardianPhone", label: "Tuteur", width: 16 },
    ],
  });

  return tabs;
}

/**
 * Flattens the grade grid onto the row, so every tab reads from one flat
 * object and the cell renderer never has to know about périodes.
 */
export function flattenStudentRow(row: api.StudentSheetRow): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...row };
  for (const [periodId, period] of Object.entries(row.grades)) {
    flat[`g:${periodId}:avg`] = period.average;
    flat[`g:${periodId}:rank`] = period.rank;
    for (const [subjectId, score] of Object.entries(period.bySubject)) {
      flat[`g:${periodId}:${subjectId}`] = score;
    }
  }
  return flat;
}

/**
 * What a structural unit holds, as a sheet of its own.
 *
 * So the tab strip means one thing everywhere: which sheet of this workbook.
 * A school has children AND staff, and hiding either behind the other was the
 * first version's mistake — a director opening a school got a staff list and no
 * way down the tree.
 */
export function childrenTab(): SheetTab {
  return {
    id: "children",
    label: "Contenu",
    frozen: 1,
    columns: [
      { key: "name", label: "Nom", width: 28 },
      { key: "kindLabel", label: "Type", width: 14 },
      { key: "code", label: "Code", width: 10 },
      { key: "capacity", label: "Capacité", type: "number", width: 10 },
      { key: "state", label: "État", width: 10 },
    ],
  };
}

export function staffTabs(): SheetTab[] {
  return [
    {
      id: "general",
      label: "Général",
      frozen: 2,
      columns: [
        { key: "lastName", label: "Nom", width: 18 },
        { key: "firstName", label: "Prénom", width: 16 },
        { key: "phone", label: "Téléphone", width: 16 },
        { key: "email", label: "Email", width: 24 },
        { key: "active", label: "Actif", type: "pill", width: 9 },
      ],
    },
    {
      id: "contract",
      label: "Contrat",
      frozen: 2,
      columns: [
        { key: "lastName", label: "Nom", width: 18 },
        { key: "firstName", label: "Prénom", width: 16 },
        { key: "type", label: "Type", width: 12 },
        {
          key: "baseAmountXaf",
          label: "Base",
          type: "money",
          total: true,
          hint: "Mensuel pour un permanent, horaire pour un vacataire.",
        },
        { key: "startsOn", label: "Début", type: "date", width: 12 },
        { key: "endsOn", label: "Fin", type: "date", width: 12 },
      ],
    },
    {
      id: "postings",
      label: "Affectations",
      frozen: 2,
      columns: [
        { key: "lastName", label: "Nom", width: 18 },
        { key: "firstName", label: "Prénom", width: 16 },
        { key: "postings", label: "Postes", type: "number", total: true, width: 9 },
        { key: "roles", label: "Fonctions", width: 24 },
        { key: "units", label: "Unités", width: 30 },
      ],
    },
  ];
}
