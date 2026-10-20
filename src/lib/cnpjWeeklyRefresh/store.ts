import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import type { CnpjRefreshPartyDocument } from "./eligibility.js";

export const CNPJ_REFRESH_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "INTERRUPTED",
] as const;

export type CnpjRefreshRunStatus = (typeof CNPJ_REFRESH_RUN_STATUSES)[number];
export type CnpjRefreshTrigger = "SCHEDULED" | "MANUAL" | "RETRY_FAILURES";
export type CnpjRefreshItemStatus =
  | "PENDING"
  | "UPDATED"
  | "UNCHANGED"
  | "FAILED"
  | "PARTIAL"
  | "INVALID_DOCUMENT"
  | "MISSING_DOCUMENT";

export type CnpjRefreshRunRecord = {
  id: string;
  scheduleSlot: string | null;
  trigger: CnpjRefreshTrigger;
  status: CnpjRefreshRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  eligibleCount: number;
  consultedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  partialCount: number;
  invalidCount: number;
  missingDocumentCount: number;
  customerCount: number;
  supplierCount: number;
  lastCnpj: string | null;
  sourceLabel: string | null;
  statusDetail: string | null;
  errorMessage: string | null;
  requestedByUserId: string | null;
  createdAt: Date;
};

export type CnpjRefreshItemRecord = {
  id: string;
  runId: string;
  subjectKey: string;
  cnpj: string | null;
  status: CnpjRefreshItemStatus;
  partyKind: string;
  customerId: string | null;
  supplierIds: string[];
  digitLength: number | null;
  documentClass: string;
  attempts: number;
  lookupId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  consultedAt: Date | null;
};

export type CnpjRefreshLookupRecord = {
  id: string;
  cnpj: string;
  customerId: string | null;
  summary: NormalizedCnpjSummary;
  riskScore: number;
  riskVerdict: string;
  fetchedAt: Date;
};

export type CnpjRefreshChangeRecord = {
  id: string;
  runId: string;
  cnpj: string;
  field: string;
  previousValue: string | null;
  nextValue: string | null;
  source: string | null;
  consultedAt: Date;
  detectedAt: Date;
  lookupId: string | null;
};

export type CnpjRefreshDivergenceRecord = {
  id: string;
  runId: string;
  cnpj: string;
  partyKind: string;
  partyId: string;
  field: string;
  officialValue: string | null;
  consultedValue: string | null;
  detectedAt: Date;
};

export type CustomerOfficialSnapshot = {
  id: string;
  companyName: string;
  tradeName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  taxId: string;
};

export type SupplierOfficialSnapshot = {
  id: string;
  legalName: string | null;
  tradeName: string | null;
  displayName: string;
};

export type CnpjRefreshAuditRecord = {
  entityType: string;
  entityId: string;
  action: string;
  newValue: string | null;
  performedBy: string | null;
};

export type CnpjRefreshStore = {
  listParties(): Promise<CnpjRefreshPartyDocument[]>;
  findScheduledRun(slot: string): Promise<CnpjRefreshRunRecord | null>;
  findRun(id: string): Promise<CnpjRefreshRunRecord | null>;
  findRunning(now: Date, staleMs: number): Promise<CnpjRefreshRunRecord | null>;
  insertRun(run: CnpjRefreshRunRecord): Promise<CnpjRefreshRunRecord>;
  updateRun(id: string, patch: Partial<CnpjRefreshRunRecord>): Promise<void>;
  listItems(runId: string): Promise<CnpjRefreshItemRecord[]>;
  insertItems(items: CnpjRefreshItemRecord[]): Promise<void>;
  updateItem(id: string, patch: Partial<CnpjRefreshItemRecord>): Promise<void>;
  latestLookup(cnpj: string): Promise<CnpjRefreshLookupRecord | null>;
  insertLookup(input: {
    cnpj: string;
    customerId: string | null;
    source: string;
    summary: NormalizedCnpjSummary;
    riskScore: number;
    riskVerdict: string;
    riskDetails: unknown;
    commercialInsights: unknown;
    rawJson: unknown;
    fetchedAt: Date;
    expiresAt: Date;
    fetchedByUserId: string | null;
  }): Promise<CnpjRefreshLookupRecord>;
  insertChanges(rows: CnpjRefreshChangeRecord[]): Promise<void>;
  insertDivergences(rows: CnpjRefreshDivergenceRecord[]): Promise<void>;
  listRuns(limit: number): Promise<CnpjRefreshRunRecord[]>;
  listChanges(runId: string, limit: number): Promise<CnpjRefreshChangeRecord[]>;
  readCustomer(id: string): Promise<CustomerOfficialSnapshot | null>;
  readSupplier(id: string): Promise<SupplierOfficialSnapshot | null>;
  audit(entry: CnpjRefreshAuditRecord): Promise<void>;
};
