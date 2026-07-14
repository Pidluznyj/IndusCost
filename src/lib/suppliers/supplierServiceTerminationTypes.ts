/** Tipos compartilhados — Encerramento de Prestação de Serviço (seguros no frontend). */

export type ServiceTerminationStatusDto = "DRAFT" | "FINALIZED" | "CANCELED";
export type ServiceTerminationCalcModeDto = "WORKED_MONTHS" | "WORKED_DAYS";

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

export type ServiceTerminationDto = {
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

export type ServiceTerminationPreviewInput = {
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
  CANCEL: "SERVICE_TERMINATION_CANCEL",
  EXPORT_PDF: "SERVICE_TERMINATION_EXPORT_PDF",
  EXPORT_XLSX: "SERVICE_TERMINATION_EXPORT_XLSX",
} as const;
