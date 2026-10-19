import { randomUUID } from "node:crypto";
import type {
  AssignmentKind,
  AssignmentStatus,
  CultureBand,
  CycleStatus,
  EligibilityState,
  FrequencyScore,
  ModelStatus,
  NineBoxBand,
  PdiStatus,
  PerformanceRules,
  Pillar,
  TechnicalValidation,
} from "./performanceDomain.js";

export type QuestionRecord = {
  id: string;
  modelId: string;
  code: string;
  pillar: Pillar;
  competency: string;
  sortOrder: number;
  selfText: string;
  leaderText: string;
  hint: string | null;
  description: string | null;
  positiveExample: string | null;
  negativeExample: string | null;
  roleExamples: RoleExample[];
};

/** Exemplo observável para um cargo (RFC-008). Não muda o critério, só ilustra. */
export type RoleExample = { roleName: string; text: string };

export type ModelRecord = {
  id: string;
  lineageId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  status: ModelStatus;
  version: number;
  governance: "EM_VALIDACAO";
  rules: PerformanceRules;
  publishedAt: string | null;
  archivedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type CycleRecord = {
  id: string;
  name: string;
  periodLabel: string;
  status: CycleStatus;
  modelId: string;
  selfDueAt: string;
  leaderDueAt: string;
  ownerUserId: string | null;
  minObservationDays: number;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type ParticipantRecord = {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  employeeStatus: string | null;
  eligibility: EligibilityState;
  eligibilityReason: string;
  eligibilityException: string | null;
  absenceInWindow: boolean;
  roleChangedInWindow: boolean;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string;
  managerId: string | null;
  managerName: string | null;
  /** CADASTRO = líder veio da ficha; RH = exceção atribuída e justificada. */
  managerSource: "CADASTRO" | "RH";
  admissionDate: string | null;
  registration: string | null;
  frozen: boolean;
  addedAt: string;
  removedAt: string | null;
  removedReason: string | null;
};

export type AssignmentRecord = {
  id: string;
  participantId: string;
  cycleId: string;
  employeeId: string;
  kind: AssignmentKind;
  evaluatorEmployeeId: string;
  status: AssignmentStatus;
  version: number;
  revision: number;
  supersedesId: string | null;
  active: boolean;
  submittedAt: string | null;
  assistedByUserId: string | null;
  returnReason: string | null;
  createdAt: string;
};

export type AnswerRecord = {
  id: string;
  assignmentId: string;
  questionCode: string;
  pillar: Pillar;
  kind: "pending" | "score" | "notObserved";
  score: FrequencyScore | null;
  evidence: string | null;
};

export type InviteRecord = {
  id: string;
  assignmentId: string;
  linkDigest: string;
  otpDigest: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  failedAttempts: number;
  locked: boolean;
  createdAt: string;
};

export type SessionRecord = {
  id: string;
  inviteId: string | null;
  assignmentId: string;
  phase: "LINK" | "VERIFIED" | "ASSISTED";
  sessionDigest: string;
  expiresAt: string;
  assistantUserId: string | null;
  assistReason: string | null;
  revoked: boolean;
};

/** Cópia das regras usadas no cálculo. Reemitir o resultado usa este snapshot. */
export type RuleSnapshot = PerformanceRules & { modelId: string; modelVersion: number };

export type ResultRecord = {
  id: string;
  participantId: string;
  version: number;
  active: boolean;
  technicalSum: number;
  technicalCount: number;
  cultureSum: number;
  cultureCount: number;
  potentialSum: number;
  potentialCount: number;
  technicalValidation: TechnicalValidation;
  validationNote: string | null;
  cultureBand: CultureBand;
  cultureBasis: string;
  quadrant: string;
  nineBoxReason: string;
  nineX: NineBoxBand | null;
  nineY: NineBoxBand | null;
  official: boolean;
  reviewStatus: "PRELIMINARY" | "CALIBRATED";
  algorithmId: string;
  nineBoxRuleId: string;
  cultureRuleId: string;
  supersedesId: string | null;
  ruleSnapshot: RuleSnapshot | null;
  adjusted: boolean;
  calibrationNote: string | null;
  calibratedByUserId: string | null;
  calibratedAt: string | null;
  createdAt: string;
};

export type FeedbackRecord = {
  id: string;
  participantId: string;
  resultId: string;
  strength: string;
  improvement: string;
  action: string;
  ownerName: string;
  dueAt: string | null;
  conversationAt: string | null;
  leaderEmployeeId: string;
  viewedAt: string | null;
  acknowledgedAt: string | null;
  agreedAt: string | null;
  contestation: string | null;
  collaboratorNote: string | null;
  acknowledgedVia: "SELF" | "ASSISTED" | null;
  acknowledgedByUserId: string | null;
  internalNotes: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type PdiRecord = {
  id: string;
  participantId: string;
  feedbackId: string;
  title: string;
  objective: string | null;
  competencyCode: string | null;
  priority: boolean;
  justification: string | null;
  ownerName: string;
  dueAt: string | null;
  status: PdiStatus;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CheckinRecord = {
  id: string;
  pdiId: string;
  note: string;
  obstacle: string | null;
  nextStep: string | null;
  authorUserId: string | null;
  createdAt: string;
};

export type ConductRecord = {
  id: string;
  employeeId: string;
  status: "RECORDED" | "TRIAGE" | "INQUIRY" | "CONCLUDED" | "MEASURES";
  summary: string;
  proven: boolean;
};

export type AuditRecord = {
  id: string;
  at: string;
  actorUserId: string | null;
  action: string;
  entityId: string;
  detail: Record<string, string | number | boolean | null>;
};

export type ReminderRecord = {
  id: string;
  cycleId: string;
  employeeId: string;
  audience: "SELF" | "LEADER" | "HR";
  status: "DRAFT";
};

/** Emissão de documento. O código é o identificador rastreável impresso no PDF. */
export type ReportIssueRecord = {
  id: string;
  code: string;
  kind: string;
  cycleId: string;
  participantId: string | null;
  version: number;
  issuedByUserId: string | null;
  issuedByName: string | null;
  issuedAt: string;
};

export type PerformanceDatabase = {
  /** Revisão do grafo. A gravação só entra se o banco ainda estiver neste número. */
  graphRevision: number;
  models: ModelRecord[];
  questions: QuestionRecord[];
  cycles: CycleRecord[];
  participants: ParticipantRecord[];
  assignments: AssignmentRecord[];
  answers: AnswerRecord[];
  invites: InviteRecord[];
  sessions: SessionRecord[];
  results: ResultRecord[];
  feedbacks: FeedbackRecord[];
  pdis: PdiRecord[];
  checkins: CheckinRecord[];
  conducts: ConductRecord[];
  audits: AuditRecord[];
  reminders: ReminderRecord[];
  reports: ReportIssueRecord[];
};

/** Coleções gravadas pela persistência, na ordem que respeita as chaves estrangeiras. */
export const PERFORMANCE_COLLECTIONS = [
  "models",
  "questions",
  "cycles",
  "participants",
  "assignments",
  "answers",
  "invites",
  "sessions",
  "results",
  "feedbacks",
  "pdis",
  "checkins",
  "conducts",
  "audits",
  "reminders",
  "reports",
] as const satisfies readonly (keyof Omit<PerformanceDatabase, "graphRevision">)[];

export type PerformanceCollection = (typeof PERFORMANCE_COLLECTIONS)[number];

export function emptyPerformanceDatabase(): PerformanceDatabase {
  return {
    graphRevision: 0,
    models: [],
    questions: [],
    cycles: [],
    participants: [],
    assignments: [],
    answers: [],
    invites: [],
    sessions: [],
    results: [],
    feedbacks: [],
    pdis: [],
    checkins: [],
    conducts: [],
    audits: [],
    reminders: [],
    reports: [],
  };
}

export function newId(): string {
  return randomUUID();
}

export function cloneDb(db: PerformanceDatabase): PerformanceDatabase {
  return structuredClone(db);
}

export type CollectionChange = {
  collection: PerformanceCollection;
  created: { id: string }[];
  updated: { id: string }[];
  /** Ids que existiam antes e sumiram. A persistência recusa: histórico não se apaga. */
  removed: string[];
};

/** Diferença entre dois estados, coleção a coleção. Comparação por conteúdo serializado. */
export function diffPerformanceDatabase(before: PerformanceDatabase, after: PerformanceDatabase): CollectionChange[] {
  const out: CollectionChange[] = [];
  for (const collection of PERFORMANCE_COLLECTIONS) {
    const previous = new Map<string, string>();
    for (const row of before[collection] as { id: string }[]) previous.set(row.id, JSON.stringify(row));
    const created: { id: string }[] = [];
    const updated: { id: string }[] = [];
    const seen = new Set<string>();
    for (const row of after[collection] as { id: string }[]) {
      seen.add(row.id);
      const old = previous.get(row.id);
      if (old === undefined) created.push(row);
      else if (old !== JSON.stringify(row)) updated.push(row);
    }
    const removed = [...previous.keys()].filter((id) => !seen.has(id));
    if (created.length || updated.length || removed.length) out.push({ collection, created, updated, removed });
  }
  return out;
}
