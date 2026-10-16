import { randomUUID } from "node:crypto";
import type {
  AssignmentKind,
  AssignmentStatus,
  CultureBand,
  CycleStatus,
  EligibilityState,
  FrequencyScore,
  ModelStatus,
  Pillar,
  TechnicalValidation,
} from "./performanceDomain.js";

export type QuestionRecord = {
  id: string;
  modelId: string;
  code: string;
  pillar: Pillar;
  sortOrder: number;
  selfText: string;
  leaderText: string;
  hint: string | null;
};

export type ModelRecord = {
  id: string;
  lineageId: string;
  name: string;
  status: ModelStatus;
  version: number;
  governance: "EM_VALIDACAO";
  publishedAt: string | null;
  createdByUserId: string | null;
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
};

export type ParticipantRecord = {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  eligibility: EligibilityState;
  eligibilityReason: string;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string;
  managerId: string | null;
  managerName: string | null;
  admissionDate: string | null;
  registration: string | null;
  frozen: boolean;
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
  failedAttempts: number;
  locked: boolean;
};

export type SessionRecord = {
  id: string;
  inviteId: string | null;
  assignmentId: string;
  phase: "LINK" | "VERIFIED" | "ASSISTED";
  sessionDigest: string;
  expiresAt: string;
  assistantUserId: string | null;
  revoked: boolean;
};

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
  nineX: string | null;
  nineY: string | null;
  official: boolean;
  reviewStatus: "PRELIMINARY" | "CALIBRATED";
  algorithmId: string;
  nineBoxRuleId: string;
  cultureRuleId: string;
  supersedesId: string | null;
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
  internalNotes: string | null;
};

export type PdiRecord = {
  id: string;
  participantId: string;
  feedbackId: string;
  title: string;
  priority: boolean;
  justification: string | null;
  ownerName: string;
  dueAt: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "DONE" | "SUSPENDED" | "CANCELLED";
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
};

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
  };
}

export function newId(): string {
  return randomUUID();
}

export function cloneDb(db: PerformanceDatabase): PerformanceDatabase {
  return structuredClone(db);
}
