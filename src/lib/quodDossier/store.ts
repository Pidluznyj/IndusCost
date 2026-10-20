import type { QuodSections } from "./parse.js";

export type QuodConsultationStatus = "RESERVED" | "SENT" | "SUCCEEDED" | "FAILED" | "UNKNOWN_BILLING" | "PARTIAL";
export type QuodBillingStatus = "NOT_SENT" | "UNKNOWN" | "ESTIMATED";

export type QuodConsultationRecord = {
  id: string;
  customerId: string;
  companyName: string;
  cnpj: string;
  idempotencyKey: string;
  requestedByUserId: string;
  requestedByRole: string;
  status: QuodConsultationStatus;
  billingStatus: QuodBillingStatus;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerHttpStatus: number | null;
  failureCode: string | null;
  score: number | null;
  restrictionCount: number | null;
  confirmedRestriction: boolean;
  insufficient: boolean;
  sections: QuodSections | null;
  partners: Array<{ name: string | null; role: string | null; share: number | null; document: string | null }>;
  validUntil: string | null;
  consultedAt: string | null;
  createdAt: string;
};

export type QuodReserveResult =
  | { ok: true; row: QuodConsultationRecord }
  | { ok: false; code: "IDEMPOTENT"; row: QuodConsultationRecord }
  | { ok: false; code: "IN_FLIGHT" | "UNKNOWN_BILLING" | "BUDGET" | "INTERVAL" | "CACHE_VALID" };

export type QuodStore = {
  findByIdempotency(key: string): Promise<QuodConsultationRecord | null>;
  findLatestSucceeded(customerId: string): Promise<QuodConsultationRecord | null>;
  findById(id: string): Promise<QuodConsultationRecord | null>;
  listByCustomer(customerId: string): Promise<QuodConsultationRecord[]>;
  reserve(input: {
    customerId: string;
    companyName: string;
    cnpj: string;
    idempotencyKey: string;
    requestedByUserId: string;
    requestedByRole: string;
    authorizedCostCents: number;
    now: Date;
    monthlyLimitCents: number;
    monthStart: Date;
    monthEnd: Date;
    maxPerCnpj: number;
    intervalStart: Date;
    forceRefresh: boolean;
    cacheTtlMs: number;
  }): Promise<QuodReserveResult>;
  markSent(id: string): Promise<void>;
  complete(id: string, patch: Partial<QuodConsultationRecord> & { status: QuodConsultationStatus; billingStatus: QuodBillingStatus }): Promise<void>;
};
