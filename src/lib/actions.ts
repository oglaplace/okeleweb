import * as api from "./api";
import type { IconName } from "../components/ui/icons";

/**
 * Everything a school can do, declared once.
 *
 * THE PATTERN, generalised: almost every operation in this domain is "pick the
 * part of the tree it applies to, then fill in the rest". A devoir is created
 * for a classe; a coefficient is set for a niveau; a période belongs to a
 * school. So an action declares which OrgUnit kinds it targets and which fields
 * it needs, and ONE page renders all of them — scope step, then form step.
 *
 * The alternative was thirty hand-written pages that would drift from each
 * other within a month. Adding an action here is a data change; the screen,
 * the scope picker, the validation and the busy overlay come for free.
 *
 * `scope: null` means the action is complex-wide — an academic year or a
 * subject belongs to the établissement, not to any unit in it, and forcing a
 * pointless picker in front of those would be ceremony.
 *
 * `route` means the action has a screen of its own, because it is not a form:
 * mark entry is a grid, the conseil de classe is a computation, the explorer is
 * a tree. Those keep their own pages and the registry just points at them.
 *
 * `status: "planned"` is honest bookkeeping: the endpoint does not exist yet, so
 * the rail shows the action greyed with the reason rather than a form whose
 * submit can only fail.
 */

export type ActionGroup =
  | "structure"
  | "scolarite"
  | "personnel"
  | "programme"
  | "evaluation"
  | "finances";

export const GROUPS: { id: ActionGroup; label: string; icon: IconName }[] = [
  { id: "structure", label: "Établissement", icon: "school" },
  { id: "scolarite", label: "Scolarité", icon: "userPlus" },
  { id: "personnel", label: "Personnel", icon: "users" },
  { id: "programme", label: "Programme", icon: "book" },
  { id: "evaluation", label: "Notes & bulletins", icon: "clipboard" },
  { id: "finances", label: "Finances", icon: "wallet" },
];

/** Where a select's options come from. Resolved once, when the form opens. */
export type OptionSource =
  | "years"
  | "series"
  | "subjects"
  | "assessmentTypes"
  | "feeTypes"
  /** Depends on the chosen scope node. */
  | "periodsOfScope"
  | "offeringsOfScope";

export interface ActionField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  hint?: string;
  source?: OptionSource;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export interface ActionSpec {
  id: string;
  label: string;
  group: ActionGroup;
  icon: IconName;
  summary: string;
  /** OrgUnit kinds the action applies to. Null = complex-wide, no scope step. */
  scope: api.OrgUnitKind[] | null;
  fields?: ActionField[];
  /** A screen of its own, for actions that are not forms. */
  route?: string;
  /** Declared but not yet wired; the reason is shown in place of the action. */
  planned?: string;
  submit?: (scopeId: string | null, v: Record<string, string>) => Promise<unknown>;
}

const num = (v: string | undefined) => (v ? Number(v) : undefined);

export const ACTIONS: ActionSpec[] = [
  // ── établissement ─────────────────────────────────────────────────────────
  {
    id: "explorer",
    label: "Structure",
    group: "structure",
    icon: "tree",
    summary: "Explorer, créer et gérer les unités de l'établissement.",
    scope: null,
    route: "structure",
  },
  {
    id: "create-year",
    label: "Nouvelle année scolaire",
    group: "structure",
    icon: "calendar",
    summary: "Ouvrir l'année suivante. Tout s'y rattache : inscriptions, notes, bulletins.",
    scope: null,
    fields: [
      { key: "label", label: "Libellé", type: "text", required: true, hint: "2026-2027" },
      { key: "startsOn", label: "Début", type: "date", required: true },
      { key: "endsOn", label: "Fin", type: "date", required: true },
      { key: "isCurrent", label: "Année en cours", type: "checkbox", default: true },
    ],
    submit: (_s, v) =>
      api.academics.createYear({
        label: v.label!,
        startsOn: v.startsOn!,
        endsOn: v.endsOn!,
        isCurrent: v.isCurrent === "true",
      }),
  },
  {
    id: "create-period",
    label: "Créer une période",
    group: "structure",
    icon: "clock",
    summary: "Trimestre ou semestre, sur une école. Un bulletin est un document de période.",
    scope: ["COMPLEX", "SCHOOL", "CYCLE", "FACULTY"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      {
        key: "kind", label: "Type", type: "select", required: true, default: "TRIMESTRE",
        options: [
          { value: "TRIMESTRE", label: "Trimestre" },
          { value: "SEMESTRE", label: "Semestre" },
          { value: "ANNEE", label: "Année" },
        ],
      },
      { key: "label", label: "Libellé", type: "text", required: true, hint: "Trimestre 1" },
      { key: "sequence", label: "Rang", type: "number", required: true, default: 1 },
      { key: "startsOn", label: "Début", type: "date", required: true },
      { key: "endsOn", label: "Fin", type: "date", required: true },
    ],
    submit: (scopeId, v) =>
      api.academics.createPeriod({
        orgUnitId: scopeId!,
        academicYearId: v.academicYearId!,
        kind: v.kind as "TRIMESTRE" | "SEMESTRE" | "ANNEE",
        label: v.label!,
        sequence: num(v.sequence)!,
        startsOn: v.startsOn!,
        endsOn: v.endsOn!,
      }),
  },
  {
    id: "lock-period",
    label: "Verrouiller une période",
    group: "structure",
    icon: "lock",
    summary: "Après le conseil : les notes de la période deviennent non modifiables.",
    scope: ["COMPLEX", "SCHOOL", "CYCLE", "FACULTY"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "periodId", label: "Période", type: "select", source: "periodsOfScope", required: true },
    ],
    submit: (_s, v) => api.academics.lockPeriod(v.periodId!),
  },

  // ── scolarité ─────────────────────────────────────────────────────────────
  {
    id: "enroll",
    label: "Inscrire un élève",
    group: "scolarite",
    icon: "userPlus",
    summary: "Fiche élève, matricule et inscription, en une fois.",
    scope: null,
    route: "enroll",
  },
  {
    id: "import-students",
    label: "Importer des élèves",
    group: "scolarite",
    icon: "upload",
    summary: "Depuis un fichier CSV exporté d'Excel. Vérifié avant enregistrement.",
    scope: null,
    route: "import",
  },
  {
    id: "roster",
    label: "Voir une classe",
    group: "scolarite",
    icon: "users",
    summary: "Effectif, notes saisies, conseil de classe et bulletins.",
    scope: ["CLASSE"],
    route: "classe",
  },

  // ── personnel ─────────────────────────────────────────────────────────────
  {
    id: "add-staff",
    label: "Ajouter un personnel",
    group: "personnel",
    icon: "userPlus",
    summary: "Enseignant, censeur, économe — avec son contrat et sa première affectation.",
    scope: null,
    route: "staff",
  },
  {
    id: "import-staff",
    label: "Importer du personnel",
    group: "personnel",
    icon: "upload",
    summary: "Le même fichier CSV que pour les élèves, avec les colonnes du personnel.",
    scope: null,
    route: "import",
  },

  // ── programme ─────────────────────────────────────────────────────────────
  {
    id: "create-subject",
    label: "Nouvelle matière",
    group: "programme",
    icon: "book",
    summary: "Le catalogue des matières est commun à tout l'établissement.",
    scope: null,
    fields: [
      { key: "code", label: "Code", type: "text", required: true, hint: "MATH" },
      { key: "name", label: "Nom", type: "text", required: true, hint: "Mathématiques" },
    ],
    submit: (_s, v) => api.academics.createSubject({ code: v.code!, name: v.name! }),
  },
  {
    id: "create-offering",
    label: "Programmer une matière",
    group: "programme",
    icon: "layers",
    summary: "Rattacher une matière à un niveau pour l'année — la base de la saisie des notes.",
    scope: ["NIVEAU"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "subjectId", label: "Matière", type: "select", source: "subjects", required: true },
      { key: "weeklyHours", label: "Heures / semaine", type: "number" },
    ],
    submit: (scopeId, v) =>
      api.academics.createOffering({
        niveauId: scopeId!,
        academicYearId: v.academicYearId!,
        subjectId: v.subjectId!,
        ...(num(v.weeklyHours) !== undefined ? { weeklyHours: num(v.weeklyHours)! } : {}),
      }),
  },
  {
    id: "set-coefficient",
    label: "Définir un coefficient",
    group: "programme",
    icon: "settings",
    summary: "Par niveau et par série — c'est ce qui différencie une 1ère C d'une 1ère A.",
    scope: ["NIVEAU"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "subjectId", label: "Matière", type: "select", source: "subjects", required: true },
      { key: "serieId", label: "Série", type: "select", source: "series", hint: "Vide = toutes les séries" },
      { key: "value", label: "Coefficient", type: "number", required: true, default: 1 },
    ],
    submit: (scopeId, v) =>
      api.academics.setCoefficient({
        niveauId: scopeId!,
        academicYearId: v.academicYearId!,
        subjectId: v.subjectId!,
        serieId: v.serieId || null,
        value: num(v.value)!,
      }),
  },
  {
    id: "create-assessment-type",
    label: "Type d'évaluation",
    group: "programme",
    icon: "fileText",
    summary: "Interro, devoir, composition — et leur poids par défaut.",
    scope: null,
    fields: [
      { key: "code", label: "Code", type: "text", required: true, hint: "COMPO" },
      { key: "name", label: "Nom", type: "text", required: true, hint: "Composition" },
      { key: "defaultWeight", label: "Poids par défaut", type: "number", default: 1 },
    ],
    submit: (_s, v) =>
      api.academics.createAssessmentType({
        code: v.code!,
        name: v.name!,
        ...(num(v.defaultWeight) !== undefined ? { defaultWeight: num(v.defaultWeight)! } : {}),
      }),
  },
  {
    id: "timetable",
    label: "Emploi du temps",
    group: "programme",
    icon: "calendar",
    summary: "Séances hebdomadaires par classe et par enseignant.",
    scope: ["CLASSE"],
    // Honest: the model has TeachingSession, the API has no route for it.
    planned: "Le modèle existe (TeachingSession) mais l'API ne l'expose pas encore.",
  },

  // ── notes & bulletins ─────────────────────────────────────────────────────
  {
    id: "create-assessment",
    label: "Créer un devoir",
    group: "evaluation",
    icon: "fileText",
    summary: "L'épreuve dans laquelle les notes seront saisies.",
    scope: ["CLASSE"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "periodId", label: "Période", type: "select", source: "periodsOfScope", required: true },
      { key: "courseOfferingId", label: "Matière", type: "select", source: "offeringsOfScope", required: true },
      { key: "assessmentTypeId", label: "Type", type: "select", source: "assessmentTypes", required: true },
      { key: "title", label: "Intitulé", type: "text", hint: "Devoir n°1" },
      { key: "maxScore", label: "Barème", type: "number", default: 20 },
      { key: "givenOn", label: "Date", type: "date" },
    ],
    submit: (scopeId, v) =>
      api.grading.createAssessment({
        classeId: scopeId,
        periodId: v.periodId!,
        courseOfferingId: v.courseOfferingId!,
        assessmentTypeId: v.assessmentTypeId!,
        ...(v.title ? { title: v.title } : {}),
        ...(num(v.maxScore) !== undefined ? { maxScore: num(v.maxScore)! } : {}),
      }),
  },
  {
    id: "enter-marks",
    label: "Saisir les notes",
    group: "evaluation",
    icon: "clipboard",
    summary: "La grille de saisie, une classe et une épreuve à la fois.",
    scope: ["CLASSE"],
    route: "marks",
  },
  {
    id: "council",
    label: "Conseil de classe",
    group: "evaluation",
    icon: "check",
    summary: "Moyennes, rangs et mentions calculés — avant de rien figer.",
    scope: ["CLASSE"],
    route: "classe",
  },
  {
    id: "issue-bulletins",
    label: "Générer les bulletins",
    group: "evaluation",
    icon: "fileText",
    summary: "Fige les bulletins de la période. Une correction se fait par réédition.",
    scope: ["CLASSE"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "periodId", label: "Période", type: "select", source: "periodsOfScope", required: true },
    ],
    submit: (scopeId, v) => api.grading.issue(scopeId!, v.periodId!),
  },
  {
    id: "print-bulletins",
    label: "Imprimer les bulletins",
    group: "evaluation",
    icon: "fileText",
    summary: "Un élève, une feuille — depuis le navigateur, rien à installer.",
    scope: ["CLASSE"],
    route: "bulletins",
  },

  // ── finances ──────────────────────────────────────────────────────────────
  {
    id: "seed-ledger",
    label: "Initialiser le plan comptable",
    group: "finances",
    icon: "coins",
    summary: "Le plan SYSCOHADA, une fois par établissement.",
    scope: null,
    fields: [],
    submit: () => api.finance.seedLedger(),
  },
  {
    id: "create-fee-type",
    label: "Type de frais",
    group: "finances",
    icon: "receipt",
    summary: "Scolarité, inscription, cantine — et leur périodicité.",
    scope: null,
    fields: [
      { key: "code", label: "Code", type: "text", required: true, hint: "SCOL" },
      { key: "name", label: "Nom", type: "text", required: true, hint: "Scolarité" },
      {
        key: "recurrence", label: "Périodicité", type: "select", default: "PER_PERIOD",
        options: [
          { value: "ONCE", label: "Une seule fois" },
          { value: "PER_PERIOD", label: "Par période" },
          { value: "MONTHLY", label: "Mensuelle" },
        ],
      },
    ],
    submit: (_s, v) =>
      api.finance.createFeeType({
        code: v.code!,
        name: v.name!,
        recurrence: v.recurrence as "ONCE" | "PER_PERIOD" | "MONTHLY",
      }),
  },
  {
    id: "fee-schedule",
    label: "Grille tarifaire",
    group: "finances",
    icon: "wallet",
    summary: "Ce que coûte une année, par niveau et par série.",
    scope: ["COMPLEX", "SCHOOL", "CYCLE", "NIVEAU"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      { key: "name", label: "Nom de la grille", type: "text", required: true, hint: "Scolarité 6e" },
      { key: "feeTypeId", label: "Type de frais", type: "select", source: "feeTypes", required: true },
      { key: "amountXaf", label: "Montant (XAF)", type: "number", required: true },
      { key: "installments", label: "Tranches", type: "number", default: 3 },
    ],
    submit: (scopeId, v) =>
      api.finance.createFeeSchedule({
        orgUnitId: scopeId!,
        academicYearId: v.academicYearId!,
        name: v.name!,
        items: [
          {
            feeTypeId: v.feeTypeId!,
            amountXaf: num(v.amountXaf)!,
            ...(num(v.installments) !== undefined ? { installments: num(v.installments)! } : {}),
          },
        ],
      }),
  },
  {
    id: "outstanding",
    label: "Impayés",
    group: "finances",
    icon: "coins",
    summary: "Qui doit quoi, filtré par ce que vous avez le droit de voir.",
    scope: null,
    planned: "L'endpoint existe ; l'écran de consultation reste à construire.",
  },
  {
    id: "record-payment",
    label: "Enregistrer un paiement",
    group: "finances",
    icon: "receipt",
    summary: "Espèces, MoMo, Airtel Money, virement — avec reçu.",
    scope: null,
    planned: "Nécessite un sélecteur de facture, qui dépend de l'écran Impayés.",
  },
];

export const byId = (id: string) => ACTIONS.find((a) => a.id === id);
export const inGroup = (group: ActionGroup) => ACTIONS.filter((a) => a.group === group);
