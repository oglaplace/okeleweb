import { config, loadConfig, type DeploymentInfo } from "./runtime";
import { phoneAuth } from "./firebase";

/**
 * API client for the TeYa console.
 *
 * Auth is a Firebase ID token (phone OTP), same identity model as teamfarm.
 * The base URL is discovered at runtime — see lib/runtime.ts — so this file
 * never knows which rung of the ladder it is talking to.
 */

const TOKEN_KEY = "ec_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Raised for any non-2xx. `code` carries the API's domain error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the node we reached is not the write authority for this complex. */
export const isRoutingError = (e: unknown) =>
  e instanceof ApiError && (e.code === "NOT_AUTHORITY" || e.code === "MIGRATION_IN_PROGRESS");

/** True when the request never reached a server at all. */
export const isOfflineError = (e: unknown) =>
  e instanceof ApiError && e.status === 0;

/**
 * True when the établissement has been suspended by the platform.
 *
 * Distinct from a permission failure: nothing the user does will help, and the
 * console says who to contact rather than showing a bare 403.
 */
export const isSuspendedError = (e: unknown) =>
  e instanceof ApiError && e.code === "TENANT_SUSPENDED";

/**
 * True when the phone number authenticated fine but is attached to nothing.
 *
 * The single most common real failure, and the one that used to read as "no
 * active account" — a sentence that tells a director their software is broken
 * when in fact they simply have not been invited yet. The console answers it
 * with its own screen; see LoginPage.
 */
export const isNoAccountError = (e: unknown) =>
  e instanceof ApiError && e.code === "NO_ACCOUNT";

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  await loadConfig();
  const { auth = true, ...rest } = init;

  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    // Firebase tokens live ~1h; refresh rather than sending a stale one and
    // bouncing the user to the login screen mid-task.
    const token = (await phoneAuth.getIdToken().catch(() => null)) ?? getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${config().apiBase}${path}`, { ...rest, headers });
  } catch {
    // Network-level failure. Status 0 is the app's signal for "the server was
    // not reachable", which on an edge box means the box is down and in the
    // cloud means the internet is.
    throw new ApiError(0, "Serveur injoignable.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body.error as string) || `Erreur ${res.status}`,
      body.code as string | undefined,
    );
  }
  return body as T;
}

// ─── platform ────────────────────────────────────────────────────────────────

/** Unauthenticated: what node is this, and is it writable? */
export const platformInfo = (tenantId?: string) =>
  request<DeploymentInfo>(
    `/platform/info${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`,
    { auth: false },
  );

/** Authenticated: the signed-in user's own node + tier context. */
export const myDeployment = () => request<DeploymentInfo>("/platform/me/deployment");

// ─── identity ────────────────────────────────────────────────────────────────

export interface Identity {
  account: {
    id: string;
    phone: string;
    fullName: string;
    email: string | null;
    /** Belongs to no établissement: an operator of the product itself. */
    isPlatformAdmin: boolean;
    permissions: string[];
  };
  deployment: DeploymentInfo;
}

/**
 * WHO is signed in — as distinct from WHERE they are talking, which is
 * `myDeployment`.
 *
 * The console's first call after an OTP. It used to be `myDeployment`, and that
 * is why a platform account could not sign in: that endpoint answers with a
 * tenant, a platform account has none, and the store read the null as a broken
 * account and threw the token away.
 */
export const me = () => request<Identity>("/platform/me");

// ─── établissements (platform staff only) ────────────────────────────────────

export type EstablishmentType =
  | "COMPLEXE" | "PRESCOLAIRE" | "PRIMAIRE" | "COLLEGE" | "LYCEE" | "UNIVERSITE";

export type ServiceTier = "CONNECTED" | "RESILIENT" | "SOVEREIGN";

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  locale: string;
  currency: string;
  timezone: string;
  active: boolean;
  tier: ServiceTier;
  authority: "CLOUD" | "EDGE";
  migrationLockedAt: string | null;
  createdAt: string;
  establishmentType: EstablishmentType | null;
  counts: { orgUnits: number; accounts: number; students: number };
}

export interface TenantAdmin {
  id: string;
  phone: string;
  fullName: string;
  email: string | null;
  active: boolean;
  lastSeenAt: string | null;
  roles: string[];
  permissions: string[];
}

export interface TenantDetail {
  tenant: Omit<TenantSummary, "counts">;
  root: OrgUnit | null;
  admins: TenantAdmin[];
  edgeNodes: {
    id: string;
    name: string;
    status: string;
    lastSeenAt: string | null;
    appVersion: string | null;
  }[];
  academicYears: { id: string; label: string; isCurrent: boolean }[];
}

// ─── blueprints ──────────────────────────────────────────────────────────────

export type BlueprintModule =
  | "PRESCOLAIRE" | "PRIMAIRE" | "COLLEGE" | "LYCEE_GENERAL"
  | "LYCEE_TECHNIQUE" | "SUPERIEUR" | "ADMINISTRATION";

export interface ScaffoldPreview {
  modules: BlueprintModule[];
  orgUnits: number;
  levels: number;
  /** One cohort opened per level — a pupil enrols into the classe, not the niveau. */
  classes: number;
  series: number;
  departments: number;
  /** The cycle's national-exam papers, deduplicated across modules. */
  subjects: number;
}

/**
 * One row an upgrade would create. `key` is what gets ticked and sent back.
 *
 * A path rather than an id (`unit:COL/C1/5E`), because the server computes the
 * plan in a transaction it rolls back — every id it saw is gone by the time the
 * operator decides.
 */
export interface PlanItem {
  key: string;
  kind: "UNIT" | "SUBJECT" | "SERIE" | "PERIOD" | "OFFERING" | "FISCAL_YEAR";
  label: string;
  detail: string;
  module: BlueprintModule | null;
}

export interface ScaffoldReport extends ScaffoldPreview {
  periods: number;
  offerings: number;
  fiscalYears: number;
  /** Units that already existed and were left alone. */
  skipped: number;
}

/** Is this établissement ready to be used, or still an empty shell? */
export interface Completeness {
  hasRoot: boolean;
  /** Blueprint modules already present, so the picker can mark them. */
  installedModules: BlueprintModule[];
  /** Nothing but a root — no screen in the console can do anything yet. */
  isEmpty: boolean;
  total: number;
  levels: number;
  classes: number;
  /** Levels exist but no cohort does, so nobody can be enrolled. */
  needsClasses: boolean;
}

export interface NewTenantInput {
  name: string;
  slug?: string;
  establishmentType: EstablishmentType;
  tier?: ServiceTier;
  locale?: string;
  currency?: string;
  timezone?: string;
  code?: string;
  /** Omit for the type's defaults; [] means "root only" and is respected. */
  modules?: BlueprintModule[];
  admin: { phone: string; fullName: string; email?: string; role?: string };
}

export const platform = {
  tenants: (opts: { q?: string; includeInactive?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (opts.includeInactive) qs.set("includeInactive", "true");
    const suffix = qs.toString();
    return request<TenantSummary[]>(`/platform/tenants${suffix ? `?${suffix}` : ""}`);
  },
  tenant: (id: string) => request<TenantDetail>(`/platform/tenants/${id}`),
  createTenant: (body: NewTenantInput) =>
    request<{
      tenant: TenantSummary;
      root: OrgUnit;
      academicYear: string;
      modules: BlueprintModule[];
      scaffold: ScaffoldReport;
      admin: { id: string; phone: string; fullName: string };
    }>("/platform/tenants", { method: "POST", body: JSON.stringify(body) }),
  updateTenant: (id: string, body: { name?: string; active?: boolean }) =>
    request<TenantSummary>(`/platform/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addAdmin: (
    id: string,
    body: { phone: string; fullName: string; email?: string; role?: string },
  ) =>
    request<{ account: { id: string; phone: string; fullName: string }; role: string }>(
      `/platform/tenants/${id}/admins`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};

// ─── structure ───────────────────────────────────────────────────────────────

export type OrgUnitKind =
  | "COMPLEX" | "ORG_DIVISION" | "DEPARTMENT" | "SCHOOL" | "CYCLE"
  | "FACULTY" | "FILIERE" | "PARCOURS" | "NIVEAU" | "CLASSE";

export interface OrgUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  code: string;
  rank: number;
  singleTitulaire: boolean;
  capacity: number | null;
  validTo: string | null;
}

export interface TreeUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  code: string;
  rank: number;
  capacity: number | null;
  validTo: string | null;
  depth: number;
}

export interface SearchHit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  code: string;
  /** Root-first ancestry, self excluded. */
  path: string[];
}

export const orgUnits = {
  children: (parentId?: string | null) =>
    request<OrgUnit[]>(`/org-units${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`),
  get: (id: string) => request<OrgUnit>(`/org-units/${id}`),
  ancestors: (id: string) => request<OrgUnit[]>(`/org-units/${id}/ancestors`),
  create: (body: Partial<OrgUnit> & { kind: OrgUnitKind; name: string; code: string }) =>
    request<OrgUnit>("/org-units", { method: "POST", body: JSON.stringify(body) }),

  /** Renames and edits safe attributes. Never the kind or the parent. */
  update: (
    id: string,
    body: { name?: string; code?: string; capacity?: number | null },
  ) => request<OrgUnit>(`/org-units/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  /** Closes rather than deletes — last year's bulletin still points here. */
  close: (id: string) => request<OrgUnit>(`/org-units/${id}`, { method: "DELETE" }),

  reopen: (id: string) => request<OrgUnit>(`/org-units/${id}/reopen`, { method: "POST" }),

  /**
   * The whole tree, flat and depth-ordered, in ONE request.
   *
   * Lazy per-node loading is a round trip per expansion, and a director opening
   * a complex to reach 6e B pays six of them on a metered connection.
   */
  tree: () => request<TreeUnit[]>("/org-units/tree"),

  /** By name or code, each hit carrying the path that disambiguates it. */
  search: (q: string) =>
    request<SearchHit[]>(`/org-units/search?q=${encodeURIComponent(q)}`),

  /** Is this établissement still an empty shell? Drives the console's empty state. */
  completeness: () => request<Completeness>("/org-units/completeness"),

  /**
   * Which kinds may be created under a unit.
   *
   * Asked rather than hardcoded: ALLOWED_PARENTS is what the POST enforces, and
   * a client working from its own copy offers options the server then refuses.
   */
  allowedKinds: (parentId?: string | null) =>
    request<OrgUnitKind[]>(
      `/org-units/allowed-kinds${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`,
    ),

  previewScaffold: (modules: BlueprintModule[]) =>
    request<ScaffoldPreview>(
      `/org-units/scaffold/preview?modules=${encodeURIComponent(modules.join(","))}`,
    ),

  /**
   * What an upgrade WOULD add, itemised.
   *
   * Computed server-side by running the scaffold in a rolled-back transaction,
   * so the list cannot drift from what applying it actually does. No modules
   * means "whatever is installed" — the upgrade case.
   */
  planScaffold: (modules?: BlueprintModule[]) =>
    request<{ modules: BlueprintModule[]; items: PlanItem[] }>(
      `/org-units/scaffold/plan${modules?.length ? `?modules=${encodeURIComponent(modules.join(","))}` : ""}`,
    ),

  /** `only` are plan keys. Omitted, everything missing is created. */
  scaffold: (modules: BlueprintModule[], only?: string[]) =>
    request<ScaffoldReport>("/org-units/scaffold", {
      method: "POST",
      body: JSON.stringify({ modules, ...(only ? { only } : {}) }),
    }),
};

// ─── readiness ───────────────────────────────────────────────────────────────

export type Severity = "BLOCKING" | "WARNING";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** Why it matters, in the director's terms — not the schema's. */
  detail: string;
  /** Action id from lib/actions.ts, when one fixes it. */
  action: string | null;
  count?: number;
}

export interface Readiness {
  /** READY only when nothing blocks. Warnings do not stop a school running. */
  status: "READY" | "DEGRADED" | "BLOCKED";
  blocking: number;
  warnings: number;
  /** Already sorted blocking-first by the server. */
  findings: Finding[];
  checkedAt: string;
}

/** Can this établissement run, and if not, what stops it? */
export const readiness = () => request<Readiness>("/platform/readiness");

// ─── people ──────────────────────────────────────────────────────────────────

export interface Capabilities {
  classes: number;
  niveaux: number;
  units: number;
  staff: number;
  series: number;
  academicYear: { id: string; label: string } | null;
  /**
   * What the action rail may offer, computed from what EXISTS. "Enrol a pupil"
   * is not an action until a classe exists to enrol them into.
   */
  can: {
    enrollStudent: boolean;
    importStudents: boolean;
    addStaff: boolean;
    importStaff: boolean;
    assignStaff: boolean;
    createClasse: boolean;
  };
}

export interface StaffMember {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  type: "PERMANENT" | "VACATAIRE" | "STAGIAIRE";
  baseAmountXaf: number;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  assignments: {
    id: string;
    role: string;
    orgUnit: { id: string; name: string; kind: OrgUnitKind };
  }[];
}

export interface ImportReport {
  /** Which spreadsheet column was read as which field. Shown before writing. */
  mapping: Record<string, string | null>;
  total: number;
  ready: number;
  problems: { line: number; message: string }[];
  imported: number;
}

export const people = {
  capabilities: () => request<Capabilities>("/people/capabilities"),

  staff: (opts: { q?: string; orgUnitId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (opts.orgUnitId) qs.set("orgUnitId", opts.orgUnitId);
    const suffix = qs.toString();
    return request<StaffMember[]>(`/people/staff${suffix ? `?${suffix}` : ""}`);
  },

  createStaff: (body: {
    person: {
      firstName: string;
      lastName: string;
      gender?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
    };
    type?: "PERMANENT" | "VACATAIRE" | "STAGIAIRE";
    baseAmountXaf?: number;
    assignment?: { orgUnitId: string; role: string };
  }) => request<unknown>("/people/staff", { method: "POST", body: JSON.stringify(body) }),

  assign: (employmentId: string, body: { orgUnitId: string; role: string }) =>
    request<unknown>(`/people/staff/${employmentId}/assignments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  endAssignment: (id: string) =>
    request<unknown>(`/people/assignments/${id}`, { method: "DELETE" }),

  importStudents: (body: {
    academicYearId: string;
    classeId: string;
    rows: Record<string, string>[];
    dryRun?: boolean;
  }) =>
    request<ImportReport>("/people/import/students", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  importStaff: (body: { rows: Record<string, string>[]; dryRun?: boolean }) =>
    request<ImportReport>("/people/import/staff", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ─── enrolment ───────────────────────────────────────────────────────────────

export interface GuardianRow {
  relationship: string;
  isPrimary: boolean;
  isPayer: boolean;
  guardian: { firstName: string; lastName: string; phone: string | null; email: string | null };
}

export interface RosterRow {
  id: string;
  studentId: string;
  isRepeating: boolean;
  student: {
    matricule: string;
    person: { firstName: string; lastName: string };
    /** The primary tuteur only — the number a titulaire actually dials. */
    guardians: GuardianRow[];
  };
  serie: { code: string; name: string } | null;
}

export const enrollment = {
  /** Creates the Person, the Student and the Enrolment in one call. */
  enroll: (body: {
    person: {
      firstName: string;
      lastName: string;
      birthDate?: string | null;
      birthPlace?: string | null;
      gender?: string | null;
      phone?: string | null;
      address?: string | null;
    };
    /**
     * The tuteurs, created with the pupil.
     *
     * The first is the contact and the payer unless said otherwise, and an
     * adult already known by that phone number is reused rather than copied —
     * both decided server-side, so a second client cannot get it wrong.
     */
    guardians?: {
      firstName: string;
      lastName: string;
      relationship: string;
      phone?: string | null;
      email?: string | null;
      isPrimary?: boolean;
      isPayer?: boolean;
    }[];
    academicYearId: string;
    classeId: string;
    serieId?: string | null;
    isRepeating?: boolean;
  }) => request<{ id: string }>("/enrollment", { method: "POST", body: JSON.stringify(body) }),

  roster: (classeId: string, academicYearId: string) =>
    request<RosterRow[]>(
      `/enrollment/roster?classeId=${encodeURIComponent(classeId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),
};

// ─── grading ─────────────────────────────────────────────────────────────────

export interface PreviewCourse {
  courseOfferingId: string;
  subjectCode: string;
  coefficient: string;
  score: string | null;
  classAvg: string | null;
  rank: number | null;
  isCompensated: boolean;
  isEliminated: boolean;
}

export interface PreviewStudent {
  studentId: string;
  rank: number | null;
  average: string | null;
  averageRaw: string | null;
  mention: string | null;
  isPassing: boolean;
  isEliminated: boolean;
  needsResit: boolean;
  creditsEarned: number | null;
  absenceHours: string;
  lateCount: number;
  courses: PreviewCourse[];
  trace: { step: string; detail: string }[];
}

export interface ClassePreview {
  classeId: string;
  periodId: string;
  gradingSystem: { id: string; name: string };
  rankOf: number;
  classAvg: string | null;
  classMin: string | null;
  classMax: string | null;
  students: PreviewStudent[];
}

export interface MarkSheetLine {
  id: string;
  coefficient: string;
  score: string | null;
  scoreRaw: string | null;
  classAvg: string | null;
  rank: number | null;
  isCompensated: boolean;
  isEliminated: boolean;
  appreciation: string | null;
  unitCode: string | null;
  courseOffering: { subject: { code: string; name: string } };
}

export interface MarkSheet {
  id: string;
  version: number;
  status: "DRAFT" | "ISSUED" | "SUPERSEDED";
  average: string | null;
  averageRaw: string | null;
  rank: number | null;
  rankOf: number | null;
  classAvg: string | null;
  classMin: string | null;
  classMax: string | null;
  mention: string | null;
  creditsEarned: number | null;
  absenceHours: string | null;
  lateCount: number | null;
  appreciation: string | null;
  issuedAt: string | null;
  reason: string | null;
  student: {
    matricule: string;
    person: {
      firstName: string;
      lastName: string;
      birthDate: string | null;
      birthPlace: string | null;
    };
  };
  classe: { name: string; code: string };
  period: { label: string } | null;
  academicYear: { label: string };
  lines: MarkSheetLine[];
}

export interface Assessment {
  id: string;
  title: string | null;
  maxScore: string;
  weight: string | null;
  givenOn: string | null;
  assessmentType: { code: string; name: string; defaultWeight: string };
}

export interface MarkRow {
  studentId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  score: string | null;
  isAbsent: boolean;
  isExcused: boolean;
  comment: string | null;
  /** False = nobody has typed anything yet. Distinct from absent. */
  entered: boolean;
}

export interface MarkGrid {
  assessment: {
    id: string;
    title: string | null;
    type: string;
    maxScore: string;
    weight: string;
    subject: string;
    period: string;
    /** The council has locked the period — the grid is read-only. */
    locked: boolean;
  };
  rows: MarkRow[];
}

export interface MarkEntry {
  studentId: string;
  score?: string | number | null;
  isAbsent?: boolean;
  isExcused?: boolean;
}

export const grading = {
  /** Conseil de classe preview — computes, writes nothing. */
  preview: (classeId: string, periodId: string) =>
    request<ClassePreview>(
      `/grading/preview?classeId=${encodeURIComponent(classeId)}` +
        `&periodId=${encodeURIComponent(periodId)}`,
    ),
  issue: (classeId: string, periodId: string, appreciations?: Record<string, string>) =>
    request<{ issued: number }>("/grading/issue", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, appreciations }),
    }),
  /** Current sheets for a classe, ordered by rang — what the print run reads. */
  sheetsForClasse: (classeId: string, periodId: string) =>
    request<MarkSheet[]>(
      `/grading/marksheets/classe?classeId=${encodeURIComponent(classeId)}` +
        `&periodId=${encodeURIComponent(periodId)}`,
    ),
  sheet: (id: string) => request<MarkSheet>(`/grading/marksheets/${id}`),

  // ── mark entry ──
  assessments: (periodId: string, courseOfferingId: string, classeId?: string) =>
    request<Assessment[]>(
      `/grading/assessments?periodId=${encodeURIComponent(periodId)}` +
        `&courseOfferingId=${encodeURIComponent(courseOfferingId)}` +
        (classeId ? `&classeId=${encodeURIComponent(classeId)}` : ""),
    ),
  createAssessment: (body: {
    periodId: string;
    courseOfferingId: string;
    assessmentTypeId: string;
    classeId?: string | null;
    title?: string;
    maxScore?: number;
  }) =>
    request<Assessment>("/grading/assessments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  marks: (assessmentId: string, classeId: string) =>
    request<MarkGrid>(
      `/grading/marks?assessmentId=${encodeURIComponent(assessmentId)}` +
        `&classeId=${encodeURIComponent(classeId)}`,
    ),
  saveMarks: (assessmentId: string, entries: MarkEntry[]) =>
    request<{ saved: number }>("/grading/marks", {
      method: "PUT",
      body: JSON.stringify({ assessmentId, entries }),
    }),
};

// ─── finance ─────────────────────────────────────────────────────────────────

export const finance = {
  /** The SYSCOHADA chart of accounts, once per établissement. */
  seedLedger: () => request<unknown>("/finance/ledger/seed", { method: "POST" }),

  createFeeType: (body: {
    code: string;
    name: string;
    recurrence?: "ONCE" | "PER_PERIOD" | "MONTHLY";
  }) => request<unknown>("/finance/fee-types", { method: "POST", body: JSON.stringify(body) }),

  createFeeSchedule: (body: {
    orgUnitId: string;
    academicYearId: string;
    name: string;
    items: { feeTypeId: string; amountXaf: number; installments?: number }[];
  }) => request<unknown>("/finance/fee-schedules", { method: "POST", body: JSON.stringify(body) }),

  feeTypes: () => request<{ id: string; code: string; name: string }[]>("/finance/fee-types"),
};

// ─── academics ───────────────────────────────────────────────────────────────

export interface Period {
  id: string;
  label: string;
  sequence: number;
  kind: string;
  startsOn: string;
  endsOn: string;
  lockedAt: string | null;
}

export interface AcademicYear {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface CourseOffering {
  id: string;
  weeklyHours: string;
  subject: { id: string; code: string; name: string };
  unit: { code: string; name: string; credits: number | null } | null;
}

export interface AssessmentType {
  id: string;
  code: string;
  name: string;
  defaultWeight: string;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
}

export interface Serie {
  id: string;
  code: string;
  name: string;
}

export const academics = {
  years: () => request<AcademicYear[]>("/academics/years"),
  createYear: (body: {
    label: string;
    startsOn: string;
    endsOn: string;
    isCurrent?: boolean;
  }) => request<AcademicYear>("/academics/years", { method: "POST", body: JSON.stringify(body) }),

  subjects: () => request<Subject[]>("/academics/subjects"),
  createSubject: (body: { code: string; name: string }) =>
    request<Subject>("/academics/subjects", { method: "POST", body: JSON.stringify(body) }),

  createPeriod: (body: {
    orgUnitId: string;
    academicYearId: string;
    kind?: "TRIMESTRE" | "SEMESTRE" | "ANNEE";
    label: string;
    sequence: number;
    startsOn: string;
    endsOn: string;
  }) => request<Period>("/academics/periods", { method: "POST", body: JSON.stringify(body) }),

  lockPeriod: (id: string) =>
    request<Period>(`/academics/periods/${id}/lock`, { method: "PATCH" }),

  createOffering: (body: {
    niveauId: string;
    academicYearId: string;
    subjectId: string;
    weeklyHours?: number;
  }) => request<CourseOffering>("/academics/offerings", { method: "POST", body: JSON.stringify(body) }),

  setCoefficient: (body: {
    niveauId: string;
    academicYearId: string;
    subjectId: string;
    serieId: string | null;
    value: number;
  }) => request<unknown>("/academics/coefficients", { method: "PUT", body: JSON.stringify(body) }),

  createAssessmentType: (body: { code: string; name: string; defaultWeight?: number }) =>
    request<AssessmentType>("/academics/assessment-types", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  offerings: (niveauId: string, academicYearId: string) =>
    request<CourseOffering[]>(
      `/academics/offerings?niveauId=${encodeURIComponent(niveauId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),
  assessmentTypes: () => request<AssessmentType[]>("/academics/assessment-types"),
  periods: (orgUnitId: string, academicYearId: string) =>
    request<Period[]>(
      `/academics/periods?orgUnitId=${encodeURIComponent(orgUnitId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),
};
