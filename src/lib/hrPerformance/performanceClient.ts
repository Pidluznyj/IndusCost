/**
 * Cliente do navegador para Desempenho, Cultura e Potencial. Sem regra de negócio:
 * só chamadas e tipos das respostas. Toda decisão fica no servidor.
 */
import type { PerformanceRules } from "./performanceDomain";

const NO_STORE = { cache: "no-store" as const, credentials: "same-origin" as const };

export class PerformanceApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...NO_STORE, ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new PerformanceApiError("Sem conexão com o servidor. Confira a rede e tente de novo.", "NETWORK", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PerformanceApiError(body.message || body.error || "Não foi possível concluir.", body.error || "ERROR", response.status);
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) => json<T>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown = {}) => json<T>(path, { method: "PUT", body: JSON.stringify(body) });
const BASE = "/api/hr/performance";

// ------------------------------------------------------------------ acesso
export type PerformanceCapabilities = {
  view: boolean;
  evaluate: boolean;
  manage: boolean;
  calibrate: boolean;
  report: boolean;
  invites: boolean;
  conduct: boolean;
  /** Central de acompanhamento (toda a organização, só situação). */
  track?: boolean;
  trackExport?: boolean;
  cycles?: boolean;
  models?: boolean;
  /** Notas e conteúdo de resultado de toda a organização. */
  results?: boolean;
  calibrationView?: boolean;
  homologate?: boolean;
  /** Classificar, inativar, reativar e excluir ciclo de teste: só o SUPER_ADMIN. */
  lifecycle?: boolean;
};

// ------------------------------------------------------------------ central de acompanhamento
export type ObligationStatus = "NOT_APPLICABLE" | "PENDING" | "STARTED" | "SUBMITTED" | "OVERDUE" | "DONE";
export type ObligationKey = "self" | "leader" | "upward" | "leadershipSelf" | "superior" | "calibration" | "leadershipCalibration" | "homologation" | "feedback";
export type TrackingObligation = { key: ObligationKey; status: ObligationStatus; responsible: string | null; dueAt: string | null; reason: string | null; at: string | null };
export type TrackingRow = {
  participantId: string;
  employeeId: string;
  employeeName: string;
  roleName: string;
  departmentName: string;
  directorateName: string;
  managerName: string | null;
  managerSource: string;
  eligibility: string;
  isLeader: boolean;
  selfAssignmentId: string | null;
  journeyStarted: boolean;
  journeyDone: boolean;
  obligations: TrackingObligation[];
};
export type CoverageRow = { group: string; eligible: number; completed: number; leaderCompleted: number };
export type TrackingBoard = {
  cycle: { id: string; name: string; status: string; periodLabel: string; selfDueAt: string; leaderDueAt: string; classification: string; activation: string; leadership: boolean };
  indicators: {
    eligible: number;
    invitesGenerated: number;
    invitesDelivered: number | null;
    invitesAccessed: number;
    surveysStarted: number;
    surveysCompleted: number;
    participantsPending: number;
    leaderEvaluationsPending: number;
    calibrationsPending: number;
    overdueObligations: number;
    homologated: number;
    feedbackDone: number;
  };
  coverage: { byDepartment: CoverageRow[]; byDirectorate: CoverageRow[] };
  rows: TrackingRow[];
  filters: { departments: string[]; directorates: string[]; managers: string[]; modalities: string[]; statuses: ObligationStatus[] };
  labels: Record<ObligationKey, string>;
};
export type TrackingFilterInput = { department?: string; directorate?: string; manager?: string; modality?: string; status?: string };
const trackingQuery = (filters: TrackingFilterInput) => new URLSearchParams(Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][]).toString();
export const fetchTrackingBoard = (cycleId: string, filters: TrackingFilterInput = {}) => json<TrackingBoard>(`${BASE}/cycles/${cycleId}/tracking?${trackingQuery(filters)}`);
export const trackingExportUrl = (cycleId: string, filters: TrackingFilterInput = {}) => `${BASE}/cycles/${cycleId}/tracking/export?${trackingQuery(filters)}`;
export type PerformanceMe = { accessScope: string; actorEmployeeId: string | null; capabilities: PerformanceCapabilities; officialPublication: boolean };

export const fetchPerformanceFeatureStatus = () => json<{ enabled: boolean }>(`${BASE}/feature-status`);
export const fetchPerformanceMe = () => json<PerformanceMe>(`${BASE}/me`);

// ------------------------------------------------------------------ modelos
export type ModelSummary = {
  id: string;
  lineageId: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: number;
  ruleSetId: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  questionCount: number;
  cycles: number;
  /** INDIVIDUAL (12 perguntas) ou LEADERSHIP (180°). */
  kind?: "INDIVIDUAL" | "LEADERSHIP";
};
export type RoleExampleDto = { roleName: string; text: string };
export type ModelQuestion = {
  id: string;
  code: string;
  pillar: string;
  competency: string;
  sortOrder: number;
  selfText: string;
  leaderText: string;
  /** Liderança: liderado sobre o líder. */
  upwardText?: string | null;
  hint: string | null;
  description: string | null;
  positiveExample: string | null;
  negativeExample: string | null;
  roleExamples: RoleExampleDto[];
};
export type ModelDetail = {
  model: ModelSummary & { instructions: string | null; rules: PerformanceRules };
  questions: ModelQuestion[];
  problems: string[];
  lineage: { id: string; version: number; status: string; publishedAt: string | null; archivedAt: string | null; ruleSetId: string }[];
  usedBy: { id: string; name: string; status: string }[];
};

export const fetchPerformanceModels = () => json<{ models: ModelSummary[] }>(`${BASE}/models`);
export const fetchPerformanceModel = (id: string) => json<ModelDetail>(`${BASE}/models/${id}`);
export const createPerformanceModel = (input: { name: string; description?: string; instructions?: string }) => post<{ modelId: string }>(`${BASE}/models`, input);
export const updatePerformanceModel = (id: string, input: { name?: string; description?: string | null; instructions?: string | null; rules?: PerformanceRules }) =>
  put<{ modelId: string }>(`${BASE}/models/${id}`, input);
export const savePerformanceQuestion = (
  modelId: string,
  code: string,
  input: { competency: string; selfText: string; leaderText: string; hint: string; description: string; positiveExample: string; negativeExample: string; roleExamples: RoleExampleDto[] }
) =>
  put(`${BASE}/models/${modelId}/questions/${code}`, input);
export const movePerformanceQuestion = (modelId: string, code: string, direction: "up" | "down") => post(`${BASE}/models/${modelId}/questions/${code}/move`, { direction });
export const publishPerformanceModel = (id: string) => post(`${BASE}/models/${id}/publish`);
export const duplicatePerformanceModel = (id: string) => post<{ modelId: string }>(`${BASE}/models/${id}/duplicate`);
export const archivePerformanceModel = (id: string) => post(`${BASE}/models/${id}/archive`);

// ------------------------------------------------------------------ ciclos
export type RateDto = { numerator: number; denominator: number; ratio: number | null };
export type CycleCounts = {
  eligible: number;
  notEligible: number;
  insufficient: number;
  removed: number;
  withLeader: number;
  withoutLeader: number;
  invited: number;
  selfStarted: number;
  selfSubmitted: number;
  leaderStarted: number;
  leaderSubmitted: number;
  calibrated: number;
  official: number;
  feedback: number;
  acknowledged: number;
  pdiOpen: number;
  pdiLate: number;
  pdiDone: number;
  selfPending: number;
  leaderPending: number;
  rates: Record<"invited" | "selfSubmitted" | "leaderSubmitted" | "calibrated" | "official" | "feedback" | "acknowledged", RateDto>;
};
export type CycleSummary = {
  id: string;
  name: string;
  status: string;
  periodLabel: string;
  selfDueAt: string;
  leaderDueAt: string;
  modelId: string;
  modelName: string;
  modelVersion: number | null;
  minObservationDays: number;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  classification: CycleClassification;
  activation: CycleActivation;
  activationReason: string | null;
  activationChangedAt: string | null;
  /** Avaliação 180° de liderança neste ciclo (modelo de liderança). */
  leadershipModelId?: string | null;
  /** Presente na lista de ciclos; no workspace vem em `CycleWorkspace.governance`. */
  governance?: CycleGovernanceDto;
};

export type CycleClassification = "OFFICIAL" | "TEST";
export type CycleActivation = "ACTIVE" | "INACTIVE";
/** Predicado oficial único (ver `performanceLifecycle.ts`). */
export type CycleGovernanceDto = {
  classification: CycleClassification;
  activation: CycleActivation;
  status: string;
  publication: "NOT_OPENED" | "PILOT" | "OFFICIAL";
  homologated: boolean;
  officialEligible: boolean;
  reasons: string[];
};
export type CycleLifecycleInfo = {
  cycle: { id: string; name: string; status: string; classification: CycleClassification; activation: CycleActivation; activationReason: string | null; activationChangedAt: string | null };
  governance: CycleGovernanceDto;
  deletion: { deletable: boolean; blockers: string[]; counts: Record<string, number> } | null;
  history: { id: string; at: string; action: string; actorUserId: string | null; detail: Record<string, string | number | boolean | null> }[];
  canManage: boolean;
};
// ------------------------------------------------------------------ prontidão (antes de abrir)
export type ReadinessAction = "SET_LEADERSHIP_MODEL" | "INCLUDE_LEADERS" | "LINK_USERS" | "SET_EVALUATOR" | "REVIEW_LEADER";
export type ReadinessIssue = {
  code: string;
  severity: "BLOCK" | "WARN";
  title: string;
  message: string;
  action: ReadinessAction;
  people: { participantId: string | null; employeeId: string; name: string; detail?: string | null }[];
};
export const fetchCycleReadiness = (cycleId: string) => json<{ issues: ReadinessIssue[]; blocked: boolean }>(`${BASE}/cycles/${cycleId}/readiness`);
/** Inclui no ciclo os líderes que faltam, subindo a cadeia até o topo. */
export const includeCycleLeaders = (cycleId: string) => post<{ added: number }>(`${BASE}/cycles/${cycleId}/participants/include-leaders`);

export const fetchCycleLifecycle = (cycleId: string) => json<CycleLifecycleInfo>(`${BASE}/cycles/${cycleId}/lifecycle`);
export const classifyPerformanceCycleAsTest = (cycleId: string, reason: string) => post(`${BASE}/cycles/${cycleId}/classification`, { classification: "TEST", reason });
export const inactivatePerformanceCycle = (cycleId: string, reason: string) =>
  post<{ revokedInvites: number; revokedSessions: number }>(`${BASE}/cycles/${cycleId}/inactivate`, { reason });
export const reactivatePerformanceCycle = (cycleId: string, reason: string) =>
  post<{ status: string; invitesNeedReissue: boolean }>(`${BASE}/cycles/${cycleId}/reactivate`, { reason });
export const deletePerformanceTestCycle = (cycleId: string, reason: string, confirmation: string) =>
  json<{ deleted: Record<string, number>; auditId: string }>(`${BASE}/cycles/${cycleId}`, { method: "DELETE", body: JSON.stringify({ reason, confirmation }) });

export const fetchPerformanceCycles = () => json<{ cycles: CycleSummary[]; counts: Record<string, CycleCounts> }>(`${BASE}/cycles`);
export const createPerformanceCycle = (input: { name: string; periodLabel: string; modelId: string; selfDueAt: string; leaderDueAt: string; classification: CycleClassification; leadershipModelId?: string | null }) => post<{ cycleId: string }>(`${BASE}/cycles`, input);
export const updatePerformanceCycle = (id: string, input: { name: string; periodLabel: string; selfDueAt: string; leaderDueAt: string; reason?: string }) => put(`${BASE}/cycles/${id}`, input);
export const transitionPerformanceCycle = (id: string, input: { to: string; reason?: string; pilotAck?: boolean; acceptPending?: boolean }) =>
  post<{ status: string; pending?: number }>(`${BASE}/cycles/${id}/transition`, input);
export const homologatePerformanceCycle = (id: string) => post<{ status: string }>(`${BASE}/cycles/${id}/homologate`);

export type ResultSummary = {
  id: string;
  version: number;
  quadrant: string;
  nineX: string | null;
  nineY: string | null;
  official: boolean;
  reviewStatus: string;
  technicalValidation: string;
  validationNote: string | null;
  cultureBand: string;
  cultureBasis: string;
  technicalSum: number;
  technicalCount: number;
  potentialSum: number;
  potentialCount: number;
  cultureSum: number;
  cultureCount: number;
  nineBoxReason: string;
  adjusted: boolean;
  calibrationNote: string | null;
  calibratedAt: string | null;
  ruleSetId: string | null;
};

export type WorkspacePerson = {
  /** Avaliação 180°: líder no retrato da abertura e andamento das etapas (só RH). */
  leadership?: { isLeader: boolean; directReportCount: number; status: LeadershipStatus; journey: { kind: string; status: string }[] | null };
  participant: {
    id: string;
    employeeId: string;
    employeeName: string;
    employeeStatus: string | null;
    eligibility: string;
    eligibilityReason: string;
    eligibilityException: string | null;
    roleName: string;
    departmentName: string;
    managerId: string | null;
    managerName: string | null;
    managerSource: string;
    admissionDate: string | null;
    removedAt: string | null;
    removedReason: string | null;
  };
  self: { id: string; status: string; version: number; assisted: boolean; submittedAt: string | null } | null;
  leader: { id: string; status: string; version: number; revision: number; evaluatorEmployeeId: string; returnReason: string | null; submittedAt: string | null } | null;
  leaderVersions: number;
  result: ResultSummary | null;
  feedback: {
    id: string;
    strength: string;
    improvement: string;
    action: string;
    ownerName: string;
    dueAt: string | null;
    conversationAt: string | null;
    viewedAt: string | null;
    acknowledgedAt: string | null;
    acknowledgedVia: string | null;
    agreedAt: string | null;
    contestation: string | null;
    collaboratorNote: string | null;
    createdAt: string;
  } | null;
  pdis: { id: string; title: string; objective: string | null; competencyCode: string | null; status: string; dueAt: string | null; priority: boolean; justification: string | null; ownerName: string; checkins: number }[];
  invite: { status: "NONE" | "ACTIVE" | "REVOKED" | "LOCKED" | "EXPIRED"; expiresAt: string | null; issuedAt: string | null; attempts: number; revokedReason: string | null };
  divergences: { questionCode: string; selfScore: number; leaderScore: number; gap: number }[];
};

export type CycleWorkspace = {
  cycle: CycleSummary;
  governance: CycleGovernanceDto;
  leadershipQuestions?: { code: string; pillar: string; competency: string }[];
  model: { id: string; name: string; version: number; status: string; instructions: string | null; rules: PerformanceRules } | null;
  questions: { code: string; pillar: string; competency: string; selfText: string; leaderText: string; hint: string | null }[];
  people: WorkspacePerson[];
  counts: CycleCounts;
};

export const fetchCycleWorkspace = (id: string) => json<CycleWorkspace>(`${BASE}/cycles/${id}/workspace`);

export type DirectoryPerson = {
  id: string;
  name: string;
  status: string | null;
  terminated: boolean;
  roleName: string;
  departmentName: string;
  managerId: string | null;
  managerName: string | null;
  /** CADASTRO | ORGANOGRAMA (hierarquia efetiva). */
  managerSource?: string;
  /** Por que não há líder, ou alerta da hierarquia. */
  managerNote?: string | null;
  admissionDate: string | null;
  registration: string | null;
};
export const searchPerformanceDirectory = (query: string) => json<{ employees: DirectoryPerson[] }>(`${BASE}/directory?q=${encodeURIComponent(query)}`);
export const previewPerformanceParticipants = (cycleId: string, employeeIds: string[]) =>
  post<{
    people: {
      employeeId: string;
      name: string;
      eligibility: string;
      reason: string;
      alreadyInCycle: boolean;
      managerName: string | null;
      /** CADASTRO | ORGANOGRAMA (hierarquia efetiva). */
      managerSource: string;
      /** Motivo de não haver líder, ou alerta da hierarquia. */
      managerNote: string | null;
    }[];
  }>(`${BASE}/cycles/${cycleId}/participants/preview`, { employeeIds });
/** Antes da abertura: líder de cada participante pela hierarquia efetiva (exceção do RH preservada). */
export const syncPerformanceLeaders = (cycleId: string) =>
  post<{ changed: number; withoutLeader: number; keptByHr: number }>(`${BASE}/cycles/${cycleId}/participants/sync-leaders`);
export const savePerformanceParticipants = (cycleId: string, employeeIds: string[], exceptions: Record<string, string> = {}) =>
  post<{ eligible: number; notEligible: number; insufficient: number; added: number; duplicates: number; reactivated: number; missing: number }>(`${BASE}/cycles/${cycleId}/participants`, { employeeIds, exceptions });
export const removePerformanceParticipant = (participantId: string, reason: string) => post(`${BASE}/participants/${participantId}/remove`, { reason });
export const setPerformanceEligibilityException = (participantId: string, reason: string | null) => post(`${BASE}/participants/${participantId}/eligibility`, { reason });
export const reassignPerformanceLeader = (participantId: string, managerId: string, reason: string) => post(`${BASE}/participants/${participantId}/leader`, { managerId, reason });

// ------------------------------------------------------------------ convites
export type IssuedInvite = { participantId: string; employeeName: string; roleName: string; url: string; otp: string; inviteId: string; expiresAt: string };
export const issuePerformanceInvite = (assignmentId: string) => post<IssuedInvite>(`${BASE}/assignments/${assignmentId}/invites`);
export const issuePerformanceInvitesBatch = (cycleId: string, input: { participantIds?: string[]; onlyMissing: boolean }) =>
  post<{ issued: IssuedInvite[]; skipped: number }>(`${BASE}/cycles/${cycleId}/invites`, input);
export const revokePerformanceInvite = (assignmentId: string, reason: string) => post<{ revoked: number }>(`${BASE}/assignments/${assignmentId}/invites/revoke`, { reason });
export const openAssistedPerformance = (assignmentId: string, reason: string) => post<{ sessionToken: string }>(`${BASE}/assignments/${assignmentId}/assist`, { reason });

// ------------------------------------------------------------------ liderança
export type LeaderQueueItem = {
  assignmentId: string;
  participantId: string;
  employeeName: string;
  roleName: string;
  departmentName: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  dueAt: string;
  status: string;
  version: number;
  revision: number;
  returnReason: string | null;
  editable: boolean;
  selfVisible: boolean;
  divergences: { questionCode: string; gap: number }[];
  officialResult: { quadrant: string; cultureBand: string; technicalSum: number; technicalCount: number; potentialSum: number; potentialCount: number } | null;
  feedback: { id: string; acknowledgedAt: string | null; createdAt: string } | null;
  pdis: { id: string; title: string; status: string; dueAt: string | null }[];
};
export const fetchLeaderQueue = () => json<{ items: LeaderQueueItem[]; leadership?: SuperiorLeadershipItem[] }>(`${BASE}/team`);

// ------------------------------------------------------------------ liderança (180°)
export type LeadershipStatus = "NOT_APPLICABLE" | "PENDING" | "AVAILABLE" | "CALIBRATED" | "EXCEPTION" | "HOMOLOGATED";
export type SuperiorLeadershipItem = {
  assignmentId: string;
  participantId: string;
  employeeName: string;
  roleName: string;
  departmentName: string;
  directReportCount: number;
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  status: string;
  dueAt: string;
  leadershipStatus: LeadershipStatus;
};
export type SuperiorLeadershipForm = {
  assignment: { id: string; kind: string; status: string; version: number; submittedAt: string | null };
  participant: { id: string; employeeName: string; roleName: string; departmentName: string; directReportCount: number };
  cycle: { id: string; name: string; periodLabel: string; status: string; dueAt: string };
  rules: { minRespondents: number; commentMinLetters: number; divergenceThreshold: number };
  questions: { code: string; competency: string; behavior: string; text: string }[];
  answers: { questionCode: string; kind: string; score: number | null; comment: string | null }[];
};
export const fetchSuperiorLeadershipForm = (assignmentId: string) => json<SuperiorLeadershipForm>(`${BASE}/assignments/${assignmentId}`);
export const createLeadershipModel = (name: string) => post<{ modelId: string }>(`${BASE}/models/leadership`, { name });
export const updateLeadershipQuestion = (modelId: string, code: string, body: { competency: string; behavior: string; selfText: string; upwardText: string; superiorText: string }) =>
  put<{ code: string }>(`${BASE}/models/${modelId}/leadership-questions/${encodeURIComponent(code)}`, body);
export const setCycleLeadershipModel = (cycleId: string, leadershipModelId: string | null) => put(`${BASE}/cycles/${cycleId}/leadership`, { leadershipModelId });
export type LeadershipListRow = {
  participantId: string;
  employeeName: string;
  roleName: string;
  departmentName: string;
  managerName: string | null;
  directReportCount: number;
  status: LeadershipStatus;
  teamInvited: number;
  selfStatus: string | null;
  superiorStatus: string | null;
  calibratedIndex: number | null;
};
export const fetchLeadershipList = (cycleId: string) => json<{ rows: LeadershipListRow[] }>(`${BASE}/cycles/${cycleId}/leadership`);
export type LeadershipComparisonRow = {
  code: string;
  competency: string;
  behavior: string;
  self: number | null;
  superior: number | null;
  team: number | null;
  teamDisclosed: boolean;
  teamValidCount: number;
  dispersion: number | null;
  divergences: string[];
};
export type LeadershipComparison = {
  participant: { id: string; employeeName: string; roleName: string; departmentName: string; directReportCount: number; managerName: string | null };
  cycle: { id: string; name: string; status: string };
  status: LeadershipStatus;
  rules: { minRespondents: number; commentMinLetters: number; divergenceThreshold: number };
  coverage: { teamInvited: number; teamRespondents: number | null; teamDisclosed: boolean; selfSubmitted: boolean; superiorSubmitted: boolean };
  self: { index: number | null; coverage: number };
  superior: { index: number | null; coverage: number };
  team: { index: number | null; coverage: number; disclosed: boolean; message: string | null };
  rows: LeadershipComparisonRow[];
  result: null | {
    id: string;
    version: number;
    status: "CALIBRATED" | "EXCEPTION";
    scores: Record<string, number>;
    justifications: Record<string, string>;
    generalNote: string;
    exceptionReason: string | null;
    official: boolean;
    calibratedAt: string;
    index: number | null;
    strengths: { code: string; competency: string; score: number }[];
    priorities: { code: string; competency: string; score: number }[];
  };
};
export const fetchLeadershipComparison = (participantId: string) => json<LeadershipComparison>(`${BASE}/participants/${participantId}/leadership`);
export const calibrateLeadershipApi = (participantId: string, body: { scores: Record<string, number>; justifications: Record<string, string>; generalNote: string; exceptionReason?: string | null }) =>
  post<{ status: string; version: number }>(`${BASE}/participants/${participantId}/leadership/calibration`, body);

export type LeaderAnswerDraft = { kind: "pending" } | { kind: "notObserved"; evidence?: string | null } | { kind: "score"; score: number; evidence?: string | null };
export type LeaderForm = {
  assignment: { id: string; status: string; version: number; revision: number; returnReason: string | null; submittedAt: string | null };
  employee: { name: string; roleName: string; departmentName: string };
  cycle: { id: string; name: string; periodLabel: string; status: string; dueAt: string };
  editable: boolean;
  instructions: string;
  rules: { requireExtremeEvidence: boolean; evidenceMinChars: number };
  questions: {
    code: string;
    text: string;
    pillar: string;
    competency: string;
    hint: string | null;
    description: string | null;
    positiveExample: string | null;
    negativeExample: string | null;
    roleExample: string | null;
  }[];
  answers: { questionCode: string; kind: string; score: number | null; evidence: string | null }[];
  selfAnswers: { questionCode: string; kind: string; score: number | null }[];
  divergences: { questionCode: string; selfScore: number; leaderScore: number; gap: number }[];
};
export const fetchLeaderAssignment = (id: string) => json<LeaderForm>(`${BASE}/assignments/${id}`);
export const saveLeaderAnswers = (id: string, expectedVersion: number, answers: { code: string; answer: LeaderAnswerDraft }[]) =>
  put<{ version: number }>(`${BASE}/assignments/${id}/answers`, { expectedVersion, answers });
export const submitLeaderAssignment = (id: string, expectedVersion: number) => post<{ status: string }>(`${BASE}/assignments/${id}/submit`, { expectedVersion });
export const returnPerformanceAssignment = (assignmentId: string, reason: string) => post(`${BASE}/assignments/${assignmentId}/return`, { reason });

// ------------------------------------------------------------------ calibração
export type PillarMeans = Record<string, { display: string | null; count: number; notObserved: number; insufficient: boolean }>;
export type CalibrationRow = {
  participantId: string;
  employeeName: string;
  roleName: string;
  departmentName: string;
  managerName: string | null;
  selfStatus: string | null;
  leaderStatus: string | null;
  leaderAssignmentId: string | null;
  leaderRevision: number | null;
  self: PillarMeans;
  leader: PillarMeans;
  divergences: { questionCode: string; competency: string; text: string; selfScore: number; leaderScore: number; gap: number }[];
  evidences: { questionCode: string; competency: string; score: number | null; notObserved: boolean; evidence: string | null }[];
  result: ResultSummary | null;
  versions: number;
};
export const fetchCalibrationQueue = (cycleId: string, filters: Record<string, string> = {}) =>
  json<{ cycle: { id: string; name: string; status: string }; rules: PerformanceRules; rows: CalibrationRow[] }>(`${BASE}/cycles/${cycleId}/calibration?${new URLSearchParams(filters)}`);
export const validatePerformanceTechnical = (participantId: string, decision: "VALIDATED" | "INSUFFICIENT", note: string) =>
  post(`${BASE}/participants/${participantId}/validation`, { decision, note });
export const calibratePerformance = (
  participantId: string,
  input: { note: string; decision: "CONFIRM" | "ADJUST"; technicalBand?: string; potentialBand?: string; acceptMissingLeader?: boolean; committee?: string }
) =>
  post<{ reviewStatus: string; quadrant: string }>(`${BASE}/participants/${participantId}/calibration`, input);
// ------------------------------------------------------------------ dossiê e avaliadores
export type BiasFlag = "LENIENT" | "SEVERE" | "CENTRAL" | "HALO";
export type EvaluatorStat = {
  evaluatorEmployeeId: string;
  evaluatorName: string | null;
  evaluated: number;
  submitted: number;
  mean: number | null;
  cycleMean: number | null;
  distribution: { 1: number; 2: number; 3: number; 4: number; notObserved: number };
  extremeShare: number | null;
  flatShare: number | null;
  flags: BiasFlag[];
};
export const fetchCalibrationEvaluators = (cycleId: string) => json<{ evaluators: EvaluatorStat[] }>(`${BASE}/cycles/${cycleId}/calibration/evaluators`);
export type PersonDossier = {
  participant: { id: string; employeeId: string; employeeName: string; roleName: string; departmentName: string; managerName: string | null; managerSource: string; admissionDate: string | null; isLeader: boolean; directReportCount: number; eligibility: string };
  cycle: { id: string; name: string; status: string; periodLabel: string };
  rules: PerformanceRules | null;
  individual: CalibrationRow | null;
  leadership: LeadershipComparison | null;
  asEvaluator: EvaluatorStat | null;
  previousCycles: EmployeeHistory["cycles"];
  pdis: { id: string; title: string; competencyCode: string | null; status: string; dueAt: string | null; checkins: { note: string; obstacle: string | null; nextStep: string | null; createdAt: string }[] }[];
  versions: { version: number; reviewStatus: string; quadrant: string; adjusted: boolean; calibrationNote: string | null; calibratedAt: string | null; official: boolean }[];
};
export const fetchPersonDossier = (participantId: string) => json<PersonDossier>(`${BASE}/participants/${participantId}/dossier`);

export type ResultHistory = {
  participant: { id: string; employeeName: string };
  versions: (ResultSummary & { createdAt: string; supersedesId: string | null; calibratedByUserId: string | null })[];
  events: { at: string; action: string; actorUserId: string | null; detail: Record<string, unknown> }[];
};
export const fetchResultHistory = (participantId: string) => json<ResultHistory>(`${BASE}/participants/${participantId}/results`);

// ------------------------------------------------------------------ painel e Nine-Box
export type NineBoxCell = {
  participantId: string;
  employeeId: string;
  name: string;
  quadrant: string;
  nineX: string | null;
  nineY: string | null;
  official: boolean;
  reviewStatus: string | null;
  adjusted: boolean;
  cultureBand: string | null;
  technicalValidation: string | null;
  departmentName: string;
  roleName: string;
  managerName: string | null;
  technical: string | null;
  potential: string | null;
  culture: string | null;
};
export type CycleDashboard = {
  cycle: { id: string; name: string; status: string; periodLabel: string };
  counts: CycleCounts;
  cells: NineBoxCell[];
  culture: Record<string, number>;
  cultureLabels: Record<string, string>;
  pdiByStatus: Record<string, number>;
  /** Avaliação 180°: só contagens e notas calibradas (nada da avaliação da equipe). */
  leadership?: null | {
    leaders: number;
    calibrated: number;
    homologated: number;
    exceptions: number;
    upwardInvited: number;
    upwardSubmitted: number;
    byCompetency: { code: string; competency: string; mean: number }[] | null;
    lowSample: boolean;
  };
  lowSample: boolean;
  lowSampleThreshold: number;
  filters: { departments: string[]; roles: string[]; managers: string[] };
};
export const fetchPerformanceDashboard = (id: string, filters: Record<string, string> = {}) => json<CycleDashboard>(`${BASE}/cycles/${id}/dashboard?${new URLSearchParams(filters)}`);
export type EvolutionRow = {
  cycleId: string;
  name: string;
  periodLabel: string;
  status: string;
  modelVersion: number | null;
  ruleSetId: string | null;
  eligible: number;
  selfSubmitted: number;
  leaderSubmitted: number;
  calibrated: number;
  official: number;
  feedback: number;
  pdiDone: number;
  pdiOpen: number;
};
export const fetchPerformanceEvolution = () => json<{ cycles: EvolutionRow[] }>(`${BASE}/evolution`);
export const performanceExportUrl = (cycleId: string) => `${BASE}/cycles/${cycleId}/export`;

// ------------------------------------------------------------------ devolutiva e PDI
export const createPerformanceFeedback = (participantId: string, input: { strength: string; improvement: string; action: string; ownerName: string; dueAt: string; conversationAt: string }) =>
  post<{ feedbackId: string }>(`${BASE}/participants/${participantId}/feedback`, input);
export const acknowledgePerformanceFeedback = (feedbackId: string, input: { action: "VIEWED" | "ACKNOWLEDGED" | "AGREED" | "CONTESTED"; note?: string; assisted?: boolean }) =>
  post(`${BASE}/feedbacks/${feedbackId}/ack`, input);
export const createPerformancePdi = (feedbackId: string, input: { title: string; objective?: string; competencyCode?: string; priority: boolean; justification?: string; ownerName: string; dueAt: string }) =>
  post<{ pdiId: string }>(`${BASE}/feedbacks/${feedbackId}/pdi`, input);
export const updatePerformancePdi = (pdiId: string, input: { status: string; note?: string; evidence?: string }) => post(`${BASE}/pdis/${pdiId}/status`, input);
export const addPerformanceCheckin = (pdiId: string, input: { note: string; obstacle?: string; nextStep?: string }) => post(`${BASE}/pdis/${pdiId}/checkins`, input);
export type PdiTrackingRow = {
  id: string;
  title: string;
  objective: string | null;
  competencyCode: string | null;
  status: string;
  priority: boolean;
  justification: string | null;
  ownerName: string;
  dueAt: string | null;
  late: boolean;
  open: boolean;
  evidence: string | null;
  completedAt: string | null;
  employeeName: string;
  departmentName: string;
  cycleId: string;
  cycleName: string;
  checkins: { id: string; note: string; obstacle: string | null; nextStep: string | null; createdAt: string }[];
  lastCheckinAt: string | null;
};
export const fetchPdiTracking = (filters: Record<string, string> = {}) => json<{ items: PdiTrackingRow[] }>(`${BASE}/pdis?${new URLSearchParams(filters)}`);

// ------------------------------------------------------------------ histórico e documentos
export type EmployeeHistory = {
  cycles: {
    cycleId: string;
    participantId: string;
    cycleName: string;
    periodLabel: string;
    cycleStatus: string;
    classification?: CycleClassification;
    activation?: CycleActivation;
    /** Falso em piloto (sem publicação oficial); o motivo vem em `notOfficialReasons`. */
    officialEligible?: boolean;
    notOfficialReasons?: string[];
    modelName: string;
    modelVersion: number | null;
    ruleSetId: string | null;
    comparableWithPrevious: boolean | null;
    roleName: string;
    departmentName: string;
    managerName: string | null;
    eligibility: string;
    quadrant: string | null;
    cultureBand: string | null;
    technical: string | null;
    potential: string | null;
    culture: string | null;
    feedback: { strength: string; improvement: string; action: string; acknowledgedAt: string | null; agreedAt: string | null; contestation: string | null } | null;
    pdis: { title: string; status: string; dueAt: string | null }[];
  }[];
};
export const fetchEmployeePerformanceHistory = (employeeId: string) => json<EmployeeHistory>(`${BASE}/employees/${employeeId}/history`);

export type ReportIssue = { code: string; version: number; issuedAt: string; kind: string; issuedByName: string | null };
export const issuePerformanceReport = (input: { cycleId: string; kind: string; participantId?: string | null }) => post<{ issue: ReportIssue; data: any }>(`${BASE}/reports/issue`, input);
export function performanceReportPrintUrl(cycleId: string, kind: string, participantId?: string) {
  const params = new URLSearchParams({ cycleId, kind });
  if (participantId) params.set("participantId", participantId);
  return `/performance-cycle/relatorio?${params.toString()}`;
}

// ------------------------------------------------------------------ portal público
// As chamadas do portal ficam em performancePortalClient.ts (bundle público separado).
export * from "./performancePortalClient";
