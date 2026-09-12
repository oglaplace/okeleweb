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

/**
 * HEURES ET PAIE — the hourly half of a payroll, computed rather than guessed.
 *
 * `baseAmountXaf` is a monthly gross for a PERMANENT and an HOURLY RATE for a
 * VACATAIRE, so the second one means nothing until it is multiplied by hours.
 * The API works those out from the published timetable, corrected by whatever
 * séances the school pointed (annulations subtract, remplacements add), and
 * says which basis it used. `costXaf` is the gross plus employer charges —
 * what the school actually spends, which is never what the teacher receives.
 */
export interface Workload {
  from: string;
  to: string;
  year: { id: string; label: string } | null;
  rows: {
    employmentId: string;
    personId: string;
    lastName: string;
    firstName: string;
    type: StaffMember["type"];
    /** Monthly gross, or the hourly rate — read `payBasis`. */
    rateXaf: number;
    plannedMinutes: number;
    /** Heures pointées que la grille ne promettait pas (remplacement, rattrapage). */
    extraMinutes: number;
    /** Heures promises par la grille qu'une séance annulée a reprises. */
    cancelledMinutes: number;
    taughtMinutes: number;
    /** EXCEPTIONS = la grille corrigée par les séances pointées. */
    hoursBasis: "SESSIONS" | "EXCEPTIONS" | "TIMETABLE" | "NONE";
    payBasis: "HOURLY" | "FIXED";
    payableMinutes: number;
    /** Brut — ce que touche l'enseignant. */
    payXaf: number;
    /** Brut + charges patronales — ce que ça coûte à l'école. */
    costXaf: number;
    slots: number;
    /** Créneaux skipped because their classe's week is still a draft. */
    draftSlots: number;
  }[];
  /** What would make these figures wrong, in the API's own words. */
  notes: string[];
  /** Employer charges as a fraction of gross — so the screen can name it. */
  chargeRate: number;
  hoursMode: "TIMETABLE" | "SESSIONS";
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

  /**
   * Hours and pay over a range. `from`/`to` are ISO dates, inclusive.
   *
   * Behind finance.read: this answers in francs, and a censeur who may post a
   * teacher has no business reading what the school pays them.
   */
  workload: (
    from: string,
    to: string,
    opts: { orgUnitId?: string; employmentId?: string } = {},
  ) => {
    const q = new URLSearchParams({ from, to });
    if (opts.orgUnitId) q.set("orgUnitId", opts.orgUnitId);
    if (opts.employmentId) q.set("employmentId", opts.employmentId);
    return request<Workload>(`/people/workload?${q}`);
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
  /** The one the school declared current — the sheet opens on it. */
  current?: boolean;
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
  /** Line by line, so the confirmation can say what a week is becoming. */
  diff: WeekDiff;
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

/**
 * THE ONE CALL THAT NEEDS NO ACCOUNT.
 *
 * A printed bulletin is checked where nobody can sign in. The token in the URL
 * is the capability and it names exactly one frozen document.
 */
export const publicApi = {
  bulletin: (token: string) =>
    request<PublicBulletin>(`/public/bulletins/${encodeURIComponent(token)}`, { auth: false }),
};

/** The meeting that validated the document — printed on it, and verifiable. */
export interface CouncilStamp {
  /** Absent on the public page: a reader of the paper gets the date, no handle. */
  id?: string;
  heldAt: string | null;
  status: "OPEN" | "DELIBERATED" | "CLOSED";
}

export interface PublicBulletin {
  establishment: {
    complex: string | null; school: string | null;
    department: string | null; niveau: string | null; classe: string | null;
  };
  student: { matricule: string; firstName: string; lastName: string };
  year: string;
  period: string;
  version: number;
  issuedAt: string | null;
  gradingSystem: { name: string; scaleMax: string; passThreshold: string };
  lines: {
    subjectCode: string; subjectName: string; coefficient: string;
    score: string | null; classAvg: string | null; rank: number | null;
    appreciation: string | null;
  }[];
  average: string | null;
  rank: number | null;
  rankOf: number | null;
  classAvg: string | null;
  mention: string | null;
  absenceHours: string | null;
  lateCount: number | null;
  appreciation: string | null;
  council: CouncilStamp | null;
}

export interface SubjectPlacement {
  subject: { id: string; code: string; name: string };
  niveaux: {
    niveauId: string;
    niveau: string;
    school: string | null;
    cycle: string | null;
    /** Null when the subject is not programmed there. */
    offeringId: string | null;
    weeklyHours: number | null;
  }[];
}

export interface ReinscriptionCandidates {
  year: { id: string; label: string };
  candidates: {
    studentId: string;
    matricule: string;
    lastName: string;
    firstName: string;
    from: { yearId: string; yearLabel: string; classeId: string; classe: string };
    decision: string;
    /** Where the promotion rule would put them. Null when the school must pick. */
    suggestedClasseId: string | null;
    isRepeating: boolean;
    /** Still owed on the year they are leaving — the counter's other question. */
    owesXaf: number;
  }[];
}

export interface RolloverPlan {
  from: { id: string; label: string; closedAt: string | null };
  to: { id: string; label: string };
  classes: {
    from: { id: string; name: string };
    /** The destination proposed for most of the cohort. */
    toClasseId: string | null;
    pupils: {
      studentId: string;
      matricule: string;
      lastName: string;
      firstName: string;
      fromClasse: { id: string; name: string };
      decision: string;
      alreadyEnrolled: boolean;
      isRepeating: boolean;
      toClasseId: string | null;
      /** Why this pupil is not proposed for a move. */
      blocked: "EXCLU" | "NO_DECISION" | null;
    }[];
  }[];
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
    /**
     * The money handed over at the same desk, if any.
     *
     * Sent WITH the enrolment rather than after it: the API treats the pair as
     * one act, and a refused payment undoes the inscription instead of leaving
     * a pupil on the roll whose family believes they paid. Requires
     * `finance.write` — without it the call is refused rather than silently
     * enrolling and dropping the money.
     */
    payment?: {
      amountXaf: number;
      method: PaymentMethod;
      feeTypeId?: string;
      purposeNote?: string;
      reference?: string;
    };
  }) =>
    /* `personId` comes back so the caller can attach the portrait without
       walking student → person for a field the API already had in hand. */
    request<{
      id: string; studentId: string; personId: string;
      /** All null when no payment was sent — see `payment` above. */
      payment: { id: string; amountXaf: number; receivedAt: string } | null;
      receipt: { id: string; number: string } | null;
      invoice: {
        id: string | null; number: string | null; status: string;
        totalXaf: number; paidXaf: number; balanceXaf: number; creditXaf: number;
      } | null;
    }>("/enrollment", {
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

export interface CouncilManifest {
  session: {
    id: string;
    status: "OPEN" | "DELIBERATED" | "CLOSED";
    classe: string;
    period: string;
    openedAt: string;
    closedAt: string | null;
  };
  entries: {
    id: string;
    kind:
      | "OPENED" | "SUBMITTED" | "UNLOCKED" | "MARK_CHANGED" | "DECISION"
      | "OBSERVATION" | "FROZEN" | "UNFROZEN" | "CLOSED";
    at: string;
    by: string | null;
    studentId: string | null;
    student: string | null;
    subjectId: string | null;
    subject: string | null;
    detail: unknown;
    note: string | null;
  }[];
}

export interface CouncilState {
  period: { id: string; label: string; locked: boolean };
  pupils: number;
  subjects: {
    courseOfferingId: string;
    subjectId: string;
    code: string;
    name: string;
    assessments: number;
    marked: number;
    marks: number;
    /** Still the teacher's working copy — the council must not freeze these. */
    unsubmitted: number;
    /** Every evaluation carrying marks has been handed over. */
    submitted: boolean;
  }[];
  marksIn: { subjects: number; of: number; marks: number };
  unsubmitted: number;
  decided: number;
  /** studentId → the decision already on file, so a reopened screen shows it. */
  decisions: Record<string, string>;
  frozen: number;
  /** The meeting, if one has started. Read — looking never opens a conseil. */
  session: { id: string; status: string; openedAt: string; closedAt: string | null } | null;
  observations: number;
  /** Every subject that carries marks has been handed over. */
  allSubmitted: boolean;
  /** Why the engine cannot run yet, said before it is asked. */
  blocked: "NO_PUPILS" | "NO_PROGRAMME" | "NO_MARKS" | null;
}

/** What the counter's search box answers with. */
export interface ReinscriptionLookup {
  candidates: {
    studentId: string;
    matricule: string;
    lastName: string;
    firstName: string;
    /** Where they are now — derived, never asked for. */
    enrolled: {
      complex: string | null;
      school: string | null;
      classe: { id: string; name: string };
      year: { id: string; label: string; closed: boolean };
      /**
       * The période the school DECLARED it is working in, and null when it has
       * declared none. Never deduced from today's date — see currentPeriodOf.
       */
      period: { id: string; label: string; status: string | null } | null;
    };
    /** Still owed on the year they are in. */
    owesXaf: number;
    /** Money held for them that no facture has claimed yet. */
    creditXaf: number;
    /**
     * WHERE THEY ARE GOING — a suggestion, and null when nothing can be
     * inferred honestly. It follows the last bulletin: one issued for the year
     * in progress means the pupil is already in it and keeps their classe; an
     * older one means a new year, so the niveau above.
     */
    suggestedClasseId: string | null;
    classeBasis: "SAME_YEAR" | "NEXT_LEVEL" | "UNKNOWN";
    /** Every classe the counter may choose from. */
    classes: { id: string; name: string; niveau: string | null }[];
    /** What the school charges THIS pupil, per fee type — bourses included. */
    fees: {
      id: string;
      code: string;
      name: string;
      recurrence: string;
      /** One instalment: what coming back for a période costs. */
      perTrancheXaf: number | null;
      /** The whole line for the year, after any bourse. */
      totalXaf: number | null;
      priced: boolean;
    }[];
    /** The one or two things that may be opened. Empty means `blocked` says why. */
    options: {
      kind: "PERIOD" | "YEAR";
      id: string;
      label: string;
      detail: string;
      /** Where a year move would put them. */
      classeId?: string | null;
    }[];
    blocked: string | null;
    fee: { id: string; name: string; code: string } | null;
  }[];
}

export interface PeriodRegistrationPlan {
  period: {
    id: string; label: string; sequence: number; startsOn: string; endsOn: string;
    /** Over: nothing can be réinscrit into it any more. */
    closed: boolean;
    /** Running right now — the période most pupils are already sitting in. */
    current: boolean;
  };
  year: { id: string; label: string };
  /** What coming back costs, from the grille. Null when the school prices none. */
  fee: { id: string; name: string; code: string } | null;
  classes: {
    classe: { id: string; name: string };
    pupils: {
      studentId: string;
      enrollmentId: string;
      matricule: string;
      lastName: string;
      firstName: string;
      classe: { id: string; name: string };
      status: "PENDING" | "ACTIVE" | "BLOCKED";
      activatedAt: string | null;
      paidXaf: number;
      invoice: { id: string; number: string; totalXaf: number; paidXaf: number } | null;
      /** Why the school stopped them, when it did. */
      note: string | null;
      /** False when réinscribing here would mean nothing — `reason` says why. */
      eligible: boolean;
      reason: string | null;
    }[];
  }[];
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
  /** Who it belongs to — the council screen marks the roster from it. */
  studentId: string;
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
  /**
   * What the QR on the printed bulletin encodes — see BulletinSheet.
   *
   * Present on ISSUED documents. A draft has nothing to verify, and printing a
   * code that resolves to nothing would be a claim of authenticity about a
   * working copy.
   */
  publicToken: string | null;
  /** The conseil de classe that validated it: printed, and referenced. */
  councilSession?: CouncilStamp | null;
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
  /**
   * What the QR on the printed sheet encodes — see BulletinPage.
   *
   * Present only on a document that was actually issued: a QR on a provisional
   * bulletin would be a claim of authenticity about a draft.
   */
  publicToken?: string | null;
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
  /** Only on a frozen sheet: which conseil de classe stands behind it. */
  council?: CouncilStamp | null;
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
  /**
   * Freezes the bulletins of a période.
   *
   * Pupils already frozen are SKIPPED, not refused: a council that re-runs the
   * issue after two late marks arrived gets "2 new, 28 already frozen" rather
   * than an error naming an internal function.
   */
  issue: (classeId: string, periodId: string, appreciations?: Record<string, string>) =>
    request<{ issued: number; alreadyIssued: number }>("/grading/issue", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, appreciations }),
    }),
  /**
   * WHERE THE CONSEIL DE CLASSE STANDS — a read that never throws for the
   * ordinary reasons a term is not finished.
   *
   * The council screen used to compute the class or show nothing, so a teacher
   * who opened it before every subject was marked got a roster and a button
   * saying "Saisir les notes" — the screen they had just come from.
   */
  council: (classeId: string, periodId: string) =>
    request<CouncilState>(
      `/grading/council?classeId=${encodeURIComponent(classeId)}` +
        `&periodId=${encodeURIComponent(periodId)}`,
    ),

  /**
   * THE COUNCIL'S OWN ACT — what it decided about a pupil.
   *
   * `grading.issue`, like freezing: deciding that a child repeats a year is the
   * conseil's authority, not the authority to type a mark. The engine's own
   * proposal rides along as `computedKind`, so the record keeps both what was
   * computed and what the council decided.
   */
  decide: (body: {
    studentId: string;
    academicYearId: string;
    kind: "ADMIS" | "ADMIS_SOUS_CONDITION" | "REDOUBLE" | "EXCLU" | "RATTRAPAGE" | "EN_ATTENTE";
    computedKind?: "ADMIS" | "REDOUBLE" | "RATTRAPAGE" | "EXCLU";
    note?: string;
  }) =>
    request<{ id: string; kind: string }>("/grading/decisions", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /** THE MINUTES — everything the conseil did, in order. */
  councilManifest: (classeId: string, periodId: string) =>
    request<CouncilManifest | null>(
      `/grading/council/manifest?classeId=${encodeURIComponent(classeId)}` +
        `&periodId=${encodeURIComponent(periodId)}`,
    ),

  /**
   * Hands a whole subject over — on the teacher's behalf if need be.
   *
   * `grading.issue`: doing it FOR somebody is exactly the act that belongs to
   * the chair and is written down with their name on it.
   */
  submitSubject: (classeId: string, periodId: string, courseOfferingId: string) =>
    request<{ submitted: number; sessionId: string }>("/grading/council/submit-subject", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, courseOfferingId }),
    }),

  /** Reopens one subject so the council can correct it. Reason required. */
  unlockSubject: (classeId: string, periodId: string, courseOfferingId: string, reason: string) =>
    request<{ unlocked: number; sessionId: string }>("/grading/council/unlock-subject", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, courseOfferingId, reason }),
    }),

  /** What the council wants printed on one pupil's bulletin. */
  observe: (classeId: string, periodId: string, studentId: string, text: string) =>
    request<{ sessionId: string }>("/grading/council/observation", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, studentId, text }),
    }),

  /** Reopens the frozen bulletins of a class. Always with a reason. */
  unfreeze: (classeId: string, periodId: string, reason: string) =>
    request<{ reopened: number; sessionId: string }>("/grading/council/unfreeze", {
      method: "POST",
      body: JSON.stringify({ classeId, periodId, reason }),
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

  /**
   * Both kept, and both unused by this console.
   *
   * The grille screen writes through `setTariffs`, which upserts and takes
   * many units at once; these are the single-shot originals. They stay because
   * the import path and any second client still need a way to create one fee
   * type or one schedule outright — but nothing here should reach for them.
   */
  createFeeType: (body: {
    code: string;
    name: string;
    recurrence?: "ONCE" | "PER_PERIOD" | "MONTHLY";
  } & Partial<FeeCadence>) =>
    request<{ id: string; code: string; name: string; recurrence: string }>("/finance/fee-types", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Renames one, or changes how often it recurs.
   *
   * The CODE is not editable: it is what the catalogue, the grille and the
   * projection match on, and renaming it detaches a school from its own
   * history.
   */
  updateFeeType: (
    id: string,
    patch: { name?: string; recurrence?: string } & Partial<FeeCadence>,
  ) =>
    request<{ id: string; name: string; recurrence: string }>(
      `/finance/fee-types/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

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

  /** The fee types this app ships with, marked with what is installed. */
  feeCatalogue: (stage?: "SCHOOL" | "UNIVERSITY" | "BOTH") =>
    request<FeeTypeTemplate[]>(
      "/finance/fee-types/catalogue" + (stage ? `?stage=${stage}` : ""),
    ),

  /**
   * Removes a fee type added by mistake.
   *
   * Refused with a message naming what depends on it when a grille line, a
   * règlement or a bourse still cites it — deleting then would leave both
   * pointing at nothing. The catalogue reports `removable` so the console can
   * say so before the button is pressed.
   */
  deleteFeeType: (id: string) =>
    request<{ deleted: boolean; name: string }>(
      `/finance/fee-types/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  /** Installs catalogue entries by code. Idempotent; never overwrites. */
  installFeeTypes: (codes: string[]) =>
    request<{ installed: number; skipped: number }>("/finance/fee-types/install", {
      method: "POST",
      body: JSON.stringify({ codes }),
    }),

  /** Every price in the complex for one year: units × fee types. */
  tariffs: (academicYearId: string) =>
    request<TariffGrid>(`/finance/tariffs?academicYearId=${encodeURIComponent(academicYearId)}`),

  /**
   * Releases the grille. `finance.admin` only.
   *
   * Not cosmetic: the API resolves BILLING against the released snapshot, so
   * until this is pressed the prices on screen price nobody — payments are
   * taken as avances instead.
   */
  publishTariffs: (academicYearId: string) =>
    request<{
      version: number; publishedAt: string; units: number;
      /** Pupils who had none and now do — publishing is what bills a class. */
      invoicesIssued: number;
      /** And the ones already billed, brought back in line with the new prices. */
      invoicesRepriced: number;
      revisionXaf: number;
    }>(
      "/finance/tariffs/publish",
      { method: "POST", body: JSON.stringify({ academicYearId }) },
    ),

  /** The reduction rules this complex has declared. */
  discounts: () => request<Discount[]>("/finance/discounts"),

  createDiscount: (body: {
    code: string; name: string;
    percentBps?: number | null; amountXaf?: number | null; maxAmountXaf?: number | null;
    priority?: number; stackable?: boolean;
  }) =>
    request<Discount>("/finance/discounts", { method: "POST", body: JSON.stringify(body) }),

  /** The awards one pupil holds for one year. */
  waivers: (studentId: string, academicYearId: string) =>
    request<FeeWaiver[]>(
      `/finance/waivers?studentId=${encodeURIComponent(studentId)}` +
        `&academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /**
   * Grants a reduction. `finance.admin` only.
   *
   * Answers `creditedXaf`: zero when there is no facture yet (the award simply
   * waits and is read at billing time), non-zero when one existed and was
   * credited with an avoir rather than rewritten.
   */
  grantWaiver: (body: {
    studentId: string; discountId: string; academicYearId: string;
    feeTypeId?: string | null; reason?: string;
  }) =>
    request<{ waiver: FeeWaiver; creditedXaf: number }>("/finance/waivers", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Puts one avance on a facture, where the operator says it goes.
   *
   * Undirected money is no longer swept automatically — see the API's
   * sweepAdvances. This is how it stops being credit.
   */
  allocateAdvance: (paymentId: string, body: { invoiceId: string; feeTypeId?: string }) =>
    request<{ allocated: number; invoiceId: string; paidXaf: number }>(
      `/finance/payments/${encodeURIComponent(paymentId)}/allocate`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  revokeWaiver: (id: string) =>
    request<{ revoked: boolean }>(`/finance/waivers/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    }),

  /** Withdraws it. Nothing bills against a withdrawn grille. */
  unpublishTariffs: (academicYearId: string) =>
    request<{ removed: number }>("/finance/tariffs/unpublish", {
      method: "POST",
      body: JSON.stringify({ academicYearId }),
    }),

  /**
   * Writes prices onto one unit or many.
   *
   * A null amount REMOVES the line: "we do not charge for the canteen" and
   * "the canteen is free" are different statements, and only one of them
   * belongs on a facture.
   */
  /**
   * The staff row: what the complex charges its own employees.
   *
   * Its own endpoint because it hangs off no OrgUnit, and `finance.admin`
   * rather than a unit scope — one price for every employee of the complex is
   * a complex-wide decision.
   */
  setStaffTariff: (body: {
    academicYearId: string;
    items: { feeTypeId: string; amountXaf: number | null; installments?: number }[];
  }) =>
    request<{ units: number; items: number; cleared: number }>("/finance/tariffs/staff", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  setTariffs: (body: {
    academicYearId: string;
    orgUnitIds: string[];
    serieId?: string | null;
    items: { feeTypeId: string; amountXaf: number | null; installments?: number }[];
  }) =>
    request<{ units: number; items: number; cleared: number }>("/finance/tariffs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Bills every pupil in the chosen classes against the grille. */
  issueInvoices: (academicYearId: string, classeIds: string[]) =>
    request<{
      pupils: number; issued: number; alreadyBilled: number;
      noSchedule: number; failed: number;
    }>("/finance/invoices/issue", {
      method: "POST",
      body: JSON.stringify({ academicYearId, classeIds }),
    }),

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

  /**
   * The debtor worklist, most exigible first — a page at a time.
   *
   * Paged at the API rather than in the browser: a complex of a thousand
   * pupils has close to a thousand outstanding factures in janvier, and the
   * console runs on a connection where that payload is the whole wait. The
   * totals that come back are over EVERYONE, not over the page.
   */
  unpaid: (
    academicYearId: string,
    page?: { limit?: number; offset?: number; scope?: "due" | "late" | "all"; q?: string },
  ) =>
    request<Unpaid>(
      `/finance/unpaid?academicYearId=${encodeURIComponent(academicYearId)}` +
        (page?.limit !== undefined ? `&limit=${page.limit}` : "") +
        (page?.offset ? `&offset=${page.offset}` : "") +
        (page?.scope ? `&scope=${page.scope}` : "") +
        (page?.q ? `&q=${encodeURIComponent(page.q)}` : ""),
    ),

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
    /** The motif in words, for "Autre". */
    purposeNote?: string;
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
    /** What a facture WOULD say, for a pupil who has none yet. Null once billed. */
    projectedXaf: number | null;
    /** What should have been paid by today — never the whole year. */
    dueNowXaf: number;
    paymentCount: number;
    lastPaymentOn: string | null;
    lastPaymentXaf: number | null;
    lastPaymentMethod: string | null;
    byTranche: Tranche[];
    state: "CLEAR" | "PARTIAL" | "LATE" | "NONE" | "FORECAST";
  }[];
  totals: {
    billedXaf: number; paidXaf: number; balanceXaf: number;
    /** Facturé plus prévision — what the classe is worth for the year. */
    expectedXaf: number;
    dueNowXaf: number;
    lateCount: number;
    forecastCount: number;
  };
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
    /**
     * What has actually fallen due, as distinct from what the year costs.
     *
     * A parent in November owes the tranches that have come due, not the June
     * one; the annual figure answers a question nobody at the guichet asks.
     */
    dueNowXaf: number;
  };
  /** No facture at all for the year. */
  needsInvoice: boolean;
  /** Whether one could be issued now — false when no grille applies. */
  canIssueInvoice: boolean;
  /**
   * The reductions this pupil holds.
   *
   * A facture whose total is below the grille has to explain itself, or the
   * first person to check the arithmetic assumes a mistake.
   */
  waivers: {
    id: string; name: string; code: string;
    percentBps: number | null; amountXaf: number | null;
    feeType: string | null; reason: string | null; grantedAt: string;
  }[];
  /**
   * WHAT THIS PUPIL WILL OWE, before anybody issues anything.
   *
   * Null once a facture exists. The question is answerable the moment the
   * grille, the modalité and the fee types are set, so it is answered —
   * issuing stays a deliberate act, but the information is never withheld.
   */
  projection: {
    totalXaf: number;
    grossXaf: number;
    waivedXaf: number;
    lines: {
      feeTypeId: string; feeType: string;
      grossXaf: number; waivedXaf: number; amountXaf: number;
      installments: number; perTrancheXaf: number[];
    }[];
    tranches: { number: number; label: string; dueOn: string }[];
  } | null;
}

/** One entry of the shipped fee-type catalogue. */
/**
 * LA MODALITÉ D'UN TYPE DE FRAIS — when it falls due, and in how many pieces.
 *
 * Every field null means "follow the school's policy". COMPTANT overrides the
 * rest: payable on presentation, one tranche, dated from the facture itself.
 */
export interface FeeCadence {
  modality: PaymentModality | null;
  installments: number | null;
  dueDayOfMonth: number | null;
  graceDays: number | null;
}

export interface FeeTypeTemplate extends FeeCadence {
  code: string;
  name: string;
  recurrence: "ONCE" | "PER_PERIOD" | "MONTHLY";
  stage: "SCHOOL" | "UNIVERSITY" | "BOTH";
  detail: string;
  installed: boolean;
  /** The tenant's own FeeType id, once installed. */
  id: string | null;
  /** False when a grille line, a règlement or a bourse cites it. */
  removable: boolean;
}

/** A reusable reduction rule: fratrie, bourse d'État, cas social. */
export interface Discount {
  id: string;
  code: string;
  name: string;
  /** Basis points, so 12.5% needs no float. */
  percentBps: number | null;
  amountXaf: number | null;
  /** Ceiling on what a percentage may take off one line. */
  maxAmountXaf: number | null;
  priority: number;
  stackable: boolean;
}

/** The award: this pupil, this year, this rule, decided by this person. */
export interface FeeWaiver {
  id: string;
  studentId: string;
  discountId: string;
  academicYearId: string;
  /** Null = every line. Set = only that kind of fee. */
  feeTypeId: string | null;
  grantedBy: string | null;
  grantedAt: string;
  reason: string | null;
  revokedAt: string | null;
  discount: Discount;
  feeType: { id: string; name: string } | null;
}

/** One line of "what would change if this were published now". */
export interface TariffDiff {
  /** Never released: everything is new, so an empty diff is still publishable. */
  firstPublication: boolean;
  entries: {
    kind: "ADDED" | "CHANGED" | "REMOVED";
    unit: string;
    feeType: string;
    from: number | null;
    to: number | null;
    fromInstallments: number | null;
    toInstallments: number | null;
  }[];
  added: number;
  changed: number;
  removed: number;
}

/** The same shape for a week: where on the grid, and what it becomes. */
export interface WeekDiff {
  firstPublication: boolean;
  entries: {
    kind: "ADDED" | "CHANGED" | "REMOVED";
    /** "Mardi 08:00–10:00" — where on the grid, in the operator's terms. */
    when: string;
    from: string | null;
    to: string | null;
  }[];
  added: number;
  changed: number;
  removed: number;
}

/** The grille tarifaire as a grid: units down, fee types across. */
/**
 * The id the staff tariff carries on the wire.
 *
 * It is not an OrgUnit: the row belongs to no level of study, and the API
 * stores it with no unit at all. Writes for it go to `setStaffTariff`, never to
 * `setTariffs` — the scope guard there resolves ids to units and would refuse.
 */
export const STAFF_UNIT_ID = "employees";

export interface TariffGrid {
  /**
   * Where publication stands, or null when nothing was ever released.
   *
   * `hasUnpublishedChanges` is computed server-side by comparing the draft
   * against the frozen snapshot — not a stored flag, which would need
   * maintaining on every write path and would lie the first time one was missed.
   */
  publication: {
    version: number;
    publishedAt: string;
    publishedBy: string | null;
    hasUnpublishedChanges: boolean;
  } | null;
  /**
   * WHAT PUBLISHING WOULD CHANGE — the question in front of the button.
   *
   * An empty `entries` on a grille that has been published before means there
   * is nothing to release, and the API refuses that too: a version number is
   * quoted to parents, and a bump that changes no price makes it lie.
   */
  diff: TariffDiff;
  feeTypes: { id: string; code: string; name: string; recurrence: string }[];
  /**
   * THE WHOLE TREE, root included — not just the units that can carry a price.
   *
   * You cannot see that the 6e costs more than the 5e without seeing they are
   * siblings, and you cannot see that at all unless the hierarchy is drawn.
   * `priceable` says which rows may take a figure; the rest place them.
   */
  units: {
    id: string;
    name: string;
    /**
     * "STAFF" is the one row that is not an OrgUnit — see STAFF_UNIT_ID. The
     * API filters the rest down to the path a pupil sits on, so a direction or
     * a comptabilité never appears here.
     */
    kind: OrgUnitKind | "STAFF";
    parentId: string | null;
    code: string | null;
    priceable: boolean;
  }[];
  series: { id: string; code: string; name: string }[];
  schedules: {
    id: string;
    orgUnitId: string;
    serieId: string | null;
    name: string;
    items: { feeTypeId: string; amountXaf: number; installments: number }[];
  }[];
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
    /**
     * EXIGIBLE: every tranche whose date has passed, grace period included.
     *
     * Wider than `overdueXaf` and narrower than `balanceXaf`, and the one the
     * list is ordered and filtered by — it is what can legitimately be
     * collected today.
     */
    dueNowXaf: number;
    daysLate: number;
    nextDueOn: string | null;
    lastPaymentOn: string | null;
    lastPaymentXaf: number | null;
    state: "LATE" | "PARTIAL" | "DUE";
  }[];
  totals: {
    count: number; balanceXaf: number; lateXaf: number; dueNowXaf: number;
    /** Everyone outstanding, before the scope filter. */
    allCount: number;
  };
  /** Where this page sits in the whole set — see `unpaid`. */
  page: { limit: number; offset: number; total: number };
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
  /**
   * NON-NULL on the ONE période the school declared current for its calendar.
   *
   * Every screen used to work this out from today's date and they could
   * disagree with each other on the same afternoon. See `currentPeriodOf`,
   * which is now the single answer to "which période does this open on?".
   */
  activatedAt?: string | null;
}

/**
 * WHICH PÉRIODE A SCREEN OPENS ON — one answer, everywhere.
 *
 * The school's declaration first. Null when nothing is current, and that is
 * deliberately not papered over: a screen that quietly falls back to the first
 * trimestre writes marks into a term that ended in décembre. Callers show
 * `NO_CURRENT_PERIOD` instead and send the operator to activate one.
 */
export function currentPeriodOf(list: Period[]): Period | null {
  return list.find((p) => p.activatedAt) ?? null;
}

/** Every période an établissement runs, grouped by the unit that owns it. */
export interface Calendar {
  year: { id: string; label: string; isCurrent: boolean; closed: boolean } | null;
  years: { id: string; label: string; isCurrent: boolean; closed: boolean }[];
  groups: {
    orgUnit: { id: string; name: string; kind: string };
    periods: {
      id: string;
      label: string;
      kind: string;
      sequence: number;
      startsOn: string;
      endsOn: string;
      locked: boolean;
      current: boolean;
      activatedAt: string | null;
    }[];
  }[];
  /** False when nothing is current anywhere in this scope. */
  hasCurrent: boolean;
}

/**
 * How often a family is expected to pay — the minimum cadence a school accepts.
 *
 * MENSUEL is nine instalments, not twelve: the school year runs October to July.
 */
export type PaymentModality =
  /** Payable on presentation, one tranche, dated from the facture itself. */
  | "COMPTANT"
  | "ANNUEL_UNIQUE"
  | "ANNUEL"
  | "SEMESTRIEL"
  | "TRIMESTRIEL"
  | "MENSUEL";

export const PAYMENT_MODALITY_FR: Record<PaymentModality, string> = {
  COMPTANT: "Comptant — dû à l'émission, en une fois",
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
  /** Set once the year is over — see closeYear. Null while it is running. */
  closedAt?: string | null;
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
  /**
   * Ends a year: no longer current, marks final.
   *
   * Refused while a période is still open — marks that can still change are
   * not a year anybody can close.
   */
  closeYear: (id: string) =>
    request<AcademicYear>(`/academics/years/${encodeURIComponent(id)}/close`, { method: "POST" }),

  /**
   * RÉINSCRIPTION AT A PÉRIODE BOUNDARY — the university case.
   *
   * A semester ends, the students opt into the next one, and the fee is an
   * ordinary facture from the grille. The year rollover below is the other
   * shape of the same act.
   */
  periodRegistration: (periodId: string) =>
    request<PeriodRegistrationPlan>(
      `/academics/periods/${encodeURIComponent(periodId)}/registration`,
    ),

  registerPeriod: (
    periodId: string,
    studentIds: string[],
    opts?: { status?: "ACTIVE" | "BLOCKED" | "PENDING"; note?: string },
  ) =>
    request<{
      activated: number; unchanged: number; notEnrolled: number;
      /** Already registered, or already past this période — with the words. */
      refused: { studentId: string; code: string; message: string }[];
    }>(
      `/academics/periods/${encodeURIComponent(periodId)}/registration`,
      { method: "POST", body: JSON.stringify({ studentIds, ...opts }) },
    ),

  /**
   * THE YEAR BOUNDARY, for a pupil who already exists.
   *
   * Same endpoint as an inscription and the same promise — the API takes the
   * enrolment and the money as one act — with `studentId` instead of a person:
   * this pupil has been at the school for years, and creating them again would
   * be a second file for the same child.
   */
  reinscribeYear: (body: {
    studentId: string;
    academicYearId: string;
    classeId: string;
    isRepeating?: boolean;
    payment?: {
      amountXaf: number;
      method: PaymentMethod;
      feeTypeId?: string;
      reference?: string;
    };
  }) =>
    request<{
      id: string; studentId: string;
      payment: { id: string; amountXaf: number } | null;
      receipt: { id: string; number: string } | null;
      invoice: {
        id: string | null; number: string | null;
        totalXaf: number; paidXaf: number; balanceXaf: number; creditXaf: number;
      } | null;
    }>("/enrollment", { method: "POST", body: JSON.stringify(body) }),

  /**
   * ONE STUDENT COMING BACK, and the fee taken with them — atomically.
   *
   * Réinscription is sanctioned by a payment, the way inscription is: the two
   * land together or neither does. `payment` omitted is the school that prices
   * no activation fee.
   */
  reinscribePeriod: (
    periodId: string,
    studentId: string,
    opts?: {
      note?: string;
      payment?: {
        amountXaf: number;
        method: PaymentMethod;
        feeTypeId?: string;
        purposeNote?: string;
        reference?: string;
      };
    },
  ) =>
    request<{
      registered: boolean;
      payment: { id: string; amountXaf: number } | null;
      receipt: { id: string; number: string } | null;
      /**
       * What the money did to the ledger — the API's answer, not the form's
       * arithmetic. An over-payment lands as `creditXaf`, a short one leaves
       * `balanceXaf` owing, and the confirmation says which.
       */
      invoice: {
        id: string; number: string;
        totalXaf: number; paidXaf: number; balanceXaf: number; creditXaf: number;
      } | null;
    }>(
      `/academics/periods/${encodeURIComponent(periodId)}/reinscription`,
      { method: "POST", body: JSON.stringify({ studentId, ...opts }) },
    ),

  /**
   * WHO MAY BE RÉINSCRIT — one pupil at a time, found by name or matricule.
   *
   * A rentrée moves six hundred together; the counter in septembre serves one
   * family. Eligibility is the same rule for both: enrolled in an earlier year,
   * not yet in the target one.
   */
  reinscriptionCandidates: (toYearId: string, q?: string) =>
    request<ReinscriptionCandidates>(
      `/academics/reinscription/candidates?toYearId=${encodeURIComponent(toYearId)}` +
        (q ? `&q=${encodeURIComponent(q)}` : ""),
    ),

  /** What the rentrée would look like. Computed, nothing written. */
  rolloverPlan: (fromYearId: string, toYearId: string) =>
    request<RolloverPlan>(
      `/academics/years/${encodeURIComponent(fromYearId)}/rollover` +
        `?toYearId=${encodeURIComponent(toYearId)}`,
    ),

  /** And writes it, exactly as it was approved on screen. */
  /**
   * ONE SEARCH BOX: a matricule (dashes optional) or a name.
   *
   * The answer carries where the pupil IS — école, année, période — and the one
   * or two things they may legitimately be réinscrit into. Nothing to pick
   * before typing; see the API's reinscriptionLookup.
   */
  reinscriptionLookup: (q: string, limit?: number) =>
    request<ReinscriptionLookup>(
      `/academics/reinscription/lookup?q=${encodeURIComponent(q)}` +
        (limit ? `&limit=${limit}` : ""),
    ),

  rollover: (
    toYearId: string,
    moves: { studentId: string; toClasseId: string; isRepeating?: boolean }[],
  ) =>
    request<{ enrolled: number; alreadyEnrolled: number; failed: number }>(
      `/academics/years/${encodeURIComponent(toYearId)}/rollover`,
      { method: "POST", body: JSON.stringify({ moves }) },
    ),

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
  /**
   * WHERE ONE SUBJECT IS TAUGHT — every niveau, with the offering where there
   * is one.
   *
   * The catalogue is complex-wide and the programming is per niveau, which is
   * the right model and the wrong shape for "where do we teach maths?".
   */
  subjectPlacement: (subjectId: string, academicYearId: string) =>
    request<SubjectPlacement>(
      `/academics/subjects/${encodeURIComponent(subjectId)}/placement` +
        `?academicYearId=${encodeURIComponent(academicYearId)}`,
    ),

  /** Renames a subject. The code stays — marks and bulletins cite it. */
  updateSubject: (id: string, name: string) =>
    request<{ id: string; code: string; name: string }>(
      `/academics/subjects/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    ),

  /** Unprogrammes a subject from a niveau. Refused once marks cite it. */
  deleteOffering: (id: string) =>
    request<{ deleted: boolean }>(`/academics/offerings/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  createSubject: (body: { code: string; name: string }) =>
    request<Subject>("/academics/subjects", { method: "POST", body: JSON.stringify(body) }),

  /**
   * THE WHOLE CALENDAR of an établissement — every période grouped by the unit
   * that owns it, with what is current and what is locked.
   */
  calendar: (orgUnitId: string, academicYearId?: string) =>
    request<Calendar>(
      `/academics/calendar?orgUnitId=${encodeURIComponent(orgUnitId)}` +
        (academicYearId ? `&academicYearId=${encodeURIComponent(academicYearId)}` : ""),
    ),

  /** Makes one période THE current one for its calendar. */
  activatePeriod: (periodId: string) =>
    request<Period>(`/academics/periods/${encodeURIComponent(periodId)}/activate`,
                    { method: "PATCH" }),

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

  /** The correction path after a conseil — see the calendar screen. */
  unlockPeriod: (id: string) =>
    request<Period>(`/academics/periods/${id}/unlock`, { method: "PATCH" }),

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
