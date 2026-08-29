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

export interface NewTenantInput {
  name: string;
  slug?: string;
  establishmentType: EstablishmentType;
  tier?: ServiceTier;
  locale?: string;
  currency?: string;
  timezone?: string;
  code?: string;
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

export const orgUnits = {
  children: (parentId?: string | null) =>
    request<OrgUnit[]>(`/org-units${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`),
  get: (id: string) => request<OrgUnit>(`/org-units/${id}`),
  ancestors: (id: string) => request<OrgUnit[]>(`/org-units/${id}/ancestors`),
  create: (body: Partial<OrgUnit> & { kind: OrgUnitKind; name: string; code: string }) =>
    request<OrgUnit>("/org-units", { method: "POST", body: JSON.stringify(body) }),
};

// ─── enrolment ───────────────────────────────────────────────────────────────

export interface RosterRow {
  id: string;
  studentId: string;
  isRepeating: boolean;
  student: { matricule: string; person: { firstName: string; lastName: string } };
  serie: { code: string; name: string } | null;
}

export const enrollment = {
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

export const academics = {
  years: () => request<AcademicYear[]>("/academics/years"),
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
