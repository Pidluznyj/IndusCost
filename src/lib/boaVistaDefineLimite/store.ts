import type { BoaVistaSections } from "./parse.js";

export type BoaVistaConsultationStatus = "RESERVED" | "SENT" | "SUCCEEDED" | "FAILED" | "UNKNOWN_BILLING" | "PARTIAL";
export type BoaVistaBillingStatus = "NOT_SENT" | "UNKNOWN" | "ESTIMATED" | "NOT_APPLICABLE";
/** LIVE = consulta real ao provedor; DEMO = fixture sintética (nunca sai da máquina, nunca é cobrada). */
export type BoaVistaConsultationMode = "LIVE" | "DEMO";

export type BoaVistaConsultationRecord = {
  id: string;
  customerId: string;
  companyName: string;
  cnpj: string;
  mode: BoaVistaConsultationMode;
  idempotencyKey: string;
  requestedByUserId: string;
  requestedByRole: string;
  status: BoaVistaConsultationStatus;
  billingStatus: BoaVistaBillingStatus;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerHttpStatus: number | null;
  providerResult: string | null;
  failureCode: string | null;
  scoreRaw: string | null;
  score: number | null;
  scoreClass: string | null;
  riskText: string | null;
  defaultProbability: string | null;
  suggestedLimitCents: number | null;
  suggestedLimitLabel: string | null;
  restrictionCount: number | null;
  confirmedRestriction: boolean;
  insufficient: boolean;
  sections: BoaVistaSections | null;
  rawPayload: unknown | null;
  parserVersion: string | null;
  receiptUrl: string | null;
  validUntil: string | null;
  consultedAt: string | null;
  createdAt: string;
};

export type BoaVistaReserveResult =
  | { ok: true; row: BoaVistaConsultationRecord }
  | { ok: false; code: "IDEMPOTENT"; row: BoaVistaConsultationRecord }
  | { ok: false; code: "IN_FLIGHT" | "UNKNOWN_BILLING" | "CACHE_VALID" };

export type BoaVistaStore = {
  findByIdempotency(key: string): Promise<BoaVistaConsultationRecord | null>;
  /** Última consulta concluída do cliente no modo informado (cache por cliente e produto; DEMO nunca satisfaz LIVE). */
  findLatestSucceeded(customerId: string, mode: BoaVistaConsultationMode): Promise<BoaVistaConsultationRecord | null>;
  findById(id: string): Promise<BoaVistaConsultationRecord | null>;
  listByCustomer(customerId: string): Promise<BoaVistaConsultationRecord[]>;
  reserve(input: {
    customerId: string;
    companyName: string;
    cnpj: string;
    mode: BoaVistaConsultationMode;
    idempotencyKey: string;
    requestedByUserId: string;
    requestedByRole: string;
    authorizedCostCents: number;
    now: Date;
    forceRefresh: boolean;
    /** Com forceRefresh, uma consulta válida mais recente que este intervalo ainda é devolvida como CACHE_VALID. */
    minRefreshIntervalMs: number;
  }): Promise<BoaVistaReserveResult>;
  markSent(id: string): Promise<void>;
  complete(
    id: string,
    patch: Partial<BoaVistaConsultationRecord> & { status: BoaVistaConsultationStatus; billingStatus: BoaVistaBillingStatus }
  ): Promise<void>;
};
