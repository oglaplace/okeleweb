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
    /*
     * Network-level failure. Status 0 is the app's signal for "the server was
     * not reachable", which on an edge box means the box is down and in the
     * cloud means the internet is.
     *
     * The method and path are in the message now. Every transport failure used
     * to read as the same six words, which made a report of one impossible to
     * act on: "serveur injoignable" on a delete and on a whole page down are
     * very different problems wearing the same sentence.
     */
    const method = (rest.method ?? "GET").toUpperCase();
    throw new ApiError(0, `Serveur injoignable (${method} ${path}).`);
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
    /**
     * The human this account IS, when it is one.
     *
     * Null for a shared login — a "secrétariat" account nobody's face belongs
     * to — and that is the whole reason the field exists: only an account tied
     * to a person may edit that person's own portrait, so the console offers
     * the control on the strength of this and the API enforces it regardless.
     */
    personId: string | null;
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
  kind: "UNIT" | "SUBJECT" | "SERIE" | "PERIOD" | "OFFERING" | "FISCAL_YEAR" | "GRADING";
  label: string;
  detail: string;
  module: BlueprintModule | null;
}

export interface ScaffoldReport extends ScaffoldPreview {
  periods: number;
  offerings: number;
  fiscalYears: number;
  gradingSystems: number;
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
  /**
   * A portrait, uploaded as base64 rather than multipart.
   *
   * The office may set anyone's; a person may set their own — the API decides,
   * matching the caller's account against the person, and answers 403 when it
   * is neither. Kept in the database rather than an object store because the
   * SOVEREIGN tier runs on a box with no guaranteed internet, and a face on a
   * CDN is a face missing on exactly the days the connection is down.
   */
  setPhoto: (personId: string, data: string) =>
    request<{ sizeBytes: number; contentType: string }>(
      `/people/${encodeURIComponent(personId)}/photo`,
      { method: "POST", body: JSON.stringify({ data }) },
    ),

  removePhoto: (personId: string) =>
    request<{ removed: number }>(`/people/${encodeURIComponent(personId)}/photo`, {
      method: "DELETE",
    }),

  /**
   * The portrait as an object URL, or null when there is none.
   *
   * NOT a plain <img src>. The endpoint is behind the same bearer token as
   * everything else, and an <img> tag cannot carry an Authorization header —
   * pointing one at the URL yields a 401 and a broken-image glyph. So the bytes
   * are fetched like any other call and handed to the DOM as a blob.
   *
   * The caller owns the returned URL and must revokeObjectURL it, or every
   * re-render of a class list leaks a portrait.
   */
  photoObjectUrl: async (personId: string): Promise<string | null> => {
    await loadConfig();
    const token = (await phoneAuth.getIdToken().catch(() => null)) ?? getToken();
    const res = await fetch(
      `${config().apiBase}/people/${encodeURIComponent(personId)}/photo`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    ).catch(() => null);
    if (!res || !res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

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
  }) =>
    request<{ person: { id: string }; employment: { id: string } }>("/people/staff", {
      method: "POST",
      body: JSON.stringify(body),
    }),

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

// ─── sheets ──────────────────────────────────────────────────────────────────

export interface SheetPeriod {
  id: string;
  label: string;
  sequence: number;
  kind: string;
  /** The evaluations set in this période — one column each. */
  assessments: SheetAssessment[];
  /** A locked période is read-only everywhere, the sheet included. */
  locked: boolean;
}

/**
 * One evaluation, and where it stands.
 *
 * open → submitted → published, and the column is typeable only in the first
 * state. See the API's marks.service: publication is not a button, it is what
 * issuing the bulletins does.
 */
export interface SheetAssessment {
  id: string;
  subjectId: string;
  courseOfferingId: string;
  label: string;
  max: number;
  submitted: boolean;
  published: boolean;
}
export interface SheetSubject {
  id: string;
  code: string;
  name: string;
  offeringId: string;
  /** All séries confounded. Null is the normal, blocking, starting state. */
  coefficient: number | null;
}

export interface StudentSheetRow {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  gender: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  isRepeating: boolean;
  serie: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  billedXaf: number;
  paidXaf: number;
  balanceXaf: number;
  invoiceCount: number;
  lastPaymentOn: string | null;
  /** periodId → the marks for that période. */
  grades: Record<
    string,
    {
      average: number | null;
      rank: number | null;
      bySubject: Record<string, number | null>;
      /** The mark AS ENTERED, on that evaluation's own barème. */
      byAssessment: Record<string, number | "abs" | null>;
      /**
       * The weighted average, computed live by the engine the conseil will run.
       *
       * `average` above is the OFFICIAL one and only exists once bulletins are
       * issued — months after the first devoir. `complete` says whether every
       * subject has a mark, so a mean over three subjects out of nine can be
       * shown AND labelled rather than hidden or passed off as final.
       */
      live: number | null;
      liveMention: string | null;
      complete: boolean;
    }
  >;
  sessions: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRate: number | null;
  /** subjectId → absences, when the cycle counts attendance per subject. */
  absenceBySubject: Record<string, number>;
}

export interface StudentSheet {
  classe: { id: string; name: string; code: string };
  year: { id: string; label: string };
  periods: SheetPeriod[];
  subjects: SheetSubject[];
  rows: StudentSheetRow[];
  attendanceMode: AttendanceMode;
  /** Why a column set is empty, when it is. Shown rather than left to guess. */
  notes: string[];
}

export interface StaffSheetRow extends StaffMember {
  roles: string;
  units: string;
  postings: number;
}

/** How absences are counted — per day, or per subject. See the API's sheets. */
export type AttendanceMode = "GENERAL" | "BY_SUBJECT";

export interface SubjectSheet {
  niveau: { id: string; name: string };
  subject: { id: string; code: string; name: string };
  offeringId: string | null;
  periods: {
    id: string;
    label: string;
    sequence: number;
    assessments: { id: string; label: string; max: number; givenOn: string | null }[];
  }[];
  rows: Record<string, unknown>[];
}

export interface NiveauSheet {
  niveau: { id: string; name: string; code: string };
  classes: number;
  series: { id: string; code: string; name: string }[];
  rows: (Record<string, unknown> & {
    id: string;
    subjectId: string;
    code: string;
    name: string;
    weeklyHours: number;
    coefficient: number | null;
    assessments: number;
    slots: number;
  })[];
}

export interface PeriodSheet {
  unit: { id: string; name: string; kind: OrgUnitKind };
  rows: {
    id: string;
    label: string;
    kind: string;
    sequence: number;
    startsOn: string;
    endsOn: string;
    locked: boolean;
    state: string;
  }[];
}

/**
 * ONE PUPIL, everything the school knows, sectioned by the API.
 *
 * The sections are the domain's rather than the layout's — identité, scolarité,
 * finances, résultats, assiduité — so a second client rendering this folder
 * does not have to rediscover which of forty fields belong together.
 */
export interface StudentDossier {
  identity: {
    studentId: string;
    personId: string;
    matricule: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    birthPlace: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    /** The app's own upload, or an external URL. Null when there is neither. */
    photoUrl: string | null;
  };
  guardians: {
    personId: string;
    firstName: string;
    lastName: string;
    relationship: string;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    isPayer: boolean;
  }[];
  schooling: {
    id: string;
    year: string;
    yearId: string;
    classe: string;
    classeId: string;
    serie: string | null;
    isRepeating: boolean;
    withdrawnOn: string | null;
    isCurrent: boolean;
  }[];
  finance: {
    billedXaf: number;
    paidXaf: number;
    balanceXaf: number;
    invoices: {
      id: string; number: string; status: string; totalXaf: number;
      issuedOn: string | null; dueOn: string | null; lines: number;
    }[];
    payments: {
      id: string; amountXaf: number; method: string;
      paidOn: string; reference: string | null;
    }[];
  };
  academic: {
    marksheets: {
      id: string; year: string; period: string; periodId: string | null;
      classe: string; status: string; average: string | null;
      rank: number | null; rankOf: number | null; mention: string | null;
    }[];
    decisions: { year: string; kind: string; note: string | null; decidedOn: string | null }[];
  };
  attendance: {
    classe: string | null;
    sessions: number; present: number; late: number; absent: number; excused: number;
    rate: number | null;
  };
}

export const sheets = {
  /** One pupil's whole dossier — see StudentDossier. */
  student: (studentId: string) =>
    request<StudentDossier>(`/sheets/student/${encodeURIComponent(studentId)}`),

  /** A whole class in one read — see the API's modules/sheets. */
  classe: (classeId: string, academicYearId: string) =>
    request<StudentSheet>(
      `/sheets/classe?classeId=${encodeURIComponent(classeId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  staff: (orgUnitId: string) =>
    request<{ unit: { id: string; name: string; kind: OrgUnitKind }; rows: StaffSheetRow[] }>(
      `/sheets/staff?orgUnitId=${encodeURIComponent(orgUnitId)}`,
    ),

  /** The programme of a niveau: what is taught, how often, at what weight. */
  niveau: (niveauId: string, academicYearId: string) =>
    request<NiveauSheet>(
      `/sheets/niveau?niveauId=${encodeURIComponent(niveauId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /** One subject, every pupil of the niveau, every période. */
  subject: (niveauId: string, subjectId: string, academicYearId: string) =>
    request<SubjectSheet>(
      `/sheets/subject?niveauId=${encodeURIComponent(niveauId)}` +
        `&subjectId=${encodeURIComponent(subjectId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /** The périodes of a cycle or school — the year's calendar. */
  periods: (orgUnitId: string, academicYearId: string) =>
    request<PeriodSheet>(
      `/sheets/periods?orgUnitId=${encodeURIComponent(orgUnitId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),
};

// ─── timetable ───────────────────────────────────────────────────────────────

export interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  startsAtMin: number;
  endsAtMin: number;
  room: string | null;
  periodId: string | null;
  courseOfferingId: string;
  subject: { id: string; code: string; name: string };
  employmentId: string | null;
  teacher: string | null;
}

/**
 * The week, plus whether anyone outside the office can see it.
 *
 * `published` is the state of the WEEK. `isDraft` is about this caller: true
 * only when they are being shown a week nobody else can see yet, which is what
 * lets the grid say so instead of looking like a finished timetable.
 */
export interface TimetableGrid {
  classe: { id: string; name: string };
  published: boolean;
  publishedAt: string | null;
  /** Which release the public is currently reading. Null before the first. */
  version: number | null;
  isDraft: boolean;
  /**
   * The draft differs from what was released.
   *
   * Publication freezes a snapshot, so an edit is no longer public the moment
   * it is typed — which means the toolbar has to say when something is waiting.
   * Compared on what a pupil can SEE (day, hours, subject, teacher, room), so
   * deleting a lesson and drawing an identical one does not raise it.
   */
  hasUnpublishedChanges: boolean;
  slots: TimetableSlot[];
}

export const timetable = {
  /** The weekly grid, with everything a cell needs to draw itself. */
  forClasse: (classeId: string, academicYearId: string) =>
    request<TimetableGrid>(
      `/timetable?classeId=${encodeURIComponent(classeId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /**
   * Puts the week on the wall, or takes it back off.
   *
   * Until this is called the grid exists only for the people drawing it — see
   * the API's TimetablePublication. Publishing an empty week is refused there,
   * not here: a rule the server does not enforce is not a rule.
   */
  publish: (classeId: string, academicYearId: string) =>
    request<{ publishedAt: string; version: number }>("/timetable/publish", {
      method: "POST",
      body: JSON.stringify({ classeId, academicYearId }),
    }),

  unpublish: (classeId: string, academicYearId: string) =>
    request<{ unpublished: number }>("/timetable/unpublish", {
      method: "POST",
      body: JSON.stringify({ classeId, academicYearId }),
    }),

  addSlot: (body: {
    classeId: string;
    courseOfferingId: string;
    academicYearId: string;
    periodId?: string | null;
    employmentId?: string | null;
    dayOfWeek: number;
    startsAtMin: number;
    endsAtMin: number;
    room?: string | null;
  }) => request<TimetableSlot>("/timetable/slots", { method: "POST", body: JSON.stringify(body) }),

  /**
   * Removal goes through a POST, for one slot or for fifty.
   *
   * The note that used to be here blamed proxies for the per-id DELETE coming
   * back as "Serveur injoignable". That was wrong, and worth correcting rather
   * than deleting: the cause was the API registering @fastify/cors with no
   * options, whose v11 default allows GET, HEAD and POST only — so the browser
   * refused the DELETE at the preflight and it never left. It is fixed
   * server-side and asserted by tests/cors.test.ts.
   *
   * This stays a POST anyway, because it is no longer a workaround: multi-select
   * sends a LIST of ids, and a DELETE with a body is the shape nobody agrees
   * about. One endpoint for one slot and for fifty.
   */
  removeSlots: (classeId: string, ids: string[]) =>
    request<{ removed: number }>("/timetable/slots/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ classeId, ids }),
    }),

  /**
   * Many at once: a block selection, assigned in one go.
   *
   * Returns the created slots ALREADY HYDRATED — subject, teacher and all — so
   * the grid can splice them into the week it is displaying. Refetching the
   * whole timetable made every lesson on screen vanish and redraw, which reads
   * as a page that lost its data and got it back.
   */
  addSlots: (
    classeId: string,
    academicYearId: string,
    slots: {
      courseOfferingId: string;
      periodId?: string | null;
      employmentId?: string | null;
      dayOfWeek: number;
      startsAtMin: number;
      endsAtMin: number;
      room?: string | null;
    }[],
  ) =>
    request<{ created: number; slots: TimetableSlot[] }>("/timetable/slots/bulk", {
      method: "POST",
      body: JSON.stringify({ classeId, academicYearId, slots }),
    }),

  /**
   * An edit over one slot or over a selection of them.
   *
   * Omitting a field leaves it alone; sending `null` clears it. That is what
   * makes "toutes les heures de maths sont à M. Ngoma" one call that does not
   * blank the salles nobody asked about.
   */
  updateSlots: (
    classeId: string,
    ids: string[],
    patch: {
      courseOfferingId?: string;
      employmentId?: string | null;
      room?: string | null;
      dayOfWeek?: number;
      startsAtMin?: number;
      endsAtMin?: number;
    },
  ) =>
    request<{ updated: number; slots: TimetableSlot[] }>("/timetable/slots/bulk-update", {
      method: "POST",
      body: JSON.stringify({ classeId, ids, ...patch }),
    }),

  copyWeek: (fromClasseId: string, toClasseId: string, academicYearId: string) =>
    request<{ copied: number; skipped: number }>("/timetable/copy", {
      method: "POST",
      body: JSON.stringify({ fromClasseId, toClasseId, academicYearId }),
    }),
};

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
  }) =>
    /* `personId` comes back so the caller can attach the portrait without
       walking student → person for a field the API already had in hand. */
    request<{ id: string; studentId: string; personId: string }>("/enrollment", {
      method: "POST",
      body: JSON.stringify(body),
    }),

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

/**
 * A bulletin, issued or provisional.
 *
 * Same shape either way, and `status` is the difference: PROVISIONAL is the
 * council's own preview, computed live, and the page says so rather than
 * presenting it as a document.
 */
export interface Bulletin {
  /**
   * ISSUED is the document. PROVISIONAL is the council's own preview.
   * SIMULATED is neither — it is the same marks read on a different barème,
   * and it will never be signed in that form.
   */
  status: "ISSUED" | "DRAFT" | "PROVISIONAL" | "SIMULATED";
  version: number | null;
  issuedAt: string | null;
  establishment: {
    complex: string | null;
    school: string | null;
    department: string | null;
    niveau: string | null;
    classe: string | null;
    classeId: string;
  };
  student: {
    id: string;
    matricule: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    birthPlace: string | null;
    gender: string | null;
    serie: string | null;
    isRepeating: boolean;
  };
  year: { id: string; label: string };
  period: {
    id: string;
    label: string;
    kind: string;
    startsOn: string;
    endsOn: string;
    locked: boolean;
  };
  /** Every période of the year, so the reader can move between them. */
  calendar: { id: string; label: string; sequence: number }[];
  /** Every barème the complex has — the picker needs no second request. */
  gradingSystems: { id: string; name: string; scaleMax: string; passThreshold: string }[];
  gradingSystem: { name: string; scaleMax: string; passThreshold: string };
  lines: {
    subjectCode: string;
    subjectName: string;
    coefficient: string;
    score: string | null;
    classAvg: string | null;
    rank: number | null;
    isCompensated: boolean;
    isEliminated: boolean;
    appreciation: string | null;
  }[];
  average: string | null;
  rank: number | null;
  rankOf: number | null;
  classAvg: string | null;
  classMin: string | null;
  classMax: string | null;
  mention: string | null;
  absenceHours: string | null;
  lateCount: number | null;
  appreciation: string | null;
  decision: { kind: string; computedKind: string | null; note: string | null; decidedOn: string | null } | null;
}

/** A barème: the scale, where the pass sits, and what the mentions are. */
export interface GradingSystem {
  id: string;
  name: string;
  scaleMax: string;
  passThreshold: string;
  resitBandLow: string | null;
  progressionModel: string;
  mentionBands: { min: number; label: string }[] | null;
  links: {
    orgUnitId: string;
    orgUnitName: string;
    academicYearId: string;
    isOfficial: boolean;
  }[];
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
  /** Changes an evaluation that is still open. Omitted fields are left alone. */
  updateAssessment: (
    id: string,
    patch: {
      title?: string | null;
      assessmentTypeId?: string;
      weight?: number | null;
      maxScore?: number;
    },
  ) =>
    request<Assessment>(`/grading/assessments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /**
   * Removes it. `withMarks` is the caller saying what it destroys.
   *
   * A POST rather than a DELETE, like the timetable's: the browser reported a
   * bare DELETE as unreachable, and this one carries a body anyway.
   */
  deleteAssessment: (id: string, withMarks = false) =>
    request<{ deleted: boolean; marks: number }>(
      `/grading/assessments/${encodeURIComponent(id)}/delete`,
      { method: "POST", body: JSON.stringify({ withMarks }) },
    ),

  /** The teacher declares the column finished — refused while anyone is missing. */
  submitAssessment: (id: string) =>
    request<Assessment>(`/grading/assessments/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  /** Hands it back to the teacher. Takes grading.issue, not grading.write. */
  reopenAssessment: (id: string) =>
    request<Assessment>(`/grading/assessments/${encodeURIComponent(id)}/reopen`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  /** One pupil's bulletin — the frozen one if it exists, else the council's. */
  bulletin: (studentId: string, periodId?: string | null, gradingSystemId?: string | null) =>
    request<Bulletin>(
      `/grading/bulletin?studentId=${encodeURIComponent(studentId)}` +
        (periodId ? `&periodId=${encodeURIComponent(periodId)}` : "") +
        (gradingSystemId ? `&gradingSystemId=${encodeURIComponent(gradingSystemId)}` : ""),
    ),

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

  /** What this complex charges for — inscription, scolarité, frais d'examen. */
  feeTypes: () =>
    request<{ id: string; code: string; name: string; recurrence: string }[]>(
      "/finance/fee-types",
    ),

  /**
   * Everyone the operator may take money for — not only the debtors.
   *
   * A family paying an inscription in advance owes nothing and is on no
   * impayés list; a payment screen built off that list could not serve them.
   */
  payable: (academicYearId: string, q?: string) =>
    request<Payable[]>(
      `/finance/payable?academicYearId=${encodeURIComponent(academicYearId)}` +
        (q ? `&q=${encodeURIComponent(q)}` : ""),
    ),

  /** Issue this pupil's facture, or hand back the one that exists. */
  issueInvoice: (studentId: string, academicYearId: string) =>
    request<{ id: string; number: string; totalXaf: number; paidXaf: number }>(
      `/finance/students/${encodeURIComponent(studentId)}/invoice`,
      { method: "POST", body: JSON.stringify({ academicYearId }) },
    ),

  /** One classe's finance sheet, with the tranches the modalité implies. */
  classeLedger: (classeId: string, academicYearId: string) =>
    request<ClasseLedger>(
      `/finance/classe-ledger?classeId=${encodeURIComponent(classeId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /** One pupil's échéancier and every règlement against it. */
  studentLedger: (studentId: string, academicYearId?: string) =>
    request<StudentLedger>(
      `/finance/student/${encodeURIComponent(studentId)}` +
        (academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : ""),
    ),

  /** The debtor worklist, most overdue first. */
  unpaid: (academicYearId: string) =>
    request<Unpaid>(`/finance/unpaid?academicYearId=${encodeURIComponent(academicYearId)}`),

  /**
   * Takes money.
   *
   * Name the pupil and the year, not the facture — that is what the person at
   * the guichet has. The API finds the facture, allocates, writes the receipt
   * and answers with what is left, so the slip and the screen cannot disagree.
   */
  recordPayment: (body: {
    studentId?: string;
    academicYearId?: string;
    invoiceId?: string;
    /** What the règlement is for — one of the complex's declared fee types. */
    feeTypeId?: string;
    amountXaf: number;
    method: PaymentMethod;
    reference?: string;
    receivedAt?: string;
  }) =>
    request<{
      payment: { id: string; amountXaf: number; receivedAt: string };
      receipt: { id: string; number: string };
      /**
       * True when there was no facture to put it against — an avance.
       *
       * Never an error. The API issues the facture itself when a grille
       * applies, and books the money as an avance when none does; either way
       * the parent walks away with a numbered receipt.
       */
      unallocated: boolean;
      invoice: {
        id: string | null; number: string | null; status: string;
        totalXaf: number; paidXaf: number; balanceXaf: number; creditXaf: number;
      };
    }>("/finance/payments", { method: "POST", body: JSON.stringify(body) }),

  /** Everything the printed slip carries. Reading is not printing. */
  receipt: (paymentId: string) =>
    request<ReceiptDoc>(`/finance/payments/${encodeURIComponent(paymentId)}/receipt`),

  /** Records that a copy was actually handed over — the count is evidence. */
  markReceiptPrinted: (receiptId: string) =>
    request<{ number: string; printCount: number }>(
      `/finance/receipts/${encodeURIComponent(receiptId)}/printed`,
      { method: "POST" },
    ),
};

export type PaymentMethod =
  | "CASH" | "MTN_MOMO" | "AIRTEL_MONEY" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";

export const PAYMENT_METHOD_FR: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  MTN_MOMO: "MTN MoMo",
  AIRTEL_MONEY: "Airtel Money",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  OTHER: "Autre",
};

/** Where one tranche stands. DUE is simply not yet paid and not yet late. */
export type TrancheState = "PAID" | "PARTIAL" | "LATE" | "DUE" | "NONE";

export interface Tranche {
  number: number;
  label: string;
  dueOn: string;
  dueXaf: number;
  paidXaf: number;
  balanceXaf: number;
  state: TrancheState;
}

/** The cadence a school announced, as it applies here. */
export interface LedgerPolicy {
  modality: PaymentModality;
  installments: number;
  dueDayOfMonth: number | null;
  graceDays: number;
  notes: string | null;
}

export interface ClasseLedger {
  year: { id: string; label: string };
  /** Null when nobody has declared one — the sheet says so rather than guessing. */
  policy: LedgerPolicy | null;
  tranches: { number: number; label: string; dueOn: string }[];
  rows: {
    studentId: string;
    matricule: string;
    lastName: string;
    firstName: string;
    invoiceCount: number;
    billedXaf: number;
    paidXaf: number;
    balanceXaf: number;
    paymentCount: number;
    lastPaymentOn: string | null;
    lastPaymentXaf: number | null;
    lastPaymentMethod: string | null;
    byTranche: Tranche[];
    state: "CLEAR" | "PARTIAL" | "LATE" | "NONE";
  }[];
  totals: { billedXaf: number; paidXaf: number; balanceXaf: number; lateCount: number };
}

export interface StudentLedger {
  student: { id: string; personId: string; matricule: string; firstName: string; lastName: string };
  classe: { id: string; name: string };
  year: { id: string; label: string };
  policy: LedgerPolicy | null;
  tranches: Tranche[];
  invoices: {
    id: string; number: string; status: string;
    totalXaf: number; paidXaf: number; balanceXaf: number;
    issuedOn: string | null; dueOn: string | null;
    lines: { id: string; label: string; amountXaf: number; installment: number; dueOn: string | null }[];
  }[];
  payments: {
    id: string;
    amountXaf: number;
    method: PaymentMethod;
    reference: string | null;
    receivedAt: string;
    invoiceNumber: string | null;
    /** What it was for, when the operator said so. */
    purpose: string | null;
    /** Taken before any facture existed — still waiting on one. */
    isAdvance: boolean;
    receipt: { id: string; number: string; issuedAt: string; printCount: number } | null;
  }[];
  totals: {
    billedXaf: number; paidXaf: number; balanceXaf: number; creditXaf: number;
    /** Received with no facture against it. Zero once one is issued. */
    advanceXaf: number;
  };
  /** No facture at all for the year. */
  needsInvoice: boolean;
  /** Whether one could be issued now — false when no grille applies. */
  canIssueInvoice: boolean;
}

/** A pupil the guichet can take money for. */
export interface Payable {
  studentId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  classe: { id: string; name: string };
  hasInvoice: boolean;
  billedXaf: number;
  paidXaf: number;
  balanceXaf: number;
  /** Money already received with no facture against it. */
  advanceXaf: number;
}

export interface Unpaid {
  rows: {
    invoiceId: string;
    number: string;
    studentId: string;
    matricule: string;
    lastName: string;
    firstName: string;
    guardianName: string | null;
    guardianPhone: string | null;
    classe: { id: string; name: string } | null;
    totalXaf: number;
    paidXaf: number;
    balanceXaf: number;
    /** What is late RIGHT NOW against the modalité — not the whole balance. */
    overdueXaf: number;
    daysLate: number;
    nextDueOn: string | null;
    lastPaymentOn: string | null;
    lastPaymentXaf: number | null;
    state: "LATE" | "PARTIAL" | "DUE";
  }[];
  totals: { count: number; balanceXaf: number; lateXaf: number };
}

/** One receipt, as the API assembled it. Never recomputed client-side. */
export interface ReceiptDoc {
  receipt: { id: string; number: string; issuedAt: string; printCount: number };
  school: { name: string };
  student: {
    id: string; matricule: string; firstName: string; lastName: string; classe: string | null;
  } | null;
  year: { label: string } | null;
  invoice: { number: string; totalXaf: number } | null;
  payment: {
    id: string;
    amountXaf: number;
    /** The figure written out, which is what makes a slip hard to alter. */
    amountWords: string;
    method: PaymentMethod;
    reference: string | null;
    receivedAt: string;
    /** Inscription, scolarité, frais d'examen — named on the slip. */
    purpose: string | null;
  };
  standing: {
    /** No facture behind it: the school is holding this money. */
    isAdvance: boolean;
    totalXaf: number; paidToDateXaf: number; remainingXaf: number; creditXaf: number;
  };
}

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

/**
 * How often a family is expected to pay — the minimum cadence a school accepts.
 *
 * MENSUEL is nine instalments, not twelve: the school year runs October to July.
 */
export type PaymentModality =
  | "ANNUEL_UNIQUE"
  | "ANNUEL"
  | "SEMESTRIEL"
  | "TRIMESTRIEL"
  | "MENSUEL";

export const PAYMENT_MODALITY_FR: Record<PaymentModality, string> = {
  ANNUEL_UNIQUE: "Annuel — payé à l'inscription",
  ANNUEL: "Annuel — une échéance",
  SEMESTRIEL: "Semestriel — 2 échéances",
  TRIMESTRIEL: "Trimestriel — 3 échéances",
  MENSUEL: "Mensuel — 9 échéances",
};

export interface PaymentPolicy {
  id: string;
  orgUnitId: string;
  academicYearId: string | null;
  modality: PaymentModality;
  installments: number;
  dueDayOfMonth: number | null;
  graceDays: number;
  notes: string | null;
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
    /** Which cycles or schools run this year. At least one — see the API. */
    orgUnitIds: string[];
  }) => request<AcademicYear>("/academics/years", { method: "POST", body: JSON.stringify(body) }),

  yearScopes: (id: string) =>
    request<{ id: string; name: string; kind: OrgUnitKind }[]>(`/academics/years/${id}/scopes`),

  /** The payment cadence in force for a unit, inherited from its ancestors. */
  paymentPolicy: (orgUnitId: string, academicYearId?: string) =>
    request<PaymentPolicy | null>(
      `/academics/payment-policy?orgUnitId=${encodeURIComponent(orgUnitId)}` +
        (academicYearId ? `&academicYearId=${encodeURIComponent(academicYearId)}` : ""),
    ),

  setPaymentPolicy: (body: {
    orgUnitId: string;
    academicYearId?: string | null;
    modality: PaymentModality;
    installments?: number;
    dueDayOfMonth?: number | null;
    graceDays?: number;
    notes?: string | null;
  }) =>
    request<PaymentPolicy>("/academics/payment-policy", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  subjects: () => request<Subject[]>("/academics/subjects"),
  createSubject: (body: { code: string; name: string }) =>
    request<Subject>("/academics/subjects", { method: "POST", body: JSON.stringify(body) }),

  createPeriod: (body: {
    orgUnitId: string;
    academicYearId: string;
    // ANNEE exists in the schema for préscolaire rows the scaffold writes; the
    // console creates trimestres and semestres only. See the API's PeriodBody.
    kind?: "TRIMESTRE" | "SEMESTRE";
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
  /**
   * The types usable AT a unit: the complex's shared ones plus that school's
   * or cycle's own. Without the argument, the whole catalogue — which is what
   * a settings screen wants and what a mark-entry form must never get.
   */
  assessmentTypes: (orgUnitId?: string | null) =>
    request<AssessmentType[]>(
      "/academics/assessment-types" +
        (orgUnitId ? `?orgUnitId=${encodeURIComponent(orgUnitId)}` : ""),
    ),

  // ── grading systems ──
  gradingSystems: (academicYearId?: string) =>
    request<GradingSystem[]>(
      "/academics/grading-systems" +
        (academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : ""),
    ),

  createGradingSystem: (body: {
    name: string;
    /** Omitted entirely for a system built from scratch. */
    template?: "SECONDAIRE_20" | "PRIMAIRE_10" | "LMD";
    scaleMax?: number;
    passThreshold?: number;
    resitBandLow?: number | null;
    eliminatoryFloor?: number | null;
    progressionModel?: "REDOUBLEMENT" | "CAPITALISATION";
    mentionBands?: { min: number; label: string }[] | null;
  }) =>
    request<{ id: string; name: string }>("/academics/grading-systems", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Makes one official for a school or cycle. Exactly one per (unit, year). */
  linkGradingSystem: (body: {
    gradingSystemId: string;
    orgUnitId: string;
    academicYearId: string;
    isOfficial?: boolean;
  }) =>
    request<{ id: string }>("/academics/grading-systems/link", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  periods: (orgUnitId: string, academicYearId: string) =>
    request<Period[]>(
      `/academics/periods?orgUnitId=${encodeURIComponent(orgUnitId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),
};
