import { isGroupCompanyCustomer } from "@/src/lib/groupCompanyCustomer.js";
import { isLogisticsNature, NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";
import type {
  BillingAuditFilters,
  BillingAuditValueMode,
  BillingExclusionReasonCode,
} from "@/src/lib/financeBillingAuditTypes.js";

export type BillingAuditPeriod = {
  from: Date;
  to: Date;
  label: string;
};

export type SalesOrderAuditInput = {
  id: string;
  orderCode: string;
  status: string;
  totalNetValue: number | null;
  customerName: string;
  customerTaxId: string | null;
  invoiceDate: Date | null;
  invoiceStatus: string | null;
};

export type NomusNfeAuditInput = {
  id: string;
  externalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  status: number | null;
  billingClassification: string | null;
  xmlNatOp: string | null;
  xmlDestCnpjCpf: string | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  xmlVProd: number | null;
  xmlVDesc: number | null;
  xmlVNF: number | null;
  valorLiquido: number | null;
  syncedAt: Date | null;
  isMarketSale: boolean;
};

const EXCLUSION_LABELS: Record<BillingExclusionReasonCode, string> = {
  OUT_OF_DATE_RANGE: "Fora do período filtrado",
  WRONG_COMPANY: "Cliente do grupo econômico (não mercado)",
  CANCELLED_NFE: "NF cancelada ou pedido cancelado",
  DENIED_NFE: "NF denegada/inutilizada",
  RETURN_OR_DEVOLUTION: "Devolução/retorno/remessa não faturável",
  NON_REVENUE_OPERATION: "Operação não considerada faturamento",
  MISSING_ISSUE_DATE: "Sem data de emissão/processamento válida",
  MISSING_VALUE: "Sem valor válido",
  DUPLICATED_KEY: "Chave NF-e duplicada",
  NOT_LINKED_TO_ORDER: "Sem pedido vinculado",
  NOT_IMPORTED_FROM_NOMUS: "Não encontrado na base local",
  FILTERED_BY_STATUS: "Filtrado pelo status selecionado",
  FILTERED_BY_CUSTOMER: "Filtrado por cliente/CNPJ",
  FILTERED_BY_SELLER: "Filtrado por vendedor",
  FILTERED_BY_CFOP: "Filtrado por CFOP",
  FILTERED_BY_CLASSIFICATION: "Filtrado por classificação",
  UNKNOWN_REASON: "Motivo não classificado",
};

export function exclusionLabel(code: BillingExclusionReasonCode): string {
  return EXCLUSION_LABELS[code];
}

export function resolveBillingAuditPeriod(filters: BillingAuditFilters): BillingAuditPeriod {
  if (filters.startDate && filters.endDate) {
    const from = new Date(`${filters.startDate}T00:00:00`);
    const to = new Date(`${filters.endDate}T23:59:59.999`);
    return {
      from,
      to,
      label: `${filters.startDate} a ${filters.endDate}`,
    };
  }
  if (filters.month != null) {
    const from = new Date(filters.year, filters.month - 1, 1, 0, 0, 0, 0);
    const to = new Date(filters.year, filters.month, 0, 23, 59, 59, 999);
    return { from, to, label: `${filters.month}/${filters.year}` };
  }
  const from = new Date(filters.year, 0, 1, 0, 0, 0, 0);
  const to = new Date(filters.year, 11, 31, 23, 59, 59, 999);
  return { from, to, label: String(filters.year) };
}

function dateInPeriod(date: Date | null, period: BillingAuditPeriod): boolean {
  if (!date) return false;
  return date.getTime() >= period.from.getTime() && date.getTime() <= period.to.getTime();
}

function normalizeDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function matchesCustomerFilter(
  customerName: string | null,
  customerDocument: string | null,
  filters: BillingAuditFilters
): boolean {
  if (filters.customerName) {
    const q = filters.customerName.toLowerCase();
    if (!(customerName ?? "").toLowerCase().includes(q)) return false;
  }
  if (filters.customerDocument) {
    const q = normalizeDigits(filters.customerDocument);
    const doc = normalizeDigits(customerDocument);
    if (!doc.includes(q)) return false;
  }
  return true;
}

export function resolveSalesOrderCompetenceDate(
  row: SalesOrderAuditInput,
  dateBase: BillingAuditFilters["dateBase"]
): Date | null {
  if (dateBase === "processamento" || dateBase === "competencia") return row.invoiceDate;
  return row.invoiceDate;
}

export function resolveNomusNfeCompetenceDate(
  row: NomusNfeAuditInput,
  dateBase: BillingAuditFilters["dateBase"]
): Date | null {
  if (dateBase === "emissao") return row.xmlDhEmi ?? row.dataProcessamento;
  if (dateBase === "importacao") return row.syncedAt;
  return row.dataProcessamento ?? row.xmlDhEmi;
}

export function resolveSalesOrderDashboardValue(
  row: SalesOrderAuditInput,
  valueMode: BillingAuditValueMode
): number | null {
  if (valueMode !== "pedido_total_net" && valueMode !== "total_nf") return row.totalNetValue;
  return row.totalNetValue;
}

export function resolveNomusNfeValue(
  row: NomusNfeAuditInput,
  valueMode: BillingAuditValueMode
): number | null {
  switch (valueMode) {
    case "liquido":
    case "pedido_total_net":
      return row.valorLiquido;
    case "produtos":
      return row.xmlVProd;
    case "total_nf":
      return row.xmlVNF;
    case "sem_impostos":
      return row.valorLiquido ?? row.xmlVProd;
    default:
      return row.valorLiquido ?? row.xmlVNF;
  }
}

export function evaluateSalesOrderForBilling(
  row: SalesOrderAuditInput,
  filters: BillingAuditFilters,
  period: BillingAuditPeriod
): {
  included: boolean;
  exclusionReasonCode: BillingExclusionReasonCode | null;
  competenceDate: Date | null;
  valueUsed: number | null;
} {
  const competenceDate = resolveSalesOrderCompetenceDate(row, filters.dateBase);
  const valueUsed = resolveSalesOrderDashboardValue(row, filters.valueMode);

  if (row.status === "CANCELLED") {
    return {
      included: false,
      exclusionReasonCode: "CANCELLED_NFE",
      competenceDate,
      valueUsed,
    };
  }

  if (
    isGroupCompanyCustomer({
      taxId: row.customerTaxId,
      companyName: row.customerName,
      tradeName: row.customerName,
    })
  ) {
    return {
      included: false,
      exclusionReasonCode: "WRONG_COMPANY",
      competenceDate,
      valueUsed,
    };
  }

  if (!competenceDate) {
    return {
      included: false,
      exclusionReasonCode: "MISSING_ISSUE_DATE",
      competenceDate,
      valueUsed,
    };
  }

  if (!dateInPeriod(competenceDate, period)) {
    return {
      included: false,
      exclusionReasonCode: "OUT_OF_DATE_RANGE",
      competenceDate,
      valueUsed,
    };
  }

  if (!matchesCustomerFilter(row.customerName, row.customerTaxId, filters)) {
    return {
      included: false,
      exclusionReasonCode: "FILTERED_BY_CUSTOMER",
      competenceDate,
      valueUsed,
    };
  }

  if (valueUsed == null || !Number.isFinite(valueUsed) || valueUsed <= 0) {
    return {
      included: false,
      exclusionReasonCode: "MISSING_VALUE",
      competenceDate,
      valueUsed,
    };
  }

  return { included: true, exclusionReasonCode: null, competenceDate, valueUsed };
}

export function evaluateNomusNfeForBilling(
  row: NomusNfeAuditInput,
  filters: BillingAuditFilters,
  period: BillingAuditPeriod
): {
  included: boolean;
  exclusionReasonCode: BillingExclusionReasonCode | null;
  competenceDate: Date | null;
  valueUsed: number | null;
} {
  const competenceDate = resolveNomusNfeCompetenceDate(row, filters.dateBase);
  const valueUsed = resolveNomusNfeValue(row, filters.valueMode);

  if (!filters.includeCancelled && row.status === NOMUS_NFE_STATUS_CANCELLED) {
    return {
      included: false,
      exclusionReasonCode: "CANCELLED_NFE",
      competenceDate,
      valueUsed,
    };
  }

  if (!filters.includeReturns && isLogisticsNature(row.xmlNatOp)) {
    return {
      included: false,
      exclusionReasonCode: "RETURN_OR_DEVOLUTION",
      competenceDate,
      valueUsed,
    };
  }

  if (row.billingClassification && row.billingClassification !== "MARKET_REVENUE") {
    return {
      included: false,
      exclusionReasonCode: "NON_REVENUE_OPERATION",
      competenceDate,
      valueUsed,
    };
  }

  if (!row.isMarketSale && row.billingClassification === "MARKET_REVENUE") {
    return {
      included: false,
      exclusionReasonCode: "FILTERED_BY_CLASSIFICATION",
      competenceDate,
      valueUsed,
    };
  }

  if (filters.classification && filters.classification !== "all") {
    const map: Record<string, string> = {
      market: "MARKET_REVENUE",
      group: "INTERCOMPANY",
      logistics: "LOGISTICS_NOT_REVENUE",
    };
    const expected = map[filters.classification];
    if (expected && row.billingClassification !== expected) {
      return {
        included: false,
        exclusionReasonCode: "FILTERED_BY_CLASSIFICATION",
        competenceDate,
        valueUsed,
      };
    }
  }

  if (filters.status === "authorized" && row.status === NOMUS_NFE_STATUS_CANCELLED) {
    return {
      included: false,
      exclusionReasonCode: "FILTERED_BY_STATUS",
      competenceDate,
      valueUsed,
    };
  }

  if (filters.status === "cancelled" && row.status !== NOMUS_NFE_STATUS_CANCELLED) {
    return {
      included: false,
      exclusionReasonCode: "FILTERED_BY_STATUS",
      competenceDate,
      valueUsed,
    };
  }

  if (!competenceDate) {
    return {
      included: false,
      exclusionReasonCode: "MISSING_ISSUE_DATE",
      competenceDate,
      valueUsed,
    };
  }

  if (!dateInPeriod(competenceDate, period)) {
    return {
      included: false,
      exclusionReasonCode: "OUT_OF_DATE_RANGE",
      competenceDate,
      valueUsed,
    };
  }

  if (filters.customerDocument) {
    const q = normalizeDigits(filters.customerDocument);
    const doc = normalizeDigits(row.xmlDestCnpjCpf);
    if (!doc.includes(q)) {
      return {
        included: false,
        exclusionReasonCode: "FILTERED_BY_CUSTOMER",
        competenceDate,
        valueUsed,
      };
    }
  }

  if (valueUsed == null || !Number.isFinite(valueUsed)) {
    return {
      included: false,
      exclusionReasonCode: "MISSING_VALUE",
      competenceDate,
      valueUsed,
    };
  }

  return { included: true, exclusionReasonCode: null, competenceDate, valueUsed };
}

export function sanitizeAuditMoney(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
