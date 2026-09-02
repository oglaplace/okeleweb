import type * as api from "../../lib/api";
// A value import, not a type one: PAYMENT_METHOD_FR is a runtime table and the
// finance tab reads it to turn MTN_MOMO into something a parent recognises.
import { PAYMENT_METHOD_FR } from "../../lib/api";

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
  /**
   * The cell is typed into, not read.
   *
   * Marks are entered IN the sheet, the way a timetable is drawn in the grid —
   * the alternative was a separate screen, four dropdowns deep, that a teacher
   * reaches once per column. `max` is the barème, which is also what the
   * header shows, so the number typed is the number on the paper.
   */
  edit?: { assessmentId: string; max: number };
  /**
   * A button in the column's own header — for what belongs to the COLUMN
   * rather than to any row: editing the evaluation it stands for, or removing
   * it. See DataSheet, which renders it beside the label.
   */
  headerButton?: { key: string; label: string; hint?: string };
  /**
   * Turns the cell into a control.
   *
   * `when: "empty"` offers it only where there is nothing — a column of
   * "Définir" buttons beside filled values is noise. `when: "always"` makes
   * every cell a link, which is what a subject name is.
   */
  action?: { label?: string; when: "empty" | "always" };
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
  /** Full name of what the group is about, for the header's tooltip. */
  title?: string;
  /**
   * Buttons in the group's own header.
   *
   * Where an action belongs to a COLUMN BLOCK rather than to a row: adding an
   * evaluation to Mathématiques is one act for the whole class, and offering it
   * on every pupil's cell says the opposite — forty identical buttons, each
   * looking like it would do something to that pupil.
   */
  action?: { key: string; label: string; hint?: string };
  /**
   * A second, quieter one — a fact about the group that can be changed.
   *
   * The coefficient is the case it exists for: it is defined on the niveau, it
   * is the number every mark under this header will be multiplied by, and it
   * starts empty on every school. Sending a titulaire to another screen to fill
   * it in is how it stays empty until the conseil refuses to compute.
   */
  badge?: { key: string; label: string; hint?: string; missing?: boolean };
}

export interface SheetTab {
  id: string;
  label: string;
  /** Identity columns prepended to a grouped tab. Defaults to a pupil's. */
  identity?: SheetColumn[];
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

export function studentTabs(
  sheet: api.StudentSheet,
  /** Which période the Notes tab is showing, and whether marks may be typed. */
  focus: { periodId: string | null; editable?: boolean } = { periodId: null },
): SheetTab[] {
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
    // The Finances tab is built from the ledger, not from this sheet — see
    // financeTab() below. It needs the modalité de paiement, which the student
    // sheet knows nothing about.
  ];

  /**
   * ONE PÉRIODE at a time, grouped by subject.
   *
   * The first version put every subject of every période side by side with one
   * column each — which says a subject has one evaluation, and almost none
   * does: a trimestre is an interro, a devoir and a composition, and the
   * conseil argues about the composition. Showing all three for six subjects
   * across three trimestres is fifty-four columns, so the période becomes a
   * selector and the subject becomes the group.
   *
   * Each subject group holds its evaluations and then the subject average, so a
   * row reads left to right the way a teacher reads their own mark book.
   */
  const period =
    sheet.periods.find((p) => p.id === focus.periodId) ?? sheet.periods[0];

  const gradeGroups: SheetGroup[] = period
    ? sheet.subjects.map((subject) => {
        const evaluations = period.assessments.filter((a) => a.subjectId === subject.id);
        return {
          label: subject.code,
          title: `${subject.name} — ${period.label}`,
          /*
           * The ＋ lives HERE, in the subject's own header.
           *
           * It was a cell action on the average column, which the renderer
           * draws as the value itself when it is always-on: a column of
           * clickable em-dashes, one per pupil, that nothing on screen said
           * were buttons — and that appear to be about the pupil in that row
           * when an evaluation belongs to the whole class. One button, in the
           * one place that names the subject, is the honest shape.
           */
          badge: {
            key: `coefficient:${subject.id}`,
            /*
             * Both states start with "coef." so the eye reads the same slot,
             * and the missing one stays short: this line sits under a group
             * header whose width is the sum of its columns, and a subject with
             * one evaluation is narrow enough that a long sentence here would
             * stretch the whole block sideways.
             */
            label:
              subject.coefficient === null
                ? "coef. à définir"
                : `coef. ${subject.coefficient}`,
            missing: subject.coefficient === null,
            hint:
              subject.coefficient === null
                ? `Aucun coefficient pour ${subject.name} — le conseil ne peut pas pondérer sans lui. Cliquer pour le définir.`
                : `Coefficient ${subject.coefficient} — cliquer pour le modifier.`,
          },
          action: {
            key: `assessment:${subject.id}`,
            label: evaluations.length ? "＋" : "＋ évaluation",
            hint: evaluations.length
              ? `Ajouter une évaluation en ${subject.name} (${evaluations.length} déjà)`
              : `Aucune évaluation en ${subject.name} — en créer une`,
          },
          columns: [
            ...evaluations.map((a) => ({
              key: `e:${a.id}`,
              /*
               * The barème is IN the label, because the cell is now typed into.
               * A column headed "Devoir" over a paper marked out of 10 invites
               * a 16, and the cell has no way to argue.
               */
              label: a.max === 20 ? a.label : `${a.label} /${a.max}`,
              type: "grade" as const,
              width: Math.max(8, Math.min(14, a.label.length + 3)),
              hint:
                `${subject.name} — ${a.label}, barème ${a.max}` +
                (a.published
                  ? " · publiée"
                  : a.submitted
                    ? " · remise, en attente du conseil"
                    : " · saisie ouverte"),
              // Typeable only while it is the teacher's working copy.
              ...(focus.editable && !a.submitted && !a.published
                ? { edit: { assessmentId: a.id, max: a.max } }
                : {}),
              headerButton: {
                key: `assessment:${a.id}`,
                // Three dots, back by request. The dialog it opens is a set of
                // choices — modifier, remettre, supprimer — so the ellipsis is
                // the more honest promise of the two anyway.
                label: a.published ? "🔒" : a.submitted ? "✓" : "⋯",
                hint: a.published
                  ? "Publiée — figée par le conseil"
                  : a.submitted
                    ? "Remise — cliquer pour rouvrir ou consulter"
                    : "Modifier, remettre ou supprimer cette évaluation",
              },
            })),
            {
              key: `g:${period.id}:${subject.id}`,
              label: "Moy.",
              type: "grade" as const,
              width: 7,
              hint: evaluations.length
                ? `Moyenne ${subject.name} sur ${period.label}`
                : `Aucune évaluation en ${subject.name} sur ${period.label}`,
            },
          ],
        };
      })
    : [];

  /**
   * THE MOYENNE GÉNÉRALE, at the end of the row where a bulletin puts it.
   *
   * Its own group, after every subject, because it is not one more subject: it
   * is what all of them come to. Computed by the API from the same engine, the
   * same coefficients and the same barème the conseil will use — so this column
   * in November is the number on the bulletin in January.
   *
   * `complete` is shown rather than used to hide the value. "How are they doing
   * so far" is the question being asked all term, and a mean over part of the
   * programme answers it honestly as long as it says so.
   */
  if (period && gradeGroups.length) {
    gradeGroups.push({
      label: "Bilan",
      title: `Moyenne générale — ${period.label}`,
      columns: [
        {
          key: `g:${period.id}:live`,
          label: "Moy. gén.",
          type: "grade",
          width: 10,
          hint:
            "Moyenne pondérée par les coefficients, sur les notes déjà saisies. " +
            "C'est le moteur du conseil de classe qui la produit.",
        },
        {
          key: `g:${period.id}:mention`,
          label: "Mention",
          width: 12,
          hint: "Selon les bandes du système de notation en vigueur.",
        },
        {
          key: `g:${period.id}:complete`,
          label: "Complet",
          type: "pill",
          width: 9,
          hint:
            "Toutes les matières ont une note. Sinon la moyenne ne porte que sur " +
            "la partie déjà évaluée.",
        },
      ],
    });
  }

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

  /**
   * From the collège up, an absence belongs to a lesson, not to a day.
   *
   * Below it the same teacher takes every hour, so per-subject columns would be
   * one number repeated six times — see the API, which decides this from
   * `singleTitulaire` on the niveau rather than from a list of school codes.
   */
  if (sheet.attendanceMode === "BY_SUBJECT" && sheet.subjects.length) {
    tabs.push({
      id: "attendance",
      label: "Assiduité",
      frozen: IDENTITY.length,
      groups: [
        {
          label: "Total",
          columns: [
            { key: "sessions", label: "Séances", type: "number", width: 8 },
            { key: "absent", label: "Abs.", type: "number", width: 6, total: true, warnAbove: 1 },
            { key: "late", label: "Ret.", type: "number", width: 6, total: true },
            { key: "attendanceRate", label: "Taux", type: "percent", width: 9 },
          ],
        },
        {
          label: "Absences par matière",
          columns: sheet.subjects.map((subject) => ({
            key: `a:${subject.id}`,
            label: subject.code,
            type: "number" as const,
            width: 6,
            warnAbove: 1,
            hint: subject.name,
          })),
        },
      ],
    });
  } else {
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
  }

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
  for (const [subjectId, absences] of Object.entries(row.absenceBySubject ?? {})) {
    flat[`a:${subjectId}`] = absences;
  }
  for (const [periodId, period] of Object.entries(row.grades)) {
    flat[`g:${periodId}:avg`] = period.average;
    flat[`g:${periodId}:rank`] = period.rank;
    flat[`g:${periodId}:live`] = period.live;
    flat[`g:${periodId}:mention`] = period.liveMention;
    flat[`g:${periodId}:complete`] = period.complete;
    for (const [subjectId, score] of Object.entries(period.bySubject)) {
      flat[`g:${periodId}:${subjectId}`] = score;
    }
    // One key per evaluation, so a column can name a devoir rather than a
    // subject — see studentTabs.
    for (const [assessmentId, score] of Object.entries(period.byAssessment ?? {})) {
      flat[`e:${assessmentId}`] = score;
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

/** French for the four words the état column can hold. */
export const LEDGER_STATE_FR: Record<string, string> = {
  CLEAR: "À jour",
  PARTIAL: "En cours",
  LATE: "En retard",
  NONE: "Non facturé",
};

const dueLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

/**
 * THE FINANCE TAB, built from the modalité de paiement rather than from a
 * fixed list of columns.
 *
 * A school that has declared "payable au trimestre" gets three tranche columns
 * with the dates it announced; one on ANNUEL gets a single "Année". The point
 * is that the sheet an économe reads is the same document the parents were
 * handed at la rentrée — a fixed Facturé/Réglé/Solde triple is a bank
 * statement, and nobody chases a debt with a bank statement. They chase it with
 * "la deuxième tranche n'est pas payée".
 *
 * Each tranche column shows what is STILL OWED on it, not what was paid: zero
 * is the good state, the column warns above zero, and the eye goes straight to
 * the tranches with something in them.
 */
export function financeTab(ledger: api.ClasseLedger): SheetTab {
  const tranches: SheetGroup[] = ledger.tranches.map((t) => ({
    label: t.label,
    title: `Échéance du ${new Date(t.dueOn).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric",
    })}`,
    /*
     * ONE COLUMN per tranche, and it is what is STILL OWED.
     *
     * The first version had two — "Dû" and "Reste" — and the Dû column was the
     * same figure sixty times over, because a class shares a grille tarifaire.
     * It doubled the width of the sheet to repeat a constant, and pushed the
     * column that actually varies off the right-hand edge. The amount called
     * per tranche is on the pupil's own page, where the échéancier is laid out
     * in full and where it differs from the next pupil's if a discount applies.
     */
    columns: [
      {
        key: `tr_${t.number}_left`,
        label: `Reste au ${dueLabel(t.dueOn)}`,
        type: "money",
        width: 15,
        warnAbove: 1,
        total: true,
        hint: "Ce qu'il manque sur cette tranche. Zéro = tranche soldée.",
      },
    ],
  }));

  return {
    id: "finances",
    label: "Finances",
    frozen: 3,
    identity: IDENTITY,
    ...(ledger.policy
      ? {}
      : { empty: "Aucune modalité de paiement définie — les tranches ne peuvent pas être calculées." }),
    groups: [
      {
        label: "Situation",
        columns: [
          // NOT ...IDENTITY: a grouped tab prepends `identity` itself, and
          // putting them here too printed matricule/nom/prénom twice — once
          // frozen and once scrolling beside it.
          // Plain text, not `pill`: that type renders a boolean as Oui/Non,
          // which turned "En retard" into "Oui".
          { key: "stateLabel", label: "État", width: 12 },
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
        ],
      },
      ...tranches,
      {
        label: "Derniers règlements",
        columns: [
          { key: "lastPaymentOn", label: "Le", type: "date", width: 13 },
          { key: "lastPaymentXaf", label: "Montant", type: "money", width: 13 },
          { key: "lastPaymentLabel", label: "Moyen", width: 13 },
          {
            key: "paymentCount",
            label: "Règlements",
            type: "number",
            width: 12,
            hint: "Ouvrez la fiche de l'élève pour l'historique et les reçus.",
          },
        ],
      },
    ],
  };
}

/** One ledger row flattened into the cells financeTab() asks for. */
export function flattenLedgerRow(row: api.ClasseLedger["rows"][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    studentId: row.studentId,
    matricule: row.matricule,
    lastName: row.lastName,
    firstName: row.firstName,
    stateLabel: LEDGER_STATE_FR[row.state] ?? row.state,
    billedXaf: row.billedXaf,
    paidXaf: row.paidXaf,
    balanceXaf: row.balanceXaf,
    paymentCount: row.paymentCount,
    // The sheet's `date` cell formats YYYY-MM-DD by reversing on the dash; an
    // ISO timestamp fed to it comes out as "04T00:00:00.000Z/11/2026".
    lastPaymentOn: row.lastPaymentOn?.slice(0, 10) ?? null,
    lastPaymentXaf: row.lastPaymentXaf,
    lastPaymentLabel: row.lastPaymentMethod
      ? PAYMENT_METHOD_FR[row.lastPaymentMethod as api.PaymentMethod] ?? row.lastPaymentMethod
      : null,
  };
  for (const t of row.byTranche) out[`tr_${t.number}_left`] = t.balanceXaf;
  return out;
}

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

/** The identity columns of a programme row, for the grouped coefficient tab. */
export const SUBJECT_IDENTITY: SheetColumn[] = [
  { key: "code", label: "Code", width: 8 },
  { key: "name", label: "Matière", width: 30 },
];

/**
 * A NIVEAU as its programme.
 *
 * The level is where the curriculum lives — offerings and coefficients both key
 * on it, never on the classe — so this is the one screen where "what is taught
 * in Sixième, how many hours, at what weight" is a list rather than an
 * inference across three tables. `slots` and `assessments` are the two columns
 * that say whether a subject is actually being TAUGHT or merely declared.
 */
export function niveauTabs(sheet: {
  series: { id: string; code: string; name: string }[];
  rows?: { assessments: number }[];
}): SheetTab[] {
  /*
   * "Devoir" was too narrow a word for what the column counts.
   *
   * A devoir is one KIND of evaluation — a trimestre is an interro, a devoir
   * and a composition, and the column totals all three. Pluralised from the
   * total for the same reason a count of one should not read "1 Évaluations".
   */
  const evaluations = (sheet.rows ?? []).reduce((sum, r) => sum + (r.assessments ?? 0), 0);
  const tabs: SheetTab[] = [
    {
      id: "programme",
      label: "Programme",
      frozen: 2,
      columns: [
        { key: "code", label: "Code", width: 8 },
        // The subject name opens its own sheet: one subject, every période.
        { key: "name", label: "Matière", width: 30, action: { when: "always" } },
        { key: "weeklyHours", label: "H/sem.", type: "number", width: 8 },
        {
          key: "coefficient",
          label: "Coefficient",
          type: "number",
          width: 13,
          /**
           * Blank is the normal state here and the blocking one: the scaffold
           * deliberately never guesses a coefficient, so this column starts
           * empty on every school. An empty cell that offers to fill itself is
           * the difference between a report and a tool.
           */
          action: { label: "Définir", when: "empty" },
          hint: "Toutes séries confondues. Vide = à définir ; le conseil ne peut pas calculer sans lui.",
        },
        {
          key: "slots",
          label: "Créneaux",
          type: "number",
          width: 10,
          total: true,
          hint: "Nombre d'heures placées à l'emploi du temps, toutes classes du niveau.",
        },
        {
          key: "assessments",
          label: evaluations === 1 ? "Évaluation" : "Évaluations",
          type: "number",
          width: 12,
          total: true,
          hint: "Interros, devoirs et compositions créés dans cette matière, toutes périodes.",
        },
      ],
    },
  ];

  // Coefficients differ by série — that is the whole reason the table exists —
  // so they get their own tab only when the school actually has séries.
  if (sheet.series.length) {
    tabs.push({
      id: "coefficients",
      label: "Coefficients",
      frozen: 2,
      identity: SUBJECT_IDENTITY,
      groups: [
        {
          label: "Par série",
          columns: [
            { key: "coefficient", label: "Toutes", type: "number", width: 9 },
            ...sheet.series.map((serie) => ({
              key: `coef:${serie.id}`,
              label: serie.code,
              type: "number" as const,
              width: 8,
              hint: serie.name,
            })),
          ],
        },
      ],
    });
  }

  return tabs;
}

/**
 * One subject across the year: assessments grouped by période.
 *
 * Built from the sheet rather than declared, because the columns ARE the
 * devoirs the teacher set — a fixed list could not know them.
 */
export function subjectTabs(sheet: {
  periods: { id: string; label: string; assessments: { id: string; label: string; max: number }[] }[];
}): SheetTab[] {
  const identity: SheetColumn[] = [
    { key: "matricule", label: "Matricule", width: 14 },
    { key: "lastName", label: "Nom", width: 18 },
    { key: "firstName", label: "Prénom", width: 16 },
    { key: "classe", label: "Classe", width: 9 },
  ];

  const groups: SheetGroup[] = sheet.periods.map((period) => ({
    label: period.label,
    columns: [
      ...period.assessments.map((a) => ({
        key: `m:${a.id}`,
        label: a.label,
        type: "grade" as const,
        width: 8,
        hint: `${a.label} — barème ${a.max}, ramené sur 20`,
      })),
      { key: `p:${period.id}:avg`, label: "Moy.", type: "grade" as const, width: 7 },
    ],
  }));

  return [
    {
      id: "marks",
      label: "Notes",
      identity,
      frozen: identity.length,
      ...(groups.length ? { groups } : { columns: identity }),
      ...(groups.length
        ? {}
        : { empty: "Aucune période ouverte pour cette année — il n'y a rien à noter." }),
    },
  ];
}

/** A CYCLE or SCHOOL as its calendar: the périodes the year is cut into. */
export function periodTab(): SheetTab {
  return {
    id: "periods",
    label: "Périodes",
    frozen: 2,
    columns: [
      { key: "sequence", label: "Rang", type: "number", width: 6 },
      { key: "label", label: "Période", width: 20 },
      { key: "kind", label: "Type", width: 12 },
      { key: "startsOn", label: "Début", type: "date", width: 12 },
      { key: "endsOn", label: "Fin", type: "date", width: 12 },
      {
        key: "state",
        label: "État",
        width: 11,
        hint: "Une période terminée mais non verrouillée laisse ses notes modifiables.",
      },
      { key: "locked", label: "Verrouillée", type: "pill", width: 12 },
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
