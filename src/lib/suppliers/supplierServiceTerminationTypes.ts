/** Tipos compartilhados — Encerramento / Distrato de Prestação de Serviço PJ. */

export type ServiceTerminationStatusDto =
  | "DRAFT"
  | "AWAITING_SIGNATURE"
  | "SIGNED_AWAITING_PAYMENT"
  | "PAID_AND_SETTLED"
  | "CANCELED";

export type ServiceTerminationCalcModeDto = "WORKED_MONTHS" | "WORKED_DAYS";

export type ServiceTerminationTerminationModalityDto =
  | "MUTUAL_AGREEMENT"
  | "CONTRACTOR_INITIATIVE"
  | "CONTRACTED_INITIATIVE";

export type ServiceTerminationCommissionTreatmentDto =
  | "NONE_PENDING"
  | "HAS_PENDING"
  | "NEGOTIATED_INCLUDED";

export type ServiceTerminationNoticeOriginDto =
  | "CONTRACT_CLAUSE"
  | "AGREEMENT"
  | "OTHER";

export type ServiceTerminationCommissionLinkDto = {
  id?: string;
  commissionReportKey: string;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  periodLabel: string | null;
  /** Nº do pedido (relatório oficial ou lançamento manual). */
  orderCode: string | null;
  commissionAmount: number;
  source: string | null;
  statusLabel: string | null;
  /** Deep-link relativo ao módulo Comissões. */
  commissionsHref: string | null;
};

/** Campos civis/contratuais do distrato (além do cálculo interno). */
export type ServiceTerminationDistratoFields = {
  documentCode: string | null;
  documentVersion: number;
  supersedesId: string | null;
  originalContractDate: string | null;
  originalContractReference: string | null;
  contractingPartyName: string | null;
  contractingPartyDocument: string | null;
  contractingPartyRepName: string | null;
  contractingPartyRepRole: string | null;
  contractingPartyRepDocument: string | null;
  contractedPartyName: string | null;
  contractedPartyDocument: string | null;
  contractedPartyRepName: string | null;
  contractedPartyRepDocument: string | null;
  contractedServiceDescription: string | null;
  signaturePlace: string | null;
  terminationModality: ServiceTerminationTerminationModalityDto | null;
  terminationReason: string | null;
  paymentDueDate: string | null;
  paymentMethod: string | null;
  paymentTransactionId: string | null;
  paymentEffectiveDate: string | null;
  paymentConfirmedAmount: number | null;
  paymentProofStorageKey: string | null;
  paymentProofFileName: string | null;
  paymentProofWaiverReason: string | null;
  commissionTreatment: ServiceTerminationCommissionTreatmentDto | null;
  commissionPendingNotes: string | null;
  commissionNegotiatedAmount: number | null;
  commissionNegotiatedOrders: string | null;
  commissionNegotiatedJustification: string | null;
  commissionNegotiatedApprover: string | null;
  noticePenaltyOrigin: ServiceTerminationNoticeOriginDto | null;
  noticePenaltyClauseNumber: string | null;
  noticePenaltyClauseDescription: string | null;
  proportionalCompensationJustification: string | null;
  extraServicesDescription: string | null;
  otherDiscountsDescription: string | null;
  contractualNotes: string | null;
  pendingObligationsNotes: string | null;
  hasPendingObligations: boolean;
  witness1Name: string | null;
  witness1Document: string | null;
  witness2Name: string | null;
  witness2Document: string | null;
  integrityCode: string | null;
  settledSnapshotJson: unknown | null;
  contractTypeConfirmedPj: boolean;
};

export type ServiceTerminationDto = ServiceTerminationDistratoFields & {
  id: string;
  supplierId: string;
  supplierName: string;
  personName: string;
  personDocument: string | null;
  serviceRole: string | null;
  contractStartDate: string;
  contractEndDate: string;
  monthlyServiceAmount: number;
  averageWorkedDaysPerMonth: number;
  hoursPerDay: number;
  monthlyHours: number;
  hourlyServiceAmount: number;
  dailyServiceAmount: number;
  restDaysPerYear: number;
  calculationMode: ServiceTerminationCalcModeDto;
  workedMonths: number;
  workedDays: number;
  proportionalRestDays: number;
  proportionalRestAmount: number;
  extraWorkedDays: number;
  extraWorkedAmount: number;
  noticePenaltyAmount: number;
  commissionReportId: string | null;
  commissionReportTotal: number;
  otherCredits: number;
  otherDiscounts: number;
  otherAdjustments: number;
  totalTerminationAmount: number;
  status: ServiceTerminationStatusDto;
  notes: string | null;
  adjustmentNotes: string | null;
  createdByName: string | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commissionLinks: ServiceTerminationCommissionLinkDto[];
};

export type ServiceTerminationPreviewInput = Partial<ServiceTerminationDistratoFields> & {
  personName: string;
  personDocument?: string | null;
  serviceRole?: string | null;
  contractStartDate: string;
  contractEndDate: string;
  monthlyServiceAmount: number;
  averageWorkedDaysPerMonth?: number | null;
  hoursPerDay?: number | null;
  monthlyHours?: number | null;
  restDaysPerYear?: number;
  calculationMode?: ServiceTerminationCalcModeDto;
  workedMonths?: number | null;
  workedDays?: number | null;
  extraWorkedDays?: number | null;
  noticePenaltyAmount?: number | null;
  commissionReportTotal?: number | null;
  otherCredits?: number | null;
  otherDiscounts?: number | null;
  notes?: string | null;
  adjustmentNotes?: string | null;
  commissionLinks?: ServiceTerminationCommissionLinkDto[];
};

/** Agregado legado (período/vendedor) — ainda aceito na UI se vier do histórico. */
export type ServiceTerminationCommissionSearchHit = {
  reportKey: string;
  commissionPersonId: string | null;
  commissionPersonName: string;
  periodLabel: string;
  commissionAmount: number;
  statusLabel: string;
  source: string;
  commissionsHref: string;
};

/** Linha do relatório oficial (pedido / CR) — mesma fonte de Comissões > Relatórios. */
export type ServiceTerminationCommissionOrderRow = {
  lineKey: string;
  year: number;
  month: number;
  settlementDate: string | null;
  sellerId: string | null;
  sellerName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  receivableNumber: string | null;
  receivedAmount: number;
  commissionableBaseAmount: number;
  ratePercent: number;
  finalCommissionAmount: number;
  lineStatus: string;
  statusReason: string | null;
  periodStatus: string;
  source: string;
  commissionsHref: string;
};

export type ServiceTerminationCommissionSellerOption = {
  value: string;
  label: string;
};

export type ServiceTerminationCommissionSearchResult = {
  sellerOptions: ServiceTerminationCommissionSellerOption[];
  summary: {
    totalCommission: number;
    commissionableBase: number;
    receivedAmount: number;
    recordCount: number;
  };
  records: ServiceTerminationCommissionOrderRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filtersApplied: {
    year: number;
    months: number[] | "all";
    sellerId: string | "all";
    search: string | null;
  };
};

export const SERVICE_TERMINATION_AUDIT_ENTITY = "SupplierServiceTermination";
export const SERVICE_TERMINATION_AUDIT_ACTIONS = {
  PREVIEW: "SERVICE_TERMINATION_PREVIEW",
  CREATE: "SERVICE_TERMINATION_CREATE",
  UPDATE: "SERVICE_TERMINATION_UPDATE",
  LINK_COMMISSION: "SERVICE_TERMINATION_LINK_COMMISSION",
  UNLINK_COMMISSION: "SERVICE_TERMINATION_UNLINK_COMMISSION",
  FINALIZE: "SERVICE_TERMINATION_FINALIZE",
  STATUS_CHANGE: "SERVICE_TERMINATION_STATUS_CHANGE",
  PAYMENT_CONFIRM: "SERVICE_TERMINATION_PAYMENT_CONFIRM",
  VERSION_CREATE: "SERVICE_TERMINATION_VERSION_CREATE",
  CANCEL: "SERVICE_TERMINATION_CANCEL",
  EXPORT_PDF: "SERVICE_TERMINATION_EXPORT_PDF",
  EXPORT_XLSX: "SERVICE_TERMINATION_EXPORT_XLSX",
  PROOF_UPLOAD: "SERVICE_TERMINATION_PROOF_UPLOAD",
} as const;
