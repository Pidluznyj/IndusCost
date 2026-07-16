/**
 * DTO client-safe — apuração (B), guias/recolhimento (C), alocação gerencial (D).
 * Destacados da NF (A) nunca são tratados como pagos aqui.
 */

export const FISCAL_GUIDE_TYPES = [
  "DARF",
  "GNRE",
  "DAS",
  "DAE",
  "GPS",
  "STATE_GUIDE",
  "MUNICIPAL_GUIDE",
  "OTHER",
] as const;

export type FiscalGuideTypeCode = (typeof FISCAL_GUIDE_TYPES)[number];

export const FISCAL_GUIDE_TYPE_LABELS: Record<FiscalGuideTypeCode, string> = {
  DARF: "DARF",
  GNRE: "GNRE",
  DAS: "DAS",
  DAE: "DAE",
  GPS: "GPS",
  STATE_GUIDE: "Guia estadual",
  MUNICIPAL_GUIDE: "Guia municipal",
  OTHER: "Outros",
};

export const FISCAL_JURISDICTIONS = [
  "FEDERAL",
  "STATE",
  "MUNICIPAL",
  "REFORM",
] as const;

export type FiscalJurisdictionCode = (typeof FISCAL_JURISDICTIONS)[number];

export const FISCAL_GUIDE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "REVERSED",
] as const;

export type FiscalGuideStatusCode = (typeof FISCAL_GUIDE_STATUSES)[number];

export const FISCAL_GUIDE_STATUS_LABELS: Record<FiscalGuideStatusCode, string> = {
  DRAFT: "Rascunho",
  ISSUED: "Emitida",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Paga",
  CANCELLED: "Cancelada",
  REVERSED: "Estornada",
};

export const FISCAL_ALLOCATION_METHODS = [
  "PRO_RATA_HIGHLIGHTED",
  "DIRECT_GUIDE_NFE",
  "MANUAL",
] as const;

export type FiscalAllocationMethodCode =
  (typeof FISCAL_ALLOCATION_METHODS)[number];

export const FISCAL_ALLOCATION_METHOD_LABELS: Record<
  FiscalAllocationMethodCode,
  string
> = {
  PRO_RATA_HIGHLIGHTED: "Proporcional ao débito destacado (NF)",
  DIRECT_GUIDE_NFE: "Vínculo direto guia ↔ NF",
  MANUAL: "Manual auditado",
};

export type FiscalMoneyBreakdown = {
  assessedAmount: number;
  creditsAmount: number;
  compensationsAmount: number;
  interestAmount: number;
  fineAmount: number;
  amountDue: number;
  amountPaid: number;
  balanceDue: number;
};

export type FiscalApurationLineDto = {
  id: string;
  periodId: string;
  taxType: string;
  nature: string;
  revenueCode: string | null;
  assessedAmount: number;
  creditsAmount: number;
  compensationsAmount: number;
  interestAmount: number;
  fineAmount: number;
  amountDue: number;
  notes: string | null;
  source: string;
};

export type FiscalApurationPeriodDto = {
  id: string;
  companyName: string | null;
  jurisdiction: FiscalJurisdictionCode;
  uf: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
  notes: string | null;
  source: string;
  closedAt: string | null;
  lines: FiscalApurationLineDto[];
  totals: {
    assessedAmount: number;
    creditsAmount: number;
    compensationsAmount: number;
    interestAmount: number;
    fineAmount: number;
    amountDue: number;
  };
};

export type FiscalPaymentProofDto = {
  id: string;
  guideId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
};

export type FiscalAllocationDto = {
  id: string;
  guideId: string;
  settlementId: string;
  salesOrderId: string | null;
  nomusNfeId: string | null;
  taxType: string;
  allocatedAmount: number;
  allocationMethod: FiscalAllocationMethodCode;
  allocationBase: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  calculatedAt: string;
  version: number;
  manualOverride: boolean;
  notes: string | null;
  /** Sempre true — UI não deve rotular como pagamento oficial da NF. */
  isManagerialOnly: true;
};

export type FiscalPaymentGuideDto = FiscalMoneyBreakdown & {
  id: string;
  periodId: string | null;
  taxType: string;
  jurisdiction: FiscalJurisdictionCode;
  revenueCode: string | null;
  guideType: FiscalGuideTypeCode;
  guideTypeLabel: string;
  guideNumber: string | null;
  barcode: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  paidAt: string | null;
  status: FiscalGuideStatusCode;
  statusLabel: string;
  paymentAccount: string | null;
  accountsPayableExternalId: number | null;
  /** Espelho do AP Nomus quando vinculado (fonte oficial do pago). */
  accountsPayable: {
    externalId: number;
    documentNumber: string | null;
    personName: string | null;
    amountPaid: number | null;
    balancePayable: number | null;
    paymentDate: string | null;
    settlementDate: string | null;
  } | null;
  costCenterId: string | null;
  dedupeKey: string | null;
  source: string;
  notes: string | null;
  cancelledAt: string | null;
  proofs: FiscalPaymentProofDto[];
  allocations: FiscalAllocationDto[];
  allocatedTotal: number;
};

export function computeFiscalAmountDue(input: {
  assessedAmount: number;
  creditsAmount?: number;
  compensationsAmount?: number;
  interestAmount?: number;
  fineAmount?: number;
}): number {
  const assessed = Math.max(0, input.assessedAmount || 0);
  const credits = Math.max(0, input.creditsAmount || 0);
  const comps = Math.max(0, input.compensationsAmount || 0);
  const interest = Math.max(0, input.interestAmount || 0);
  const fine = Math.max(0, input.fineAmount || 0);
  return round2(Math.max(0, assessed - credits - comps + interest + fine));
}

export function computeFiscalBalanceDue(
  amountDue: number,
  amountPaid: number
): number {
  return round2(Math.max(0, amountDue - Math.max(0, amountPaid)));
}

export function resolveFiscalGuideStatus(input: {
  status?: FiscalGuideStatusCode | null;
  amountDue: number;
  amountPaid: number;
  cancelled?: boolean;
  reversed?: boolean;
}): FiscalGuideStatusCode {
  if (input.cancelled) return "CANCELLED";
  if (input.reversed) return "REVERSED";
  if (input.status === "CANCELLED" || input.status === "REVERSED") {
    return input.status;
  }
  const paid = Math.max(0, input.amountPaid);
  const due = Math.max(0, input.amountDue);
  if (paid <= 0.009) {
    return input.status === "DRAFT" ? "DRAFT" : "ISSUED";
  }
  if (paid + 0.009 >= due && due > 0) return "PAID";
  if (paid > 0.009 && paid < due) return "PARTIALLY_PAID";
  return "ISSUED";
}

export function buildFiscalGuideDedupeKey(input: {
  guideType: string;
  guideNumber?: string | null;
  revenueCode?: string | null;
  periodStart: string;
  periodEnd: string;
}): string | null {
  const number = (input.guideNumber ?? "").trim().toUpperCase();
  if (!number) return null;
  const rev = (input.revenueCode ?? "").trim().toUpperCase() || "-";
  return [
    input.guideType,
    number,
    rev,
    input.periodStart.slice(0, 10),
    input.periodEnd.slice(0, 10),
  ].join("|");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
