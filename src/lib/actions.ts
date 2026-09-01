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
  /**
   * `units` is a multi-select over the org tree.
   *
   * It exists because an academic year now names the cycles it covers, and
   * that is a list rather than a choice — the one shape the declarative form
   * could not express. The value is a comma-joined list of ids, so the field
   * stays a string like every other and `submit` splits it.
   */
  type: "text" | "number" | "date" | "select" | "checkbox" | "units";
  /** For `units`: which kinds may be picked. */
  kinds?: api.OrgUnitKind[];
  required?: boolean;
  hint?: string;
  source?: OptionSource;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  /**
   * Shown only when another field has one of these values.
   *
   * A form that offers everything at once is a form that asks a school to
   * decide things it did not come here to decide: picking "Secondaire" and
   * then being shown a rounding stage, a resit threshold and a note
   * éliminatoire suggests all three are part of the choice, when the whole
   * point of a template is that they are already answered.
   *
   * Only the branch that needs them shows them.
   */
  when?: { field: string; is: string[] };
}

export interface ActionSpec {
  id: string;
  label: string;
  group: ActionGroup;
  icon: IconName;
  summary: string;
  /** OrgUnit kinds the action applies to. Null = complex-wide, no scope step. */
  scope: api.OrgUnitKind[] | null;
  /**
   * The scope narrows the action but is not required.
   *
   * For a row that CARRIES its scope as a nullable column: an assessment type
   * pinned to a cycle is that cycle's, and one pinned nowhere is the complex's.
   * Both are legitimate, so the form must not insist on a unit — which is what
   * `scope: [...]` alone would do.
   */
  scopeOptional?: boolean;
  fields?: ActionField[];
  /** A screen of its own, for actions that are not forms. */
  route?: string;
  /**
   * Opens as a dialog over the current view when the node is already known.
   *
   * Named rather than boolean because the dialog needs to know WHICH form to
   * mount — these are the actions rich enough to have their own component
   * rather than a list of declared fields. The route stays: reached from the
   * rail, with nothing selected, the screen is still the right answer.
   */
  inline?: "enroll";
  /** Declared but not yet wired; the reason is shown in place of the action. */
  planned?: string;
  /**
   * Which face of the destination to open on.
   *
   * A node page is several sheets of one workbook, so "emploi du temps" is not
   * a different screen — it is the same screen opened on a different tab.
   */
  tab?: string;
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
      {
        key: "orgUnitIds",
        label: "Cycles et écoles concernés",
        type: "units",
        kinds: ["SCHOOL", "CYCLE", "FACULTY"],
        required: true,
        hint: "Un complexe n'est pas une école : un lycée peut ouvrir son année quand le supérieur suit un autre calendrier.",
      },
      { key: "isCurrent", label: "Année en cours", type: "checkbox", default: true },
    ],
    submit: (_s, v) =>
      api.academics.createYear({
        label: v.label!,
        startsOn: v.startsOn!,
        endsOn: v.endsOn!,
        isCurrent: v.isCurrent === "true",
        orgUnitIds: (v.orgUnitIds ?? "").split(",").filter(Boolean),
      }),
  },
  {
    id: "payment-policy",
    label: "Modalité de paiement",
    group: "finances",
    icon: "wallet",
    summary:
      "Comment cette école attend d'être payée : annuel, semestriel, trimestriel ou mensuel.",
    // On the school, the cycle or the department — inherited downward, so a
    // complex that answers once does not repeat itself on every cycle.
    scope: ["SCHOOL", "CYCLE", "DEPARTMENT", "ORG_DIVISION", "FACULTY"],
    fields: [
      {
        key: "modality",
        label: "Modalité",
        type: "select",
        required: true,
        default: "TRIMESTRIEL",
        options: Object.entries(api.PAYMENT_MODALITY_FR).map(([value, label]) => ({
          value,
          label,
        })),
      },
      {
        key: "installments",
        label: "Échéances",
        type: "number",
        hint: "Laissez vide : le nombre découle de la modalité.",
      },
      {
        key: "dueDayOfMonth",
        label: "Jour d'échéance",
        type: "number",
        hint: "Jour du mois où une tranche est due, le cas échéant.",
      },
      { key: "graceDays", label: "Jours de grâce", type: "number", default: 0 },
    ],
    submit: (scopeId, v) =>
      api.academics.setPaymentPolicy({
        orgUnitId: scopeId!,
        modality: v.modality as api.PaymentModality,
        ...(num(v.installments) !== undefined ? { installments: num(v.installments)! } : {}),
        ...(num(v.dueDayOfMonth) !== undefined ? { dueDayOfMonth: num(v.dueDayOfMonth)! } : {}),
        ...(num(v.graceDays) !== undefined ? { graceDays: num(v.graceDays)! } : {}),
      }),
  },
  {
    id: "create-period",
    label: "Créer une période",
    group: "structure",
    icon: "clock",
    summary: "Trimestre ou semestre, sur un cycle. Un bulletin est un document de période.",
    /**
     * A CYCLE, and nothing else for now.
     *
     * The API enforces the same list. A période on a classe lets every class of
     * a cycle drift into its own calendar and stops two bulletins from being
     * comparable; on a school it would silently mean "all its cycles", which is
     * a different statement from the one the operator made.
     */
    scope: ["CYCLE"],
    fields: [
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      {
        key: "kind", label: "Type", type: "select", required: true, default: "TRIMESTRE",
        // ANNEE is gone from the console: three trimestres or two semestres,
        // and the API refuses a fourth of either.
        options: [
          { value: "TRIMESTRE", label: "Trimestre (3 par an)" },
          { value: "SEMESTRE", label: "Semestre (2 par an)" },
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
        kind: v.kind as "TRIMESTRE" | "SEMESTRE",
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
    // A période lives on a CYCLE, so this is where one is locked. It listed
    // complexes and schools too, which offered a scope whose période list could
    // only ever come back empty.
    scope: ["CYCLE"],
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
    // Scoped AND routed: the screen is its own (a pupil is more than a couple
    // of fields), but it targets a classe, so reaching it from one carries that
    // classe in and the picker opens already answered.
    scope: ["CLASSE"],
    route: "enroll",
    inline: "enroll",
  },
  {
    id: "import-students",
    label: "Importer des élèves",
    group: "scolarite",
    icon: "upload",
    summary: "Depuis un fichier CSV exporté d'Excel. Vérifié avant enregistrement.",
    scope: ["CLASSE"],
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
    /**
     * Scoped now, and optional.
     *
     * Run from a school or a cycle it belongs to that branch; run from the rail
     * with nothing selected it belongs to the whole complex, which is right for
     * the national three. A type pinned nowhere used to appear everywhere —
     * the lycée's BAC blanc in the primaire's form.
     */
    scope: ["SCHOOL", "CYCLE"],
    scopeOptional: true,
    fields: [
      { key: "code", label: "Code", type: "text", required: true, hint: "COMPO" },
      { key: "name", label: "Nom", type: "text", required: true, hint: "Composition" },
      { key: "defaultWeight", label: "Poids par défaut", type: "number", default: 1 },
    ],
    submit: (scopeId, v) =>
      api.academics.createAssessmentType({
        code: v.code!,
        name: v.name!,
        ...(num(v.defaultWeight) !== undefined ? { defaultWeight: num(v.defaultWeight)! } : {}),
        ...(scopeId ? { orgUnitId: scopeId } : {}),
      }),
  },
  {
    id: "grading-system",
    label: "Système de notation",
    group: "evaluation",
    icon: "check",
    summary: "Le barème, le seuil de réussite et les mentions — ce sur quoi un bulletin se calcule.",
    /**
     * The one thing a fresh complex could not do at all.
     *
     * Without an official barème every bulletin screen answers "no grading
     * system set", and until now nothing in the console created one. The
     * scaffold installs the /20 conventions on day one; this is how a school
     * replaces them, or gives one cycle its own.
     */
    scope: ["COMPLEX", "SCHOOL", "CYCLE"],
    fields: [
      { key: "name", label: "Nom", type: "text", required: true, hint: "Barème du collège" },
      {
        key: "template",
        label: "Modèle",
        type: "select",
        required: true,
        options: [
          { value: "SECONDAIRE_20", label: "Secondaire — /20, moyenne à 10" },
          { value: "PRIMAIRE_10", label: "Primaire — /10, moyenne à 5" },
          { value: "LMD", label: "Supérieur — LMD, crédits capitalisables" },
          // Nothing inherited: every field below is the answer, and a blank one
          // is a blank one. A school whose barème matches none of the three had
          // no way in at all before this.
          { value: "CUSTOM", label: "Partir de zéro — tout définir" },
        ],
        default: "SECONDAIRE_20",
      },
      { key: "academicYearId", label: "Année scolaire", type: "select", source: "years", required: true },
      /*
       * Everything below belongs to "Partir de zéro" and appears only there.
       *
       * The three templates already answer these — that is what a template IS
       * — and showing them anyway makes a school think the barème is nine
       * decisions rather than one. See ActionField.when.
       */
      {
        key: "scaleMax",
        label: "Barème",
        type: "number",
        required: true,
        default: 20,
        hint: "Sur combien une note est donnée.",
        when: { field: "template", is: ["CUSTOM"] },
      },
      {
        key: "passThreshold",
        label: "Moyenne",
        type: "number",
        required: true,
        default: 10,
        hint: "Le seuil de réussite.",
        when: { field: "template", is: ["CUSTOM"] },
      },
      {
        key: "progressionModel",
        label: "Progression",
        type: "select",
        required: true,
        default: "REDOUBLEMENT",
        options: [
          { value: "REDOUBLEMENT", label: "Redoublement — l'année entière se refait" },
          { value: "CAPITALISATION", label: "Capitalisation — une UE validée reste acquise" },
        ],
        when: { field: "template", is: ["CUSTOM"] },
      },
      {
        key: "mentionBands",
        label: "Mentions",
        type: "text",
        hint: "16=Très bien, 14=Bien, 12=Assez bien, 10=Passable",
        when: { field: "template", is: ["CUSTOM"] },
      },
      {
        key: "resitBandLow",
        label: "Seuil de rattrapage",
        type: "number",
        hint: "Sous la moyenne mais au-dessus de ce seuil : session de rattrapage. Vide = pas de rattrapage.",
        when: { field: "template", is: ["CUSTOM"] },
      },
      {
        key: "eliminatoryFloor",
        label: "Note éliminatoire",
        type: "number",
        hint: "En dessous, rien ne compense, quelle que soit la moyenne. Vide = aucune.",
        when: { field: "template", is: ["CUSTOM"] },
      },
    ],
    /**
     * Two calls, deliberately: defining a barème grants it nowhere, and making
     * it official is the act with consequences. Doing both here is what makes
     * the action useful — a system nobody attached changes nothing.
     */
    submit: async (scopeId, v) => {
      const custom = v.template === "CUSTOM";
      const system = await api.academics.createGradingSystem({
        name: v.name!,
        /*
         * CUSTOM sends no template, so the API's own default fills only what
         * was left blank. Naming a template here would silently reinstate the
         * /20 conventions the operator just chose to abandon.
         */
        ...(custom
          ? {}
          : { template: (v.template as "SECONDAIRE_20" | "PRIMAIRE_10" | "LMD") ?? "SECONDAIRE_20" }),
        /*
         * The detail fields travel ONLY with CUSTOM.
         *
         * They carry defaults so the custom branch opens on something sensible,
         * and those defaults survive in `values` even while the fields are
         * hidden — so sending them unconditionally would push scaleMax 20 onto
         * a school that chose the /10 primaire template and silently overrule
         * the very thing they picked.
         */
        ...(custom
          ? {
              ...(num(v.scaleMax) !== undefined ? { scaleMax: num(v.scaleMax)! } : {}),
              ...(num(v.passThreshold) !== undefined ? { passThreshold: num(v.passThreshold)! } : {}),
              ...(num(v.resitBandLow) !== undefined ? { resitBandLow: num(v.resitBandLow)! } : {}),
              ...(num(v.eliminatoryFloor) !== undefined
                ? { eliminatoryFloor: num(v.eliminatoryFloor)! }
                : {}),
              ...(v.progressionModel
                ? { progressionModel: v.progressionModel as "REDOUBLEMENT" | "CAPITALISATION" }
                : {}),
              ...(parseMentions(v.mentionBands)
                ? { mentionBands: parseMentions(v.mentionBands)! }
                : {}),
            }
          : {}),
      });
      return api.academics.linkGradingSystem({
        gradingSystemId: system.id,
        orgUnitId: scopeId!,
        academicYearId: v.academicYearId!,
        isOfficial: true,
      });
    },
  },
  {
    id: "timetable",
    label: "Emploi du temps",
    group: "programme",
    icon: "calendar",
    summary: "La grille hebdomadaire de la classe : matière, enseignant, salle.",
    scope: ["CLASSE"],
    // No longer planned: TimetableSlot and /api/timetable exist. It opens the
    // class's own page on its timetable tab rather than a screen of its own —
    // the grid is a face of the class, not a separate destination.
    route: "unit",
    tab: "timetable",
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

/**
 * Screens that are about ONE unit, and therefore carry it as a route param.
 *
 * This set has to be shared, because getting it wrong crashes the console: a
 * `RouterLink` to `{ name: "classe" }` with no `id` throws "Missing required
 * param", and vue-router turns that into an unhandled navigation error that
 * takes the whole layout down. It did exactly that on the structure screen —
 * the rail offered "Voir une classe" as a live link the moment a complex had
 * any class, and every route without an `:id` of its own blew up. (It survived
 * on `/console/unit/:id` only by accident: vue-router inherits params from the
 * current location, so the link silently pointed at whatever unit was open.)
 *
 * So: never link to one of these without an id. Ask for the unit first.
 */
/**
 * "16=Très bien, 14=Bien" → the bands the engine reads.
 *
 * A list in a form built from flat fields, which is the one shape the
 * declarative registry cannot express. Typing them is not elegant, and it is
 * still better than the alternative on offer, which was a school unable to name
 * its own mentions at all. Anything unparseable is dropped rather than guessed:
 * a band nobody can read is a mention printed on a bulletin by accident.
 */
export function parseMentions(
  raw: string | undefined,
): { min: number; label: string }[] | null {
  if (!raw?.trim()) return null;
  const bands = raw
    .split(",")
    .map((part) => part.split("="))
    .filter((pair) => pair.length === 2)
    .map(([min, label]) => ({ min: Number(min!.trim()), label: label!.trim() }))
    .filter((b) => Number.isFinite(b.min) && b.label.length > 0)
    // Highest first: the engine takes the first band a mark clears.
    .sort((a, b) => b.min - a.min);
  return bands.length ? bands : null;
}

export const ROUTE_NEEDS_UNIT = new Set(["classe", "marks", "bulletins", "unit"]);

export const byId = (id: string) => ACTIONS.find((a) => a.id === id);
export const inGroup = (group: ActionGroup) => ACTIONS.filter((a) => a.group === group);
