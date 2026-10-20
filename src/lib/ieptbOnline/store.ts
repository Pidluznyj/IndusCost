import type { IeptbSections } from "./parse.js";

export type IeptbConsultationStatus = "RESERVED" | "SENT" | "SUCCEEDED" | "FAILED" | "UNKNOWN_BILLING" | "PARTIAL";
export type IeptbBillingStatus = "NOT_SENT" | "UNKNOWN" | "ESTIMATED";

export type IeptbConsultationRecord = {
  id: string;
  customerId: string;
  companyName: string;
  cnpj: string;
  idempotencyKey: string;
  requestedByUserId: string;
  requestedByRole: string;
  status: IeptbConsultationStatus;
  billingStatus: IeptbBillingStatus;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerHttpStatus: number | null;
  failureCode: string | null;
  confirmedProtest: boolean;
  confirmedClear: boolean;
  insufficient: boolean;
  protestCount: number | null;
  totalAmount: number | null;
  states: string[];
  coverageNote: string;
  sections: IeptbSections | null;
  validUntil: string | null;
  consultedAt: string | null;
  createdAt: string;
};

export type IeptbReserveResult =
  | { ok: true; row: IeptbConsultationRecord }
  | { ok: false; code: "IDEMPOTENT"; row: IeptbConsultationRecord }
  | { ok: false; code: "IN_FLIGHT" | "UNKNOWN_BILLING" | "BUDGET" | "INTERVAL" | "CACHE_VALID" };

export type IeptbStore = {
  findByIdempotency(key: string): Promise<IeptbConsultationRecord | null>;
  findLatestSucceeded(customerId: string): Promise<IeptbConsultationRecord | null>;
  findById(id: string): Promise<IeptbConsultationRecord | null>;
  listByCustomer(customerId: string): Promise<IeptbConsultationRecord[]>;
  monthSpend(monthStart: Date, monthEnd: Date): Promise<number>;
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
  }): Promise<IeptbReserveResult>;
  markSent(id: string): Promise<void>;
  complete(
    id: string,
    patch: Partial<IeptbConsultationRecord> & { status: IeptbConsultationStatus; billingStatus: IeptbBillingStatus }
  ): Promise<void>;
};
