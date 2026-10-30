/**
 * Inteligência Fiscal 360° — contratos de API (client-safe).
 * Valores monetários em reais (number, 2 casas). Datas ISO (YYYY-MM-DD) e competências YYYY-MM.
 */

export type Fiscal360Basis = "COMPETENCE" | "CASH";

export type Fiscal360Filters = {
  /** null = grupo consolidado (as três empresas). */
  companyCnpj: string | null;
  fromMonth: string;
  toMonth: string;
  basis: Fiscal360Basis;
  taxType: string | null;
  status: string | null;
  evidenceLevel: string | null;
  linkState: string | null;
  operationClass: string | null;
  jurisdiction: string | null;
  includeUnknownCompany: boolean;
  q: string | null;
};

export type Fiscal360KpiState = "OK" | "INSUFFICIENT_DATA" | "NOT_RECONCILED";

export type Fiscal360Freshness = {
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSuccessAt: string | null;
  lastSnapshotAt: string | null;
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
  oldestPendingAt: string | null;
  lagMinutes: number | null;
  workerEnabled: boolean;
};

export type Fiscal360Overview = {
  filters: Fiscal360Filters;
  generatedAt: string;
  kpis: {
    paid: number;
    paidProven: number;
    paidUnproven: number;
    paidDeclared: number;
    reviewAmount: number;
    paidWithoutCashDate: number;
    assessed: number;
    credits: number;
    retentions: number;
    apurationDue: number;
    obligationDue: number;
    openBalance: number;
    overdueAmount: number;
    overdueCount: number;
    highlighted: number;
    highlightedMarket: number;
    highlightedIntercompany: number;
    highlightedOther: number;
    st: number;
    desonerated: number;
    informative: number;
    documentaryCredits: number;
    officialRevenue: number;
    intercompanyRevenue: number;
    documentaryMovement: number;
    cashBurdenPct: number | null;
    cashBurdenState: Fiscal360KpiState;
    reconciledPct: number | null;
    reconciliationItems: number;
    pendingClassificationCount: number;
    pendingClassificationAmount: number;
    openIssues: number;
    documentCount: number;
    missingXmlCount: number;
    paymentFactCount: number;
  };
  monthly: Array<{
    month: string;
    highlighted: number;
    assessed: number;
    apurationDue: number;
    obligationDue: number;
    paid: number;
    officialRevenue: number;
  }>;
  byTax: Array<{ taxType: string; highlighted: number; assessed: number; due: number; paid: number; open: number; review: number }>;
  byCompany: Array<{ companyCnpj: string; officialRevenue: number; highlighted: number; due: number; paid: number; open: number }>;
  freshness: Fiscal360Freshness;
  notes: string[];
};

export type Fiscal360Page<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type Fiscal360PaymentRow = {
  anchorKey: string;
  anchorType: string;
  guideId: string | null;
  apExternalId: number | null;
  companyCnpj: string;
  taxType: string;
  revenueCode: string | null;
  guideType: string | null;
  guideNumber: string | null;
  competenceMonth: string;
  dueDate: string | null;
  amountDue: number;
  paidAmount: number;
  openBalance: number;
  paidAt: string | null;
  paidAtSource: string | null;
  paymentAccount: string | null;
  status: string;
  effectiveStatus: string;
  evidenceLevel: string;
  linkState: string;
  paidSource: string;
  countsInPaidTotals: boolean;
  reviewReason: string | null;
  flags: string[];
  apDescription: string | null;
  apDocumentNumber: string | null;
  materializedAt: string;
};

export type Fiscal360PaymentsResponse = Fiscal360Page<Fiscal360PaymentRow> & {
  totals: { amountDue: number; paidCounted: number; paidInReview: number; openBalance: number };
};

export type Fiscal360EvidenceStep = {
  step: string;
  status: "OK" | "MISSING" | "REVIEW" | "INFO";
  detail: string;
  source: string;
  reference: string | null;
};

export type Fiscal360PaymentDetail = {
  fact: Fiscal360PaymentRow & Record<string, unknown>;
  guide: Record<string, unknown> | null;
  proofs: Array<{ id: string; originalFileName: string; uploadedAt: string; uploadedBy: string | null }>;
  apTitle: Record<string, unknown> | null;
  treasury: Array<{ matchId: string; matchedCivilDate: string; amount: number; accountName: string | null }>;
  evidenceTrail: Fiscal360EvidenceStep[];
  reconciliation: Fiscal360ReconciliationRow[];
  decisions: Fiscal360DecisionRow[];
  audit: Fiscal360AuditRow[];
};

export type Fiscal360ReconciliationRow = {
  itemKey: string;
  companyCnpj: string;
  competenceMonth: string;
  taxType: string | null;
  checkType: string;
  status: string;
  subjectType: string | null;
  subjectId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  expectedAmount: number | null;
  actualAmount: number | null;
  difference: number | null;
  message: string;
  computedAt: string;
};

export type Fiscal360ReconciliationResponse = Fiscal360Page<Fiscal360ReconciliationRow> & {
  summary: Array<{ checkType: string; status: string; count: number }>;
};

export type Fiscal360ApTitleRow = {
  apExternalId: number;
  companyCnpj: string;
  companyName: string | null;
  personName: string | null;
  description: string | null;
  nomusClassification: string | null;
  documentNumber: string | null;
  dueDate: string | null;
  competenceMonth: string;
  amountOriginal: number;
  amountPaid: number;
  balance: number;
  effectiveStatus: string;
  classificationStatus: string;
  taxType: string | null;
  suggestedTaxType: string | null;
  classificationConfidence: string;
  classificationRule: string | null;
  claimedByGuideId: string | null;
  isIntercompany: boolean;
  intercompanyCounterpartyCnpj: string | null;
  treasuryPaidDate: string | null;
};

export type Fiscal360DocumentRow = {
  nomusNfeId: string;
  nomusExternalId: number;
  documentKind: string;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  companyCnpj: string;
  recipientCnpj: string | null;
  recipientGroupCnpj: string | null;
  issueDate: string | null;
  competenceMonth: string;
  natOp: string | null;
  fiscalStatus: string;
  operationClass: string;
  isOfficialBilling: boolean;
  officialRevenueAmount: number;
  vNF: number | null;
  highlightedTaxTotal: number;
  xmlStatus: string;
  taxes: Array<{ taxType: string; effect: string; amount: number }>;
};

export type Fiscal360DocumentsResponse = Fiscal360Page<Fiscal360DocumentRow> & {
  byOperation: Array<{ operationClass: string; fiscalStatus: string; count: number; vNF: number; officialRevenue: number; highlighted: number }>;
  nfseAvailable: false;
};

export type Fiscal360DocumentDetail = {
  document: Fiscal360DocumentRow & Record<string, unknown>;
  items: Array<{ itemNumber: number | null; taxType: string; amount: number | null; baseAmount: number | null; rate: number | null; cfop: string | null; ncm: string | null; cst: string | null; csosn: string | null }>;
  itemsTruncated: boolean;
  issues: Fiscal360IssueRow[];
};

export type Fiscal360IntercompanyResponse = {
  pairs: Array<{
    issuerCnpj: string;
    recipientCnpj: string;
    documentCount: number;
    documentValue: number;
    highlightedTaxAmount: number;
    apTitleCount: number;
    apAmount: number;
    apPaidAmount: number;
    apOpenAmount: number;
    divergenceAmount: number;
  }>;
  monthly: Array<{ month: string; issuerCnpj: string; recipientCnpj: string; documentValue: number; apAmount: number }>;
  eliminatedRevenue: number;
  documents: Fiscal360Page<Fiscal360DocumentRow>;
  apTitles: Fiscal360Page<Fiscal360ApTitleRow>;
  nfseAvailable: false;
};

export type Fiscal360ForecastScenarioDto = {
  id: string;
  kind: string;
  systemKey: string | null;
  name: string;
  description: string | null;
  assumptions: Record<string, unknown>;
  horizonMonths: number;
  computedAt: string | null;
  inputVersion: string | null;
  methodologyVersion: string;
  createdByName: string | null;
};

export type Fiscal360ForecastRowDto = {
  companyCnpj: string;
  month: string;
  taxType: string;
  kind: string;
  availability: string;
  unavailableReason: string | null;
  amount: number | null;
  lowAmount: number | null;
  highAmount: number | null;
  revenueBase: number | null;
  ratioUsed: number | null;
  cashMonth: string | null;
  methodology: string;
  overdueAmount: number | null;
};

export type Fiscal360ForecastEffects = {
  taxesDue: number;
  cashOut: number;
  revenue: number;
  taxBurdenPct: number | null;
  workingCapitalFromLag: number;
  arrears: number;
  unavailableCount: number;
};

export type Fiscal360ForecastResponse = {
  scenarios: Fiscal360ForecastScenarioDto[];
  selected: Fiscal360ForecastScenarioDto | null;
  rows: Fiscal360ForecastRowDto[];
  horizon: string[];
  effects: Fiscal360ForecastEffects | null;
  baseEffects: Fiscal360ForecastEffects | null;
  stale: boolean;
  methodologyDoc: string;
};

export type Fiscal360ProcessingResponse = {
  freshness: Fiscal360Freshness;
  runs: Array<{
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    jobsSucceeded: number;
    jobsFailed: number;
    documentsNew: number;
    documentsChanged: number;
    apTitlesChanged: number;
    guidesChanged: number;
    partitionsRebuilt: number;
    monthsAffected: string[];
    integrity: Record<string, number> | null;
  }>;
  jobsByStatus: Array<{ jobType: string; status: string; count: number }>;
  failedJobs: Array<{ id: string; jobType: string; sourceEntity: string; sourceId: string; attempts: number; lastError: string | null; updatedAt: string }>;
  checkpoints: Array<{ key: string; cursorUpdatedAt: string | null; lastRunAt: string | null; lastSuccessAt: string | null }>;
  ruleVersions: Array<{ key: string; version: string; source: "CODE" | "CONFIG"; status?: string; effectiveFrom?: string | null; normativeSource?: string | null }>;
  integrity: Array<{ label: string; source: number; materialized: number; ok: boolean }>;
};

export type Fiscal360IssueRow = {
  id: string;
  issueType: string;
  severity: string;
  entityType: string;
  entityId: string;
  companyCnpj: string | null;
  competenceMonth: string | null;
  taxType: string | null;
  message: string;
  status: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
};

export type Fiscal360DecisionRow = {
  id: string;
  decisionType: string;
  apExternalId: number | null;
  guideId: string | null;
  itemKey: string | null;
  payload: Record<string, unknown>;
  reason: string;
  active: boolean;
  createdByName: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
};

export type Fiscal360AuditRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userName: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
};

export const FISCAL360_DECISION_TYPES = [
  "AP_CONFIRM_TAX",
  "AP_REJECT_TAX",
  "LINK_GUIDE_AP",
  "MARK_DISTINCT",
  "ASSIGN_GUIDE_COMPANY",
  "ACCEPT_DIVERGENCE",
] as const;
export type Fiscal360DecisionType = (typeof FISCAL360_DECISION_TYPES)[number];

export const FISCAL360_DECISION_LABELS: Record<Fiscal360DecisionType, string> = {
  AP_CONFIRM_TAX: "Confirmar título AP como tributo",
  AP_REJECT_TAX: "Marcar título AP como não tributário",
  LINK_GUIDE_AP: "Vincular guia ao título AP",
  MARK_DISTINCT: "Guia e título são obrigações distintas",
  ASSIGN_GUIDE_COMPANY: "Definir empresa da guia",
  ACCEPT_DIVERGENCE: "Aceitar divergência justificada",
};

/** Decisões que podem ser aplicadas em lote: não dependem de dados próprios de cada item além do tributo. */
export const FISCAL360_BATCH_DECISION_TYPES = ["ACCEPT_DIVERGENCE", "AP_CONFIRM_TAX", "AP_REJECT_TAX"] as const;
export type Fiscal360BatchDecisionType = (typeof FISCAL360_BATCH_DECISION_TYPES)[number];
export const FISCAL360_BATCH_MAX = 500;

export type Fiscal360BatchKeys = { keys: string[]; total: number };

export type Fiscal360BatchIssue = { target: string; label: string; reason: string };

export type Fiscal360BatchResult = {
  batchId: string;
  requested: number;
  applied: number;
  skipped: Fiscal360BatchIssue[];
  failed: Fiscal360BatchIssue[];
};

/** Ação de permissão exigida por tipo de decisão. */
export const FISCAL360_DECISION_PERMISSION: Record<Fiscal360DecisionType, "reconcile" | "reclassify"> = {
  AP_CONFIRM_TAX: "reclassify",
  AP_REJECT_TAX: "reclassify",
  LINK_GUIDE_AP: "reconcile",
  MARK_DISTINCT: "reconcile",
  ASSIGN_GUIDE_COMPANY: "reconcile",
  ACCEPT_DIVERGENCE: "reconcile",
};
