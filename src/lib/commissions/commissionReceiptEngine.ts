/**
 * Motor puro de prévia de comissão por recebimento.
 *
 * A competência do mês vem da DATA REAL DO RECEBIMENTO
 * (`NomusReceivableReceipt.receiptDate`), nunca da baixa do Contas a Receber.
 * `settlementDate` continua carregada nas linhas como dado administrativo
 * auditável ("Baixa"), sem participar de nenhuma seleção temporal.
 *
 * Não grava fechamento — apenas calcula/agrega linhas auditáveis.
 */
import {
  computeCompetenceReleaseBreakdown,
  isReceiptInCompetencePeriod,
  type CommissionReceiptCompetence,
} from "./commissionReceiptCompetence.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  applyCustomerExclusionToCommission,
  resolveCustomerExclusionForSale,
  type FindApplicableCustomerExclusionResult,
} from "./commissionCustomerExclusionApply.js";
import {
  allocateProportional,
  computeCommissionAmount,
  RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL,
  resolveReceivableCommissionPrincipal,
  roundMoney,
} from "./commission-money.js";
import {
  buildCommissionReceiptLedgerLineKey,
  normalizeCommissionLedgerMoney,
  serializeCommissionRuleSnapshot,
  type CommissionReceiptLedgerLineStatus,
} from "./commissionReceiptLedger.js";
import { selectBestMatchingRule } from "./commission-rule-engine.js";
import {
  resolveCommissionRuleReferenceDate,
} from "./commission-source-resolver.js";
import {
  mapCommissionReceiptSellerToLineFields,
  resolveCommissionReceiptSeller,
  type CommissionReceiptSellerRecordInput,
} from "./commissionReceiptSeller.js";
import {
  isNomusOrderSellerResolved,
  resolveOrderCommissionSeller,
  type NomusOrderSellerResolution,
} from "./commissionNomusOrderSellerResolver.js";
import {
  sellerNameMatchesFilter,
  type CommissionSellerIdentityContext,
  type CommissionSellerIdentityResolution,
} from "./commissionSellerIdentity.js";
import type {
  CommissionActiveRule,
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
} from "./commission-types.js";
import type { CommissionReceivableScheduleStatusValue } from "./commissionReceivableScheduler.js";
import {
  isCommissionScheduleFromActiveSnapshot,
  keepSchedulesFromActiveSnapshot,
} from "./commissionScheduleVigency.js";
import { COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON } from "../salesOrderNomusSeller.shared.js";
import {
  COMMISSION_GROUP_COMPANY_EXCLUSION_REASON,
  isCommissionInternalGroupReceivable,
} from "./commissionInternalGroupExclusion.js";
import { COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON } from "./commissionSalesOrderNfeLinkResolution.js";

import type { VisualAuditRow } from "./commissionVisualAudit.js";

export const COMMISSION_RECEIPT_EXCEPTION_STATUSES: CommissionReceiptLedgerLineStatus[] = [
  "NO_SALES_LINK",
  "NO_SCHEDULE",
  "NO_SELLER",
  "SELLER_UNRESOLVED",
  "NO_RULE",
  "NO_MARGIN",
  "COMMISSION_SOURCE_MISMATCH",
  "STALE_SCHEDULE",
  "ZERO_AMOUNT",
  "ERROR",
];

/** Alerta quando a listagem principal diverge do snapshot oficial do pedido. */
export const COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT =
  "COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT";

/** Motivo padrão quando CR recebido não possui CommissionReceivableSchedule materializado. */
export const COMMISSION_RECEIPT_NO_SCHEDULE_REASON =
  "Título recebido sem schedule de comissão materializável após tentativa de materialização";

/** Motivo quando a NF do título não está vinculada a um pedido de venda local. */
export const COMMISSION_RECEIPT_NO_SALES_ORDER_REASON =
  "Título recebido sem vínculo com pedido de venda";

/** Motivo padrão na exportação/prévia quando a exclusão vem de regra cadastrada. */
export const COMMISSION_RECEIPT_CUSTOMER_EXCLUDED_BY_RULE_REASON =
  "CLIENTE_EXCLUIDO_POR_REGRA";

export type CommissionOrderSnapshotDiagnosis = {
  exists: boolean;
  itemStatuses: string[];
  /** totalFinalCommissionAmount do CommissionOrderSnapshot ACTIVE (quando conhecido). */
  totalFinalCommissionAmount?: number;
};

export type MaterializedReceivableScheduleInput = {
  id: string;
  orderSnapshotId: string;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  nfeId: number | null;
  salesOrderId: string;
  customerId: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  orderCode: string | null;
  receivableNominalAmount: number;
  receivableSharePercent: number;
  scheduledCommissionAmount: number;
  scheduleStatus: CommissionReceivableScheduleStatusValue;
  /** Comissão bruta antes da exclusão (quando schedule CUSTOMER_EXCLUDED). */
  grossScheduledCommissionAmount?: number | null;
  sellerResolutionStatus: string | null;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
  /** Status dos itens no snapshot (diagnóstico quando comissão zerada). */
  itemSnapshotStatuses?: string[];
  /** Comissão final do CommissionOrderSnapshot ligado ao schedule (fonte oficial da Auditoria 360º). */
  orderSnapshotFinalCommissionAmount?: number;
  orderSnapshotStatus?: string | null;
};

export function resolveMaterializedItemExclusionMeta(
  itemSnapshot:
    | {
        exclusionReason: string | null;
        status: string;
        ruleSnapshotJson: unknown;
      }
    | null
    | undefined
): { exclusionRuleId: string | null; exclusionReason: string | null } {
  if (!itemSnapshot) {
    return { exclusionRuleId: null, exclusionReason: null };
  }
  const exclusionReason = itemSnapshot.exclusionReason?.trim() || null;
  if (itemSnapshot.ruleSnapshotJson != null && typeof itemSnapshot.ruleSnapshotJson === "object") {
    const raw = (itemSnapshot.ruleSnapshotJson as Record<string, unknown>).exclusionRuleId;
    if (typeof raw === "string" && raw.trim()) {
      return { exclusionRuleId: raw.trim(), exclusionReason };
    }
  }
  return { exclusionRuleId: null, exclusionReason };
}

export function resolveMaterializedScheduleExclusionRuleId(input: {
  schedule: Pick<
    MaterializedReceivableScheduleInput,
    "customerId" | "scheduleStatus" | "exclusionRuleId"
  >;
  receivable: Pick<
    CommissionReceiptReceivableInput,
    "customerId" | "customerExternalId" | "customerName" | "settlementDate"
  >;
  exclusionRules: CustomerExclusionRuleSnapshot[];
}): string | null {
  if (input.schedule.exclusionRuleId) return input.schedule.exclusionRuleId;
  if (input.schedule.scheduleStatus !== "CUSTOMER_EXCLUDED") return null;
  const exclusion = resolveCustomerExclusionForSale({
    customerId: input.schedule.customerId ?? input.receivable.customerId,
    customerExternalId: input.receivable.customerExternalId,
    customerTaxId: input.receivable.customerCnpj ?? null,
    customerName: input.receivable.customerName,
    referenceDate: input.receivable.settlementDate,
    rules: input.exclusionRules,
  });
  return exclusion?.rule.id ?? null;
}

export type CommissionReceiptReceivableInput = {
  nomusReceivableId: number;
  receivableNumber?: string | null;
  installmentNumber?: number | null;
  /** Baixa administrativa (`contasReceber.dataBaixa`) — auditoria, NÃO competência. */
  settlementDate: Date | null;
  /**
   * Competência oficial do período: eventos de `NomusReceivableReceipt` do mês
   * (somados) e o acumulado anterior, para liberação incremental.
   *
   * Ausente ⇒ o título NÃO tem recebimento no período e não entra no fechamento
   * por recebimento. Não existe fallback para `settlementDate`.
   */
  receiptCompetence?: CommissionReceiptCompetence | null;
  dueDate?: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable?: number;
  nomusNfeId?: number | null;
  nfeNumber?: string | null;
  customerExternalId?: number | null;
  customerId?: string | null;
  customerName?: string | null;
  customerCnpj?: string | null;
  cancelled?: boolean;
  suspended?: boolean;
};

export type CommissionReceiptPreviewContext = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
  receivables: CommissionReceiptReceivableInput[];
  ordersByNfeId: Map<number, CommissionOrderSourceBundle>;
  /** NFEs ligadas a 2+ pedidos — não resolver automaticamente. */
  ambiguousNfeIds?: Set<number>;
  persistedAuditRows?: VisualAuditRow[];
  /** Schedules materializados por receivableId — quando definido, fechamento usa schedule (não recalcula itens). */
  materializedSchedulesByReceivableId?: Map<number, MaterializedReceivableScheduleInput[]>;
  /** Snapshot ACTIVE por NF — diagnóstico quando schedule ausente. */
  orderSnapshotDiagnosisByNfeId?: Map<number, CommissionOrderSnapshotDiagnosis>;
  /** Vendedor via CommissionRecord por NF (fallback quando schedule ausente). */
  commissionRecordsByNfeId?: Map<number, CommissionReceiptSellerRecordInput>;
  /** Fallback explícito: recalcular por item (preview/auditoria legada). */
  allowItemRecalculationFallback?: boolean;
  rules: CommissionActiveRule[];
  exclusionRules: CustomerExclusionRuleSnapshot[];
  identityCtx: CommissionSellerIdentityContext;
  /** Override de % por item (testes / fallback sem tier comercial). */
  itemRateOverrides?: Map<string, number>;
  /** settled = fechamento por settlementDate; open = previsão por títulos em aberto. */
  receivableScope?: "settled" | "open";
  /** released = comissão liberada no recebimento; forecast = comissão prevista sobre saldo aberto. */
  commissionMode?: "released" | "forecast";
  openForecastFilters?: {
    dueDateFrom?: Date | null;
    dueDateTo?: Date | null;
    horizonMonths?: number | null;
  };
  referenceDate?: Date;
};

export type CommissionReceiptPreviewLine = {
  ledgerLineKey: string;
  year: number;
  month: number;
  nomusReceivableId: number;
  receivableNumber: string | null;
  installmentNumber: number | null;
  /** Baixa administrativa — exibida como "Baixa", nunca como "Recebimento". */
  settlementDate: string;
  /** Data real do recebimento que definiu a competência — exibida como "Recebimento". */
  receiptDate?: string | null;
  /** Ids dos eventos `recebimentos` do período (auditoria; fora do hash do ledger). */
  receiptIds?: number[];
  dueDate: string | null;
  receivableAmount: number;
  receivedAmount: number;
  /** Alias auditável do recebido bruto (pode incluir juros/multa). */
  receivedGrossAmount?: number;
  /** Principal comissionável = min(recebido, original do CR). */
  commissionPrincipalAmount?: number;
  /** max(0, recebido − original) — encargos ignorados. */
  ignoredFinancialChargesAmount?: number;
  /** Flags de auditoria (ex.: RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL). */
  auditFlags?: string[];
  receivedSharePercent: number | null;
  customerExternalId: number | null;
  customerId: string | null;
  customerName: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  orderCode: string | null;
  localOrderId: string | null;
  /** Origem do vínculo pedido↔título (auditoria; não altera cálculo). */
  linkResolutionSource?: import("./commissionSalesOrderNfeLinkResolution.js").CommissionOrderLinkResolutionSource | null;
  linkResolutionStatus?: import("./commissionSalesOrderNfeLinkResolution.js").CommissionOrderLinkResolutionStatus | null;
  nomusOrderItemId: number | null;
  localItemId: string | null;
  productCode: string | null;
  productName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  commissionRecordId: string | null;
  commissionPaymentScheduleId: string | null;
  commissionReceivableScheduleId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  ratePercent: number;
  commissionableBaseAmount: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  /** Comissão bruta antes de exclusão de cliente (auditoria Nomus). */
  grossCommissionAmount: number;
  status: CommissionReceiptLedgerLineStatus;
  statusReason: string | null;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
  source:
    | "MATERIALIZED_SCHEDULE"
    | "PERSISTED_SCHEDULE"
    | "CALCULATED"
    | "EXCEPTION"
    | "ORDER_SNAPSHOT"
    | "RECEIVABLE_SCHEDULE"
    | "RECEIPT_LEDGER"
    | "LEGACY_FALLBACK";
  /** Comissão do schedule materializado (pode ser 0 em mismatch). */
  scheduleCommissionAmount?: number | null;
  /** Comissão do snapshot oficial do pedido (Auditoria 360º). */
  orderSnapshotCommissionAmount?: number | null;
};

export type CommissionReceiptPreviewBucket = {
  sellerId: string | null;
  sellerName: string | null;
  receivableCount: number;
  receivedAmount: number;
  commissionableBase: number;
  expectedCommission: number;
  releasedCommission: number;
};

export type CommissionReceiptPreviewResult = {
  year: number;
  month: number;
  totalReceivables: number;
  totalReceivedAmount: number;
  totalCommissionableBase: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  totalExcludedAmount: number;
  totalExceptionAmount: number;
  countByStatus: Record<CommissionReceiptLedgerLineStatus, number>;
  bySeller: CommissionReceiptPreviewBucket[];
  byCustomer: Array<{
    customerExternalId: number | null;
    customerName: string | null;
    receivableCount: number;
    receivedAmount: number;
    commissionableBase: number;
    expectedCommission: number;
    releasedCommission: number;
  }>;
  lines: CommissionReceiptPreviewLine[];
};

export function resolveReceiptPreviewPeriodBounds(year: number, month: number): {
  from: Date;
  to: Date;
} {
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

export function isDateInReceiptPreviewPeriod(
  date: Date | string | null | undefined,
  year: number,
  month: number
): boolean {
  if (!date) return false;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return false;
  const { from, to } = resolveReceiptPreviewPeriodBounds(year, month);
  const ts = value.getTime();
  return ts >= from.getTime() && ts <= to.getTime();
}

/**
 * Títulos cuja comissão é liberada NESTE mês.
 *
 * Fonte da competência: eventos de recebimento do período
 * (`receiptCompetence`). A baixa (`settlementDate`) não é consultada aqui —
 * recebimento em 31/07 baixado em 03/08 pertence a JULHO.
 *
 * Sem `receiptCompetence` o título simplesmente não entra: a ausência de
 * recebimento é tratada como inconsistência a montante
 * (`detectSettledWithoutReceipt`), nunca como fallback para a baixa.
 */
export function filterReceivablesByReceiptCompetence(
  receivables: CommissionReceiptReceivableInput[],
  year: number,
  month: number
): CommissionReceiptReceivableInput[] {
  return receivables.filter((row) => {
    if (row.cancelled || row.suspended) return false;
    const competence = row.receiptCompetence;
    if (!competence) return false;
    if (roundMoney(competence.periodReceivedAmount) <= 0) return false;
    return isReceiptInCompetencePeriod(competence.receiptDate, year, month);
  });
}

/** Campos de auditoria da competência para a linha de prévia. */
export function resolveReceiptCompetenceLineFields(
  receivable: CommissionReceiptReceivableInput
): { receiptDate: string | null; receiptIds: number[] } {
  const competence = receivable.receiptCompetence;
  if (!competence) return { receiptDate: null, receiptIds: [] };
  return {
    receiptDate: isoDate(competence.receiptDate),
    receiptIds: [...competence.receiptIds],
  };
}

/**
 * Principal do período para linhas SEM schedule (exceções/diagnósticos).
 * Com competência, reporta o recebido do MÊS; sem ela, o acumulado do título.
 */
export function resolveReceiptPeriodPrincipal(
  receivable: CommissionReceiptReceivableInput
): ReturnType<typeof resolveReceivableCommissionPrincipal> {
  const competence = receivable.receiptCompetence;
  if (!competence) {
    return resolveReceivableCommissionPrincipal({
      receivableOriginalAmount: receivable.amountReceivable,
      receivedAmount: receivable.amountReceived,
      openBalance: resolveOpenReceivableBalance(receivable),
    });
  }
  const breakdown = computeCompetenceReleaseBreakdown({
    receivableOriginalAmount: receivable.amountReceivable,
    scheduledCommissionAmount: 0,
    competence,
  });
  const original = roundMoney(Math.max(0, receivable.amountReceivable));
  return {
    receivableOriginalAmount: original,
    receivedGrossAmount: breakdown.periodReceivedGrossAmount,
    commissionPrincipalAmount: breakdown.periodPrincipalAmount,
    ignoredFinancialChargesAmount: breakdown.periodIgnoredFinancialChargesAmount,
    releaseRatio: original > 0 ? Math.min(1, breakdown.periodPrincipalAmount / original) : 0,
    auditFlags:
      breakdown.periodIgnoredFinancialChargesAmount > 0.009
        ? [RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL]
        : [],
  };
}

export function resolveOpenReceivableBalance(
  receivable: CommissionReceiptReceivableInput
): number {
  if (receivable.balanceReceivable != null && Number.isFinite(receivable.balanceReceivable)) {
    return roundMoney(Math.max(0, receivable.balanceReceivable));
  }
  return roundMoney(Math.max(0, receivable.amountReceivable - receivable.amountReceived));
}

export function isOpenReceivableForForecast(
  receivable: CommissionReceiptReceivableInput
): boolean {
  if (receivable.cancelled || receivable.suspended) return false;
  return resolveOpenReceivableBalance(receivable) > 0.009;
}

export function filterOpenReceivablesForForecast(
  receivables: CommissionReceiptReceivableInput[],
  filters: {
    dueDateFrom?: Date | null;
    dueDateTo?: Date | null;
    horizonMonths?: number | null;
  } = {},
  ref: Date = new Date()
): CommissionReceiptReceivableInput[] {
  let open = receivables.filter(isOpenReceivableForForecast);

  if (filters.dueDateFrom) {
    const fromTs = filters.dueDateFrom.getTime();
    open = open.filter((row) => row.dueDate && row.dueDate.getTime() >= fromTs);
  }
  if (filters.dueDateTo) {
    const toTs = filters.dueDateTo.getTime();
    open = open.filter((row) => row.dueDate && row.dueDate.getTime() <= toTs);
  }
  if (filters.horizonMonths != null && filters.horizonMonths > 0) {
    const horizonEnd = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + filters.horizonMonths, 0, 23, 59, 59, 999)
    );
    open = open.filter((row) => !row.dueDate || row.dueDate.getTime() <= horizonEnd.getTime());
  }

  return open;
}

export function resolveScopedReceivablesForPreview(
  input: CommissionReceiptPreviewContext
): CommissionReceiptReceivableInput[] {
  if (input.receivableScope === "open") {
    return filterOpenReceivablesForForecast(
      input.receivables,
      input.openForecastFilters ?? {},
      input.referenceDate ?? new Date()
    );
  }
  return filterReceivablesByReceiptCompetence(input.receivables, input.year, input.month);
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function customerMatchesFilter(
  customerName: string | null | undefined,
  customerExternalId: number | null | undefined,
  filter: string | null | undefined
): boolean {
  if (!filter?.trim()) return true;
  const needle = filter.trim().toLowerCase();
  const name = (customerName ?? "").toLowerCase();
  const ext = customerExternalId != null ? String(customerExternalId) : "";
  return name.includes(needle) || needle.includes(name) || ext.includes(needle);
}

function sellerMatchesFilter(
  canonicalSellerName: string | null | undefined,
  rawSellerName: string | null | undefined,
  filter: string | null | undefined
): boolean {
  if (!filter?.trim()) return true;
  return (
    sellerNameMatchesFilter(canonicalSellerName ?? "", filter) ||
    sellerNameMatchesFilter(rawSellerName ?? "", filter)
  );
}

function isExceptionStatus(status: CommissionReceiptLedgerLineStatus): boolean {
  return COMMISSION_RECEIPT_EXCEPTION_STATUSES.includes(status);
}

function emptyStatusCounts(): Record<CommissionReceiptLedgerLineStatus, number> {
  return {
    COMMISSIONABLE: 0,
    CUSTOMER_EXCLUDED: 0,
    GROUP_COMPANY_EXCLUDED: 0,
    NO_SALES_LINK: 0,
    NO_SCHEDULE: 0,
    NO_SELLER: 0,
    SELLER_UNRESOLVED: 0,
    NO_RULE: 0,
    NO_MARGIN: 0,
    COMMISSION_SOURCE_MISMATCH: 0,
    STALE_SCHEDULE: 0,
    ZERO_AMOUNT: 0,
    ERROR: 0,
  };
}

/** Comissão programada efetiva: schedule materializado, ou rateio do snapshot oficial se o schedule estiver zerado. */
export function resolveEffectiveScheduledCommissionAmount(
  schedule: Pick<
    MaterializedReceivableScheduleInput,
    | "scheduledCommissionAmount"
    | "receivableSharePercent"
    | "orderSnapshotFinalCommissionAmount"
  >
): number {
  const scheduled = normalizeCommissionLedgerMoney(schedule.scheduledCommissionAmount);
  if (scheduled > 0) return scheduled;
  const snapFinal = normalizeCommissionLedgerMoney(
    schedule.orderSnapshotFinalCommissionAmount ?? 0
  );
  if (snapFinal <= 0) return 0;
  const share =
    schedule.receivableSharePercent > 0 ? schedule.receivableSharePercent / 100 : 1;
  return normalizeCommissionLedgerMoney(snapFinal * Math.min(1, share));
}

export function scheduleDivergesFromOrderSnapshot(
  schedule: Pick<
    MaterializedReceivableScheduleInput,
    "scheduledCommissionAmount" | "orderSnapshotFinalCommissionAmount" | "scheduleStatus"
  >
): boolean {
  if (schedule.scheduleStatus !== "ACTIVE") return false;
  const scheduled = normalizeCommissionLedgerMoney(schedule.scheduledCommissionAmount);
  const snapFinal = normalizeCommissionLedgerMoney(
    schedule.orderSnapshotFinalCommissionAmount ?? 0
  );
  return scheduled <= 0 && snapFinal > 0;
}

function resolveItemRatePercent(input: {
  rules: CommissionActiveRule[];
  order: CommissionOrderSourceBundle;
  item: CommissionOrderItemSource;
  referenceDate: Date;
  sellerResolution: ReturnType<typeof resolveCommissionSellerIdentity>;
  itemRateOverrides?: Map<string, number>;
}): { ratePercent: number; rule: CommissionActiveRule | null; reason: string | null } {
  const override =
    input.itemRateOverrides?.get(input.item.localItemId) ??
    (input.item.nomusOrderItemId != null
      ? input.itemRateOverrides?.get(String(input.item.nomusOrderItemId))
      : undefined);
  if (override != null && Number.isFinite(override)) {
    return { ratePercent: override, rule: null, reason: null };
  }

  const match = selectBestMatchingRule(input.rules, {
    referenceDate: input.referenceDate,
    order: input.order,
    item: input.item,
    beneficiaryType: "SELLER",
    nomusSellerId: input.order.seller.nomusSellerId,
    nomusRepresentativeId: input.order.representative.nomusRepresentativeId,
    commissionPersonId: input.sellerResolution.canonicalSellerId,
  });

  if (!match) {
    return { ratePercent: 0, rule: null, reason: "Nenhuma regra de comissão aplicável" };
  }
  if (match.calculationType !== "FIXED_PERCENT") {
    return {
      ratePercent: 0,
      rule: match.rule,
      reason: `Tipo de cálculo ${match.calculationType} requer resolver de taxa`,
    };
  }
  return { ratePercent: match.ratePercent, rule: match.rule, reason: null };
}

function mapAuditRowStatus(row: VisualAuditRow): {
  status: CommissionReceiptLedgerLineStatus;
  reason: string | null;
} {
  if (row.customerNoCommission || !row.isCommissionable) {
    return {
      status: "CUSTOMER_EXCLUDED",
      reason: row.exclusionReason ?? "Cliente excluído de comissão",
    };
  }
  const hasResolvedPerson = Boolean(
    row.commissionPersonId && row.commissionPersonName?.trim()
  );
  if (!hasResolvedPerson) {
    const sellerStatus = row.sellerResolutionStatus;
    if (
      sellerStatus === "UNRESOLVED" ||
      sellerStatus === "CONFLICT" ||
      sellerStatus === "MULTIPLE_CANONICALS"
    ) {
      return {
        status: "SELLER_UNRESOLVED",
        reason: `Vendedor não resolvido (${sellerStatus})`,
      };
    }
    if (!row.nomusSellerId && !row.commissionPersonName?.trim()) {
      return { status: "NO_SELLER", reason: "Pedido/NF sem vendedor" };
    }
  }
  if (row.itemRatePercent <= 0 && row.commissionExpected <= 0 && row.allocatedBaseAmount > 0) {
    return { status: "NO_RULE", reason: "Sem regra ou percentual zerado" };
  }
  if (row.allocatedBaseAmount <= 0 && row.commissionExpected <= 0) {
    return { status: "ZERO_AMOUNT", reason: "Base comissionável zerada" };
  }
  return { status: "COMMISSIONABLE", reason: null };
}

export function releaseCommissionFromMaterializedSchedule(input: {
  schedule: MaterializedReceivableScheduleInput;
  receivable: CommissionReceiptReceivableInput;
}): {
  receivedSharePercent: number;
  commissionableBaseAmount: number;
  expectedCommissionAmount: number;
  effectiveRatePercent: number;
  receivedGrossAmount: number;
  commissionPrincipalAmount: number;
  ignoredFinancialChargesAmount: number;
  auditFlags: string[];
} {
  const nominal = roundMoney(
    input.schedule.receivableNominalAmount > 0
      ? input.schedule.receivableNominalAmount
      : input.receivable.amountReceivable
  );
  const scheduled = normalizeCommissionLedgerMoney(input.schedule.scheduledCommissionAmount);
  const effectiveRatePercent =
    nominal > 0 ? roundMoney((scheduled / nominal) * 100) : 0;
  const competence = input.receivable.receiptCompetence ?? null;

  if (competence) {
    // Liberação INCREMENTAL: o mês reconhece só o que foi recebido no mês.
    // Recebimento parcial em julho e o restante em agosto liberam 40%/60% da
    // mesma comissão — nunca 100% em cada mês.
    const breakdown = computeCompetenceReleaseBreakdown({
      receivableOriginalAmount: nominal,
      scheduledCommissionAmount: scheduled,
      competence,
    });
    const flags =
      breakdown.periodIgnoredFinancialChargesAmount > 0.009
        ? [RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL]
        : [];
    return {
      receivedSharePercent: breakdown.periodSharePercent,
      commissionableBaseAmount: breakdown.periodPrincipalAmount,
      expectedCommissionAmount: breakdown.periodReleasedCommissionAmount,
      effectiveRatePercent,
      receivedGrossAmount: breakdown.periodReceivedGrossAmount,
      commissionPrincipalAmount: breakdown.periodPrincipalAmount,
      ignoredFinancialChargesAmount: breakdown.periodIgnoredFinancialChargesAmount,
      auditFlags: flags,
    };
  }

  // Sem competência de recebimento (previsão/auditoria fora de período): base no
  // acumulado do título. Este caminho nunca é usado no fechamento mensal, porque
  // `filterReceivablesByReceiptCompetence` só deixa passar quem tem recebimento.
  const received = roundMoney(input.receivable.amountReceived);
  const principal = resolveReceivableCommissionPrincipal({
    receivableOriginalAmount: nominal,
    receivedAmount: received,
    openBalance: resolveOpenReceivableBalance(input.receivable),
  });
  const released = normalizeCommissionLedgerMoney(scheduled * principal.releaseRatio);

  return {
    receivedSharePercent: roundMoney(principal.releaseRatio * 100),
    // Base comissionável = principal do título, NÃO o recebido bruto com juros.
    commissionableBaseAmount: principal.commissionPrincipalAmount,
    expectedCommissionAmount: released,
    effectiveRatePercent,
    receivedGrossAmount: principal.receivedGrossAmount,
    commissionPrincipalAmount: principal.commissionPrincipalAmount,
    ignoredFinancialChargesAmount: principal.ignoredFinancialChargesAmount,
    auditFlags: principal.auditFlags,
  };
}

/** Comissão prevista proporcional ao saldo em aberto do título (previsão). */
export function forecastCommissionFromMaterializedSchedule(input: {
  schedule: MaterializedReceivableScheduleInput;
  receivable: CommissionReceiptReceivableInput;
}): {
  openSharePercent: number;
  commissionableBaseAmount: number;
  forecastCommissionAmount: number;
  effectiveRatePercent: number;
} {
  const nominal = roundMoney(
    input.schedule.receivableNominalAmount > 0
      ? input.schedule.receivableNominalAmount
      : input.receivable.amountReceivable
  );
  const openBalance = resolveOpenReceivableBalance(input.receivable);
  // Saldo em aberto nunca pode ultrapassar o original do CR na base prevista.
  const openPrincipal = roundMoney(Math.min(openBalance, nominal > 0 ? nominal : openBalance));
  const share = nominal > 0 ? Math.min(1, openPrincipal / nominal) : 0;
  const scheduled = normalizeCommissionLedgerMoney(input.schedule.scheduledCommissionAmount);
  const forecast = normalizeCommissionLedgerMoney(scheduled * share);
  const effectiveRatePercent =
    nominal > 0 ? roundMoney((scheduled / nominal) * 100) : 0;

  return {
    openSharePercent: roundMoney(share * 100),
    commissionableBaseAmount: openPrincipal,
    forecastCommissionAmount: forecast,
    effectiveRatePercent,
  };
}

export function mapMaterializedScheduleToLedgerStatus(
  schedule: MaterializedReceivableScheduleInput
): { status: CommissionReceiptLedgerLineStatus; reason: string | null } {
  // Última milha da regra oficial: schedule de snapshot substituído nunca
  // produz diagnóstico de mérito. Sem esta guarda, um órfão que chegasse aqui
  // por outro caminho (esta função é exportada e usada também pela auditoria de
  // rastreio) cairia adiante em NO_MARGIN/ZERO_AMOUNT lendo os itens da versão
  // ANTIGA — que foi exatamente como o PD 02697 fechou zerado.
  if (!isCommissionScheduleFromActiveSnapshot(schedule)) {
    return {
      status: "STALE_SCHEDULE",
      reason:
        "Schedule de snapshot substituído — rematerializar antes de usar como fonte",
    };
  }
  if (schedule.scheduleStatus === "STALE" || schedule.scheduleStatus === "SUPERSEDED") {
    return {
      status: "STALE_SCHEDULE",
      reason: "Schedule desatualizado — reprocessar materialização antes do fechamento",
    };
  }
  if (schedule.scheduleStatus === "ORPHAN") {
    return {
      status: "NO_SALES_LINK",
      reason: "Título órfão sem vínculo com pedido/NF",
    };
  }
  if (schedule.scheduleStatus === "CUSTOMER_EXCLUDED") {
    return {
      status: "CUSTOMER_EXCLUDED",
      reason: schedule.exclusionReason ?? "Cliente excluído de comissão",
    };
  }
  if (schedule.scheduleStatus === "ERROR") {
    return {
      status: "ERROR",
      reason: "Erro na materialização do schedule",
    };
  }
  if (schedule.scheduleStatus !== "ACTIVE") {
    return {
      status: "STALE_SCHEDULE",
      reason: `Schedule em status ${schedule.scheduleStatus}`,
    };
  }
  const sellerStatus = schedule.sellerResolutionStatus;
  if (
    sellerStatus === "UNRESOLVED" ||
    sellerStatus === "CONFLICT" ||
    sellerStatus === "MULTIPLE_CANONICALS"
  ) {
    return {
      status: "SELLER_UNRESOLVED",
      reason: `Vendedor não resolvido (${sellerStatus})`,
    };
  }
  if (!schedule.canonicalSellerId && !schedule.rawSellerName?.trim()) {
    return { status: "NO_SELLER", reason: "Schedule sem vendedor" };
  }
  if (schedule.scheduledCommissionAmount <= 0 && schedule.scheduleStatus === "ACTIVE") {
    // Snapshot oficial com comissão → nunca mascarar como NO_MARGIN silencioso.
    if (scheduleDivergesFromOrderSnapshot(schedule)) {
      return {
        status: "COMMISSION_SOURCE_MISMATCH",
        reason: COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT,
      };
    }
    const snapshotDiagnosis = mapSnapshotItemStatusesToLedgerDiagnosis(
      schedule.itemSnapshotStatuses ?? []
    );
    if (snapshotDiagnosis) return snapshotDiagnosis;
    return { status: "ZERO_AMOUNT", reason: "Comissão programada zerada" };
  }
  return { status: "COMMISSIONABLE", reason: null };
}

const SNAPSHOT_MARGIN_ISSUE_STATUSES = new Set([
  "NO_COMMERCIAL_PRICE_TABLE",
  "INVALID_COMMERCIAL_PRICE_RANGE",
]);

const SNAPSHOT_RULE_ISSUE_STATUSES = new Set(["NO_RULE", "NO_COMMISSION_TABLE_RATE"]);

/** Mapeia status de itens do snapshot para status de linha do ledger (quando comissão é zero). */
export function mapSnapshotItemStatusesToLedgerDiagnosis(
  itemStatuses: string[]
): { status: CommissionReceiptLedgerLineStatus; reason: string } | null {
  if (itemStatuses.length === 0) return null;

  if (itemStatuses.every((status) => SNAPSHOT_MARGIN_ISSUE_STATUSES.has(status))) {
    return {
      status: "NO_MARGIN",
      reason: "Margem ou tabela comercial indisponível para cálculo de comissão",
    };
  }
  if (itemStatuses.every((status) => SNAPSHOT_RULE_ISSUE_STATUSES.has(status))) {
    return {
      status: "NO_RULE",
      reason: "Nenhuma regra de comissão aplicável à faixa de margem do item",
    };
  }
  if (
    itemStatuses.every(
      (status) =>
        SNAPSHOT_MARGIN_ISSUE_STATUSES.has(status) || SNAPSHOT_RULE_ISSUE_STATUSES.has(status)
    ) &&
    itemStatuses.some((status) => SNAPSHOT_MARGIN_ISSUE_STATUSES.has(status))
  ) {
    return {
      status: "NO_MARGIN",
      reason: "Margem ou tabela comercial indisponível para cálculo de comissão",
    };
  }
  return null;
}

/**
 * Escolhe o schedule que representa a comissão VIGENTE do título.
 *
 * Descarta primeiro tudo que veio de snapshot substituído: o status do
 * schedule diz o papel da linha dentro da versão, mas quem decide se a versão
 * vale é o pai. Sem esse recorte, um schedule antigo ACTIVE e zerado vencia o
 * correto e o título fechava como ZERO_AMOUNT/NO_MARGIN (PD 02697).
 *
 * O filtro também existe no `where` do Prisma
 * (`loadMaterializedSchedulesByReceivableId`); aqui é defesa em profundidade,
 * porque o motor puro é chamado com entradas montadas por outros caminhos.
 */
export function pickMaterializedScheduleForReceivable(
  schedules: MaterializedReceivableScheduleInput[]
): MaterializedReceivableScheduleInput | null {
  if (schedules.length === 0) return null;
  const current = keepSchedulesFromActiveSnapshot(schedules);
  // Nenhum schedule da versão vigente ⇒ trata como ausência, para cair no
  // diagnóstico explícito em vez de reaproveitar linha de versão antiga.
  if (current.length === 0) return null;
  const active = current.find((row) => row.scheduleStatus === "ACTIVE");
  if (active) return active;
  // Sem ACTIVE, mas dentro da versão vigente: preserva desfechos legítimos
  // como CUSTOMER_EXCLUDED, que têm tratamento próprio adiante.
  return current[0] ?? null;
}

function resolveReceivableExclusionReferenceDate(
  receivable: CommissionReceiptReceivableInput,
  order?: CommissionOrderSourceBundle
): Date {
  if (order && receivable.nomusNfeId != null) {
    return resolveCommissionRuleReferenceDate(order, receivable.nomusNfeId);
  }
  if (receivable.settlementDate) return receivable.settlementDate;
  if (receivable.dueDate) return receivable.dueDate;
  return new Date();
}

/** Resolve exclusão de cliente para um título recebido (id, externalId ou nome normalizado). */
export function resolveCustomerExclusionForReceivable(input: {
  receivable: CommissionReceiptReceivableInput;
  order?: CommissionOrderSourceBundle;
  exclusionRules: CustomerExclusionRuleSnapshot[];
}): FindApplicableCustomerExclusionResult | null {
  return resolveCustomerExclusionForSale({
    customerId: input.receivable.customerId ?? null,
    customerExternalId:
      input.receivable.customerExternalId ?? input.order?.customerExternalId ?? null,
    customerTaxId: input.receivable.customerCnpj ?? null,
    customerName: input.receivable.customerName ?? input.order?.customerName ?? null,
    referenceDate: resolveReceivableExclusionReferenceDate(input.receivable, input.order),
    rules: input.exclusionRules,
  });
}

function buildCustomerExcludedReceiptLine(input: {
  receivable: CommissionReceiptReceivableInput;
  year: number;
  month: number;
  exclusion: FindApplicableCustomerExclusionResult;
  order?: CommissionOrderSourceBundle;
  identityCtx?: CommissionSellerIdentityContext;
}): CommissionReceiptPreviewLine {
  const line = buildExceptionLine({
    receivable: input.receivable,
    year: input.year,
    month: input.month,
    status: "CUSTOMER_EXCLUDED",
    statusReason: COMMISSION_RECEIPT_CUSTOMER_EXCLUDED_BY_RULE_REASON,
    order: input.order,
    identityCtx: input.identityCtx,
  });
  const principal = resolveReceivableCommissionPrincipal({
    receivableOriginalAmount: input.receivable.amountReceivable,
    receivedAmount: input.receivable.amountReceived,
    openBalance: resolveOpenReceivableBalance(input.receivable),
  });
  return {
    ...line,
    commissionableBaseAmount: principal.commissionPrincipalAmount,
    receivedGrossAmount: principal.receivedGrossAmount,
    commissionPrincipalAmount: principal.commissionPrincipalAmount,
    ignoredFinancialChargesAmount: principal.ignoredFinancialChargesAmount,
    auditFlags: principal.auditFlags,
    expectedCommissionAmount: 0,
    releasedCommissionAmount: 0,
    grossCommissionAmount: 0,
    // Regra de exclusão NÃO é CommissionRule — só customerExclusionRuleId.
    // Gravar exclusion.id em ruleId viola CommissionReceiptLedgerLine_ruleId_fkey.
    exclusionRuleId: input.exclusion.rule.id,
    exclusionReason: input.exclusion.reason,
    ruleId: null,
    ruleName: null,
  };
}

/** Classifica título comercial sem schedule materializado (cadeia Recebimento → Pedido → Snapshot). */
export function diagnoseReceivableWithoutMaterializedSchedule(input: {
  receivable: CommissionReceiptReceivableInput;
  order: CommissionOrderSourceBundle | undefined;
  orderSnapshotDiagnosis: CommissionOrderSnapshotDiagnosis | undefined;
  identityCtx: CommissionSellerIdentityContext;
  exclusionRules?: CustomerExclusionRuleSnapshot[];
}): { status: CommissionReceiptLedgerLineStatus; statusReason: string } {
  const exclusion =
    input.exclusionRules != null
      ? resolveCustomerExclusionForReceivable({
          receivable: input.receivable,
          order: input.order,
          exclusionRules: input.exclusionRules,
        })
      : null;
  if (exclusion) {
    return {
      status: "CUSTOMER_EXCLUDED",
      statusReason: COMMISSION_RECEIPT_CUSTOMER_EXCLUDED_BY_RULE_REASON,
    };
  }

  const snap = input.orderSnapshotDiagnosis;
  if (
    snap?.exists &&
    snap.itemStatuses.length > 0 &&
    snap.itemStatuses.every((status) => status === "CUSTOMER_EXCLUDED")
  ) {
    return {
      status: "CUSTOMER_EXCLUDED",
      statusReason: COMMISSION_RECEIPT_CUSTOMER_EXCLUDED_BY_RULE_REASON,
    };
  }

  if (input.receivable.nomusNfeId == null) {
    return {
      status: "NO_SALES_LINK",
      statusReason: "Título sem NF de origem (sourceInvoiceId)",
    };
  }
  if (!input.order) {
    return {
      status: "NO_SALES_LINK",
      statusReason: COMMISSION_RECEIPT_NO_SALES_ORDER_REASON,
    };
  }

  if (!input.order.seller.nomusSellerId) {
    return { status: "NO_SELLER", statusReason: COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON };
  }

  const { identity: sellerResolution, nomus: nomusResolution } = resolveOrderCommissionSeller({
    externalSellerId: input.order.seller.nomusSellerId,
    issueDate: input.order.issueDate,
    nomusSellerName: input.order.seller.responsibleName,
    aliasSource: "SALES_ORDER",
    identityCtx: input.identityCtx,
  });
  if (!isNomusOrderSellerResolved(nomusResolution)) {
    return {
      status: "SELLER_UNRESOLVED",
      statusReason:
        sellerResolution.warnings.join("; ") ||
        `Vendedor não resolvido (${nomusResolution.status})`,
    };
  }

  if (snap?.exists) {
    const snapFinal = normalizeCommissionLedgerMoney(snap.totalFinalCommissionAmount ?? 0);
    if (snapFinal > 0) {
      return {
        status: "COMMISSION_SOURCE_MISMATCH",
        statusReason: COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT,
      };
    }

    const snapshotDiagnosis = mapSnapshotItemStatusesToLedgerDiagnosis(snap.itemStatuses);
    if (snapshotDiagnosis) return snapshotDiagnosis;

    if (
      snap.itemStatuses.length > 0 &&
      snap.itemStatuses.every((status) => status === "NO_RULE")
    ) {
      return {
        status: "NO_RULE",
        statusReason: "Nenhuma regra de comissão aplicável ao pedido/NF",
      };
    }
    if (snap.itemStatuses.some((status) => status === "SELLER_UNRESOLVED")) {
      return {
        status: "SELLER_UNRESOLVED",
        statusReason: "Vendedor não resolvido no snapshot materializado",
      };
    }
  }

  return {
    status: "NO_SCHEDULE",
    statusReason: COMMISSION_RECEIPT_NO_SCHEDULE_REASON,
  };
}

function previewLineFromMaterializedSchedule(
  schedule: MaterializedReceivableScheduleInput,
  receivable: CommissionReceiptReceivableInput,
  year: number,
  month: number,
  exclusionRules: CustomerExclusionRuleSnapshot[] = [],
  order?: CommissionOrderSourceBundle,
  identityCtx?: CommissionSellerIdentityContext,
  commissionMode: "released" | "forecast" = "released"
): CommissionReceiptPreviewLine {
  const { status, reason } = mapMaterializedScheduleToLedgerStatus(schedule);
  const divergesFromSnapshot = scheduleDivergesFromOrderSnapshot(schedule);
  const effectiveScheduled = resolveEffectiveScheduledCommissionAmount(schedule);
  const scheduleForRelease: MaterializedReceivableScheduleInput = divergesFromSnapshot
    ? { ...schedule, scheduledCommissionAmount: effectiveScheduled }
    : schedule;
  const isForecast = commissionMode === "forecast";
  const forecastRelease = isForecast
    ? forecastCommissionFromMaterializedSchedule({
        schedule: scheduleForRelease,
        receivable,
      })
    : null;
  const settledRelease = !isForecast
    ? releaseCommissionFromMaterializedSchedule({
        schedule: scheduleForRelease,
        receivable,
      })
    : null;
  const release = forecastRelease ?? settledRelease!;
  const openBalance = resolveOpenReceivableBalance(receivable);
  // Fechamento reporta o recebido DO PERÍODO (evento), não o acumulado do CR.
  const receivedAmount = isForecast
    ? openBalance
    : roundMoney(
        receivable.receiptCompetence
          ? receivable.receiptCompetence.periodReceivedAmount
          : receivable.amountReceived
      );
  const commissionableBase = release.commissionableBaseAmount;
  const showsSnapshotAmounts =
    status === "COMMISSIONABLE" || status === "COMMISSION_SOURCE_MISMATCH";
  const expectedCommission = isForecast
    ? forecastRelease!.forecastCommissionAmount
    : showsSnapshotAmounts
      ? settledRelease!.expectedCommissionAmount
      : 0;
  // Mismatch: mostra prevista do snapshot, mas não libera para pagamento até reorder/materializar.
  const released =
    !isForecast && status === "COMMISSIONABLE" ? settledRelease!.expectedCommissionAmount : 0;
  const receivedSharePercent = isForecast
    ? forecastRelease!.openSharePercent
    : settledRelease!.receivedSharePercent;
  const principalAudit = settledRelease
    ? {
        receivedGrossAmount: settledRelease.receivedGrossAmount,
        commissionPrincipalAmount: settledRelease.commissionPrincipalAmount,
        ignoredFinancialChargesAmount: settledRelease.ignoredFinancialChargesAmount,
        auditFlags: [
          ...settledRelease.auditFlags,
          ...(divergesFromSnapshot ? [COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT] : []),
        ],
      }
    : {
        receivedGrossAmount: normalizeCommissionLedgerMoney(receivedAmount),
        commissionPrincipalAmount: commissionableBase,
        ignoredFinancialChargesAmount: 0,
        auditFlags: divergesFromSnapshot
          ? [COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT]
          : ([] as string[]),
      };
  const grossCommissionAmount =
    schedule.scheduleStatus === "CUSTOMER_EXCLUDED"
      ? roundMoney(
          schedule.grossScheduledCommissionAmount ??
            (schedule.scheduledCommissionAmount > 0
              ? schedule.scheduledCommissionAmount
              : expectedCommission)
        )
      : expectedCommission;
  const exclusionRuleId = resolveMaterializedScheduleExclusionRuleId({
    schedule,
    receivable,
    exclusionRules,
  });

  const seller =
    order != null
      ? resolveReceiptExceptionLineSellerFields({
          order,
          identityCtx,
        })
      : resolveReceiptExceptionLineSellerFields({
          schedule: {
            canonicalSellerId: schedule.canonicalSellerId,
            canonicalSellerName: schedule.canonicalSellerName,
            rawSellerId: schedule.rawSellerId,
            rawSellerName: schedule.rawSellerName,
          },
        });

  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId: receivable.nomusReceivableId,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      commissionReceivableScheduleId: schedule.id,
      installmentNumber: schedule.installmentNumber,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId: receivable.nomusReceivableId,
    receivableNumber: receivable.receivableNumber ?? schedule.receivableCode,
    installmentNumber: schedule.installmentNumber,
    settlementDate: isoDate(receivable.settlementDate) ?? "",
    receiptDate: resolveReceiptCompetenceLineFields(receivable).receiptDate,
    receiptIds: resolveReceiptCompetenceLineFields(receivable).receiptIds,
    dueDate: isoDate(receivable.dueDate),
    receivableAmount: normalizeCommissionLedgerMoney(
      schedule.receivableNominalAmount || receivable.amountReceivable
    ),
    receivedAmount: normalizeCommissionLedgerMoney(receivedAmount),
    receivedGrossAmount: principalAudit.receivedGrossAmount,
    commissionPrincipalAmount: principalAudit.commissionPrincipalAmount,
    ignoredFinancialChargesAmount: principalAudit.ignoredFinancialChargesAmount,
    auditFlags: principalAudit.auditFlags,
    receivedSharePercent,
    customerExternalId: receivable.customerExternalId ?? null,
    customerId: schedule.customerId ?? receivable.customerId ?? null,
    customerName: receivable.customerName,
    nomusNfeId: schedule.nfeId ?? receivable.nomusNfeId ?? null,
    nfeNumber: receivable.nfeNumber,
    orderCode: schedule.orderCode,
    localOrderId: schedule.salesOrderId,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: seller.rawSellerId,
    rawSellerName: seller.rawSellerName,
    canonicalSellerId: seller.canonicalSellerId,
    canonicalSellerName: seller.canonicalSellerName,
    sellerResolutionStatus: seller.sellerResolutionStatus,
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: schedule.id,
    ruleId: null,
    ruleName: null,
    ratePercent: release.effectiveRatePercent,
    commissionableBaseAmount: commissionableBase,
    expectedCommissionAmount: expectedCommission,
    releasedCommissionAmount: released,
    grossCommissionAmount:
      status === "CUSTOMER_EXCLUDED" ? grossCommissionAmount : expectedCommission,
    status,
    statusReason: reason,
    exclusionRuleId,
    exclusionReason: schedule.exclusionReason,
    source: divergesFromSnapshot ? "ORDER_SNAPSHOT" : "MATERIALIZED_SCHEDULE",
    scheduleCommissionAmount: normalizeCommissionLedgerMoney(schedule.scheduledCommissionAmount),
    orderSnapshotCommissionAmount: normalizeCommissionLedgerMoney(
      schedule.orderSnapshotFinalCommissionAmount ?? 0
    ),
  };
}

function previewLineFromAuditRow(
  row: VisualAuditRow,
  year: number,
  month: number
): CommissionReceiptPreviewLine {
  const { status, reason } = mapAuditRowStatus(row);
  const expected = normalizeCommissionLedgerMoney(row.commissionExpected);
  const released =
    status === "COMMISSIONABLE"
      ? normalizeCommissionLedgerMoney(row.commissionReleased > 0 ? row.commissionReleased : expected)
      : 0;

  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId: row.nomusReceivableId,
      commissionRecordId: row.recordId,
      commissionPaymentScheduleId: row.scheduleId,
      installmentNumber: row.installmentNumber,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId: row.nomusReceivableId ?? 0,
    receivableNumber: null,
    installmentNumber: row.installmentNumber,
    settlementDate: row.settlementDate ?? "",
    dueDate: row.dueDate,
    receivableAmount: normalizeCommissionLedgerMoney(row.receivableAmount),
    receivedAmount: normalizeCommissionLedgerMoney(row.receivedAmount),
    receivedSharePercent:
      row.receivableAmount > 0
        ? roundMoney((row.receivedAmount / row.receivableAmount) * 100)
        : null,
    customerExternalId: row.customerExternalId ?? null,
    customerId: null,
    customerName: row.customerName,
    nomusNfeId: row.nomusNfeId,
    nfeNumber: row.nfeNumber,
    orderCode: row.orderCode,
    localOrderId: null,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: row.productCode,
    productName: null,
    rawSellerId: row.nomusSellerId ?? null,
    rawSellerName: row.rawSellerName ?? row.commissionPersonName,
    canonicalSellerId: row.canonicalSellerId,
    canonicalSellerName: row.canonicalSellerName,
    sellerResolutionStatus: row.sellerResolutionStatus,
    commissionRecordId: row.recordId,
    commissionPaymentScheduleId: row.scheduleId,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    ratePercent: normalizeCommissionLedgerMoney(row.itemRatePercent),
    commissionableBaseAmount: normalizeCommissionLedgerMoney(row.allocatedBaseAmount),
    expectedCommissionAmount: expected,
    releasedCommissionAmount: released,
    grossCommissionAmount: expected,
    status,
    statusReason: reason,
    exclusionRuleId: row.exclusionRuleId,
    exclusionReason: row.exclusionReason,
    source: "PERSISTED_SCHEDULE",
  };
}

/** Preenche vendedor raw/canônico em linhas de exceção (NO_SCHEDULE, etc.) sem alterar status. */
export function resolveReceiptExceptionLineSellerFields(input: {
  schedule?: {
    canonicalSellerId: string | null;
    canonicalSellerName: string | null;
    rawSellerId?: number | null;
    rawSellerName?: string | null;
  } | null;
  commissionRecord?: CommissionReceiptSellerRecordInput | null;
  order?: CommissionOrderSourceBundle | null;
  identityCtx?: CommissionSellerIdentityContext;
  preResolved?: {
    identity: CommissionSellerIdentityResolution;
    nomus: NomusOrderSellerResolution;
  };
}): {
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
} {
  if (
    input.order &&
    (input.order.seller.nomusSellerId == null || input.order.seller.nomusSellerId <= 0)
  ) {
    return mapCommissionReceiptSellerToLineFields(
      resolveCommissionReceiptSeller({
        salesOrder: {
          externalSellerId: input.order.seller.nomusSellerId,
          issueDate: input.order.issueDate,
          nomusSellerName: input.order.seller.responsibleName,
        },
      })
    );
  }

  if (input.preResolved) {
    const { identity, nomus } = input.preResolved;
    if (
      identity.canonicalSellerId &&
      identity.canonicalSellerName &&
      isNomusOrderSellerResolved(nomus)
    ) {
      return mapCommissionReceiptSellerToLineFields({
        rawSellerId: nomus.rawSellerId ?? input.order?.seller.nomusSellerId ?? null,
        rawSellerName:
          identity.rawSellerName?.trim() || input.order?.seller.responsibleName?.trim() || null,
        canonicalSellerId: identity.canonicalSellerId,
        canonicalSellerName: identity.canonicalSellerName,
        nomusPersonId: nomus.rawSellerId,
        sellerResolutionStatus: "RESOLVED_FROM_SALES_ORDER",
        sellerLabel: identity.canonicalSellerName,
      });
    }
  }

  const resolution = resolveCommissionReceiptSeller({
    schedule: input.schedule,
    commissionRecord: input.commissionRecord,
    salesOrder: input.order
      ? {
          externalSellerId: input.order.seller.nomusSellerId,
          issueDate: input.order.issueDate,
          nomusSellerName: input.order.seller.responsibleName,
        }
      : null,
    identityCtx: input.identityCtx,
  });
  return mapCommissionReceiptSellerToLineFields(resolution);
}

function buildExceptionLine(input: {
  receivable: CommissionReceiptReceivableInput;
  year: number;
  month: number;
  status: CommissionReceiptLedgerLineStatus;
  statusReason: string;
  order?: CommissionOrderSourceBundle | null;
  identityCtx?: CommissionSellerIdentityContext;
  commissionRecord?: CommissionReceiptSellerRecordInput | null;
  preResolvedSeller?: {
    identity: CommissionSellerIdentityResolution;
    nomus: NomusOrderSellerResolution;
  };
}): CommissionReceiptPreviewLine {
  const { receivable, year, month, status, statusReason, order } = input;
  const seller = resolveReceiptExceptionLineSellerFields({
    commissionRecord: input.commissionRecord,
    order,
    identityCtx: input.identityCtx,
    preResolved: input.preResolvedSeller,
  });
  const principal = resolveReceiptPeriodPrincipal(receivable);
  const competenceFields = resolveReceiptCompetenceLineFields(receivable);
  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId: receivable.nomusReceivableId,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      installmentNumber: receivable.installmentNumber ?? null,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId: receivable.nomusReceivableId,
    receivableNumber: receivable.receivableNumber ?? null,
    installmentNumber: receivable.installmentNumber ?? null,
    settlementDate: isoDate(receivable.settlementDate) ?? "",
    receiptDate: competenceFields.receiptDate,
    receiptIds: competenceFields.receiptIds,
    dueDate: isoDate(receivable.dueDate),
    receivableAmount: normalizeCommissionLedgerMoney(receivable.amountReceivable),
    receivedAmount: principal.receivedGrossAmount,
    receivedGrossAmount: principal.receivedGrossAmount,
    commissionPrincipalAmount: principal.commissionPrincipalAmount,
    ignoredFinancialChargesAmount: principal.ignoredFinancialChargesAmount,
    auditFlags: principal.auditFlags,
    receivedSharePercent: roundMoney(principal.releaseRatio * 100),
    customerExternalId:
      receivable.customerExternalId ?? order?.customerExternalId ?? null,
    customerId: receivable.customerId ?? order?.localOrderId ?? null,
    customerName: receivable.customerName ?? order?.customerName ?? null,
    nomusNfeId: receivable.nomusNfeId ?? null,
    nfeNumber: receivable.nfeNumber ?? null,
    orderCode: order?.orderCode ?? null,
    localOrderId: order?.localOrderId ?? null,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: seller.rawSellerId,
    rawSellerName: seller.rawSellerName,
    canonicalSellerId: seller.canonicalSellerId,
    canonicalSellerName: seller.canonicalSellerName,
    sellerResolutionStatus: seller.sellerResolutionStatus,
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    ratePercent: 0,
    commissionableBaseAmount: principal.commissionPrincipalAmount,
    expectedCommissionAmount: 0,
    releasedCommissionAmount: 0,
    grossCommissionAmount: 0,
    status,
    statusReason,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "EXCEPTION",
  };
}

function buildGroupCompanyExcludedLine(input: {
  receivable: CommissionReceiptReceivableInput;
  year: number;
  month: number;
}): CommissionReceiptPreviewLine {
  const line = buildExceptionLine({
    receivable: input.receivable,
    year: input.year,
    month: input.month,
    status: "GROUP_COMPANY_EXCLUDED",
    statusReason: COMMISSION_GROUP_COMPANY_EXCLUSION_REASON,
  });
  return {
    ...line,
    commissionableBaseAmount: 0,
    exclusionReason: COMMISSION_GROUP_COMPANY_EXCLUSION_REASON,
  };
}

function buildLinesForReceivableWithMaterializedSchedule(input: {
  receivable: CommissionReceiptReceivableInput;
  schedules: MaterializedReceivableScheduleInput[];
  year: number;
  month: number;
  exclusionRules: CustomerExclusionRuleSnapshot[];
  order?: CommissionOrderSourceBundle;
  orderSnapshotDiagnosis?: CommissionOrderSnapshotDiagnosis;
  identityCtx: CommissionSellerIdentityContext;
  commissionRecord?: CommissionReceiptSellerRecordInput | null;
  commissionMode?: "released" | "forecast";
}): CommissionReceiptPreviewLine[] {
  const schedule = pickMaterializedScheduleForReceivable(input.schedules);
  if (!schedule) {
    const exclusion = resolveCustomerExclusionForReceivable({
      receivable: input.receivable,
      order: input.order,
      exclusionRules: input.exclusionRules,
    });
    if (exclusion) {
      return [
        buildCustomerExcludedReceiptLine({
          receivable: input.receivable,
          year: input.year,
          month: input.month,
          exclusion,
          order: input.order,
          identityCtx: input.identityCtx,
        }),
      ];
    }

    const diagnosis = diagnoseReceivableWithoutMaterializedSchedule({
      receivable: input.receivable,
      order: input.order,
      orderSnapshotDiagnosis: input.orderSnapshotDiagnosis,
      identityCtx: input.identityCtx,
      exclusionRules: input.exclusionRules,
    });
    const exceptionLine = buildExceptionLine({
      receivable: input.receivable,
      year: input.year,
      month: input.month,
      status: diagnosis.status,
      statusReason: diagnosis.statusReason,
      order: input.order,
      identityCtx: input.identityCtx,
      commissionRecord: input.commissionRecord,
    });
    if (diagnosis.status === "COMMISSION_SOURCE_MISMATCH") {
      const snapFinal = normalizeCommissionLedgerMoney(
        input.orderSnapshotDiagnosis?.totalFinalCommissionAmount ?? 0
      );
      const principalShare = resolveReceivableCommissionPrincipal({
        receivableOriginalAmount: input.receivable.amountReceivable,
        receivedAmount: input.receivable.amountReceived,
        openBalance: resolveOpenReceivableBalance(input.receivable),
      });
      const expected = normalizeCommissionLedgerMoney(snapFinal * principalShare.releaseRatio);
      return [
        {
          ...exceptionLine,
          expectedCommissionAmount: expected,
          grossCommissionAmount: expected,
          releasedCommissionAmount: 0,
          ratePercent:
            input.receivable.amountReceivable > 0
              ? roundMoney((snapFinal / input.receivable.amountReceivable) * 100)
              : 0,
          source: "ORDER_SNAPSHOT",
          scheduleCommissionAmount: 0,
          orderSnapshotCommissionAmount: snapFinal,
          auditFlags: [
            ...(exceptionLine.auditFlags ?? []),
            COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT,
          ],
        },
      ];
    }
    return [exceptionLine];
  }
  return [
    previewLineFromMaterializedSchedule(
      schedule,
      input.receivable,
      input.year,
      input.month,
      input.exclusionRules,
      input.order,
      input.identityCtx,
      input.commissionMode ?? "released"
    ),
  ];
}

function calculatePreviewLinesForReceivable(input: {
  receivable: CommissionReceiptReceivableInput;
  order: CommissionOrderSourceBundle;
  year: number;
  month: number;
  rules: CommissionActiveRule[];
  exclusionRules: CustomerExclusionRuleSnapshot[];
  identityCtx: CommissionSellerIdentityContext;
  itemRateOverrides?: Map<string, number>;
}): CommissionReceiptPreviewLine[] {
  const { receivable, order, year, month, rules, exclusionRules, identityCtx } = input;
  const nomusNfeId = receivable.nomusNfeId ?? null;
  const referenceDate = resolveCommissionRuleReferenceDate(order, nomusNfeId);
  const nfeLink = nomusNfeId
    ? order.linkedNfes.find((nfe) => nfe.nfeExternalId === nomusNfeId)
    : order.linkedNfes[0];

  const { identity: sellerResolution, nomus: nomusResolution } = resolveOrderCommissionSeller({
    externalSellerId: order.seller.nomusSellerId,
    issueDate: order.issueDate,
    nomusSellerName: order.seller.responsibleName,
    aliasSource: "SALES_ORDER",
    identityCtx,
  });

  const canonicalSellerId = sellerResolution.canonicalSellerId;

  if (nomusResolution.status === "NO_SELLER" || !order.seller.nomusSellerId) {
    return [
      buildExceptionLine({
        receivable,
        year,
        month,
        status: "NO_SELLER",
        statusReason: COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON,
        order,
        identityCtx,
        preResolvedSeller: { identity: sellerResolution, nomus: nomusResolution },
      }),
    ];
  }

  if (!isNomusOrderSellerResolved(nomusResolution)) {
    return [
      buildExceptionLine({
        receivable,
        year,
        month,
        status: "SELLER_UNRESOLVED",
        statusReason:
          sellerResolution.warnings.join("; ") ||
          `Vendedor não resolvido (${nomusResolution.status})`,
        order,
        identityCtx,
        preResolvedSeller: { identity: sellerResolution, nomus: nomusResolution },
      }),
    ];
  }

  const exclusion = resolveCustomerExclusionForSale({
    customerId: receivable.customerId ?? order.localOrderId,
    customerExternalId: receivable.customerExternalId ?? order.customerExternalId,
    customerTaxId: receivable.customerCnpj ?? null,
    customerName: receivable.customerName ?? order.customerName,
    referenceDate,
    rules: exclusionRules,
  });

  const orderItemsTotal = roundMoney(
    order.items.reduce((sum, item) => sum + item.itemNetAmount, 0)
  );
  // Com competência de recebimento, o rateio por item usa o principal DO MÊS.
  const principal = resolveReceiptPeriodPrincipal(receivable);
  // Fallback perigosamente usava recebido bruto como base — agora rateia só o principal.
  const receivedAmount = principal.commissionPrincipalAmount;
  const allocations = allocateProportional(
    receivedAmount,
    order.items.map((item) => ({
      key: item.localItemId,
      weight: item.itemNetAmount,
    }))
  );
  const allocationByItem = new Map(allocations.map((row) => [row.key, row]));

  const lines: CommissionReceiptPreviewLine[] = [];

  for (const item of order.items) {
    const allocation = allocationByItem.get(item.localItemId);
    const receivedBase = normalizeCommissionLedgerMoney(allocation?.amount ?? 0);
    const rateResult = resolveItemRatePercent({
      rules,
      order,
      item,
      referenceDate,
      sellerResolution,
      itemRateOverrides: input.itemRateOverrides,
    });

    let status: CommissionReceiptLedgerLineStatus = "COMMISSIONABLE";
    let statusReason: string | null = rateResult.reason;
    let ratePercent = rateResult.ratePercent;
    let expected = computeCommissionAmount(receivedBase, ratePercent);
    const grossCommissionAmount = expected;

    if (exclusion) {
      const applied = applyCustomerExclusionToCommission({
        exclusion,
        ratePercent,
        commissionAmount: expected,
      });
      ratePercent = applied.ratePercent;
      expected = applied.commissionAmount;
      status = "CUSTOMER_EXCLUDED";
      statusReason = exclusion.reason;
    } else if (rateResult.reason) {
      status = "NO_RULE";
      expected = 0;
    } else if (receivedBase <= 0) {
      status = "ZERO_AMOUNT";
      statusReason = "Base recebida zerada";
      expected = 0;
    } else if (expected <= 0 && ratePercent <= 0) {
      status = "NO_RULE";
      statusReason = "Percentual de comissão zerado";
    }

    const released = status === "COMMISSIONABLE" ? expected : 0;
    const ruleSnapshot = rateResult.rule
      ? serializeCommissionRuleSnapshot(rateResult.rule)
      : null;

    lines.push({
      ledgerLineKey: buildCommissionReceiptLedgerLineKey({
        year,
        month,
        nomusReceivableId: receivable.nomusReceivableId,
        commissionRecordId: null,
        commissionPaymentScheduleId: null,
        installmentNumber: receivable.installmentNumber ?? null,
        nomusOrderItemId: item.nomusOrderItemId,
        ruleId: rateResult.rule?.id ?? null,
      }),
      year,
      month,
      nomusReceivableId: receivable.nomusReceivableId,
      receivableNumber: receivable.receivableNumber ?? null,
      installmentNumber: receivable.installmentNumber ?? null,
      settlementDate: isoDate(receivable.settlementDate) ?? "",
      receiptDate: resolveReceiptCompetenceLineFields(receivable).receiptDate,
      receiptIds: resolveReceiptCompetenceLineFields(receivable).receiptIds,
      dueDate: isoDate(receivable.dueDate),
      receivableAmount: normalizeCommissionLedgerMoney(receivable.amountReceivable),
      receivedAmount: principal.receivedGrossAmount,
      receivedGrossAmount: principal.receivedGrossAmount,
      commissionPrincipalAmount: principal.commissionPrincipalAmount,
      ignoredFinancialChargesAmount: principal.ignoredFinancialChargesAmount,
      auditFlags: principal.auditFlags,
      receivedSharePercent:
        orderItemsTotal > 0 ? roundMoney((receivedBase / orderItemsTotal) * 100) : null,
      customerExternalId: receivable.customerExternalId ?? order.customerExternalId,
      customerId: receivable.customerId ?? null,
      customerName: receivable.customerName ?? order.customerName,
      nomusNfeId,
      nfeNumber: receivable.nfeNumber ?? nfeLink?.nfeNumber ?? null,
      orderCode: order.orderCode,
      localOrderId: order.localOrderId,
      nomusOrderItemId: item.nomusOrderItemId,
      localItemId: item.localItemId,
      productCode: item.productCode,
      productName: item.productName,
      rawSellerId: order.seller.nomusSellerId,
      rawSellerName: order.seller.responsibleName,
      canonicalSellerId: sellerResolution.canonicalSellerId ?? canonicalSellerId,
      canonicalSellerName: sellerResolution.canonicalSellerName,
      sellerResolutionStatus: sellerResolution.resolutionStatus,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      commissionReceivableScheduleId: null,
      ruleId: ruleSnapshot?.ruleId ?? null,
      ruleName: ruleSnapshot?.ruleName ?? null,
      ratePercent: normalizeCommissionLedgerMoney(ratePercent),
      commissionableBaseAmount: receivedBase,
      expectedCommissionAmount: expected,
      releasedCommissionAmount: released,
      grossCommissionAmount,
      status,
      statusReason,
      exclusionRuleId: exclusion?.rule.id ?? null,
      exclusionReason: exclusion?.reason ?? null,
      source: "CALCULATED",
    });
  }

  return lines;
}

function groupAuditRowsByReceivable(rows: VisualAuditRow[]): Map<number, VisualAuditRow[]> {
  const map = new Map<number, VisualAuditRow[]>();
  for (const row of rows) {
    if (row.nomusReceivableId == null) continue;
    const list = map.get(row.nomusReceivableId) ?? [];
    list.push(row);
    map.set(row.nomusReceivableId, list);
  }
  return map;
}

export function aggregateCommissionReceiptPreview(
  lines: CommissionReceiptPreviewLine[],
  input: Pick<
    CommissionReceiptPreviewContext,
    "year" | "month" | "includeExcluded" | "includeExceptions"
  >,
  settledReceivableCount: number
): CommissionReceiptPreviewResult {
  const includeExcluded = input.includeExcluded !== false;
  const includeExceptions = input.includeExceptions !== false;
  const countByStatus = emptyStatusCounts();

  let totalReceivedAmount = 0;
  let totalCommissionableBase = 0;
  let totalExpectedCommission = 0;
  let totalReleasedCommission = 0;
  let totalExcludedAmount = 0;
  let totalExceptionAmount = 0;

  const sellerMap = new Map<string, CommissionReceiptPreviewBucket>();
  const customerMap = new Map<
    string,
    CommissionReceiptPreviewResult["byCustomer"][number]
  >();
  const seenReceivableForReceived = new Set<number>();
  const seenSellerReceivableReceived = new Set<string>();
  const seenCustomerReceivableReceived = new Set<string>();

  for (const line of lines) {
    countByStatus[line.status] = (countByStatus[line.status] ?? 0) + 1;

    const isGroupExcluded = line.status === "GROUP_COMPANY_EXCLUDED";
    const isExcluded = line.status === "CUSTOMER_EXCLUDED" || isGroupExcluded;
    const isException = isExceptionStatus(line.status);
    const countsForTotals =
      (includeExcluded || !isExcluded) && (includeExceptions || !isException);

    if (!seenReceivableForReceived.has(line.nomusReceivableId)) {
      seenReceivableForReceived.add(line.nomusReceivableId);
      totalReceivedAmount = roundMoney(totalReceivedAmount + line.receivedAmount);
    }

    if (countsForTotals) {
      if (isExcluded) {
        totalExcludedAmount = roundMoney(
          totalExcludedAmount +
            (isGroupExcluded ? line.receivedAmount : line.commissionableBaseAmount)
        );
      }
      if (isException) {
        totalExceptionAmount = roundMoney(
          totalExceptionAmount + line.receivedAmount
        );
      }
      if (line.status === "COMMISSIONABLE") {
        totalCommissionableBase = roundMoney(
          totalCommissionableBase + line.commissionableBaseAmount
        );
        totalExpectedCommission = roundMoney(
          totalExpectedCommission + line.expectedCommissionAmount
        );
        totalReleasedCommission = roundMoney(
          totalReleasedCommission + line.releasedCommissionAmount
        );
      }
    }

    const sellerKey = line.canonicalSellerId ?? line.rawSellerName ?? "—";
    const sellerReceivableKey = `${sellerKey}|${line.nomusReceivableId}`;
    const sellerBucket = sellerMap.get(sellerKey) ?? {
      sellerId: line.canonicalSellerId,
      sellerName: line.canonicalSellerName ?? line.rawSellerName,
      receivableCount: 0,
      receivedAmount: 0,
      commissionableBase: 0,
      expectedCommission: 0,
      releasedCommission: 0,
    };
    if (!seenSellerReceivableReceived.has(sellerReceivableKey)) {
      seenSellerReceivableReceived.add(sellerReceivableKey);
      sellerBucket.receivedAmount = roundMoney(
        sellerBucket.receivedAmount + line.receivedAmount
      );
    }
    if (line.status === "COMMISSIONABLE" && countsForTotals) {
      sellerBucket.commissionableBase = roundMoney(
        sellerBucket.commissionableBase + line.commissionableBaseAmount
      );
      sellerBucket.expectedCommission = roundMoney(
        sellerBucket.expectedCommission + line.expectedCommissionAmount
      );
      sellerBucket.releasedCommission = roundMoney(
        sellerBucket.releasedCommission + line.releasedCommissionAmount
      );
    }
    sellerMap.set(sellerKey, sellerBucket);

    const customerKey = String(line.customerExternalId ?? line.customerName ?? "—");
    const customerReceivableKey = `${customerKey}|${line.nomusReceivableId}`;
    const customerBucket = customerMap.get(customerKey) ?? {
      customerExternalId: line.customerExternalId,
      customerName: line.customerName,
      receivableCount: 0,
      receivedAmount: 0,
      commissionableBase: 0,
      expectedCommission: 0,
      releasedCommission: 0,
    };
    if (!seenCustomerReceivableReceived.has(customerReceivableKey)) {
      seenCustomerReceivableReceived.add(customerReceivableKey);
      customerBucket.receivedAmount = roundMoney(
        customerBucket.receivedAmount + line.receivedAmount
      );
    }
    if (line.status === "COMMISSIONABLE" && countsForTotals) {
      customerBucket.commissionableBase = roundMoney(
        customerBucket.commissionableBase + line.commissionableBaseAmount
      );
      customerBucket.expectedCommission = roundMoney(
        customerBucket.expectedCommission + line.expectedCommissionAmount
      );
      customerBucket.releasedCommission = roundMoney(
        customerBucket.releasedCommission + line.releasedCommissionAmount
      );
    }
    customerMap.set(customerKey, customerBucket);
  }

  const bySeller = [...sellerMap.values()].sort((a, b) =>
    (a.sellerName ?? "").localeCompare(b.sellerName ?? "", "pt-BR")
  );
  const byCustomer = [...customerMap.values()].sort((a, b) =>
    (a.customerName ?? "").localeCompare(b.customerName ?? "", "pt-BR")
  );

  return {
    year: input.year,
    month: input.month,
    totalReceivables: settledReceivableCount,
    totalReceivedAmount: roundMoney(totalReceivedAmount),
    totalCommissionableBase: roundMoney(totalCommissionableBase),
    totalExpectedCommission: roundMoney(totalExpectedCommission),
    totalReleasedCommission: roundMoney(totalReleasedCommission),
    totalExcludedAmount: roundMoney(totalExcludedAmount),
    totalExceptionAmount: roundMoney(totalExceptionAmount),
    countByStatus,
    bySeller: bySeller.map((row) => ({
      ...row,
      receivableCount: settledReceivableCount,
    })),
    byCustomer,
    lines,
  };
}

function applyOpenForecastAmountsToLine(
  line: CommissionReceiptPreviewLine,
  receivable: CommissionReceiptReceivableInput
): CommissionReceiptPreviewLine {
  const open = resolveOpenReceivableBalance(receivable);
  return {
    ...line,
    receivedAmount: normalizeCommissionLedgerMoney(open),
    receivedSharePercent:
      receivable.amountReceivable > 0
        ? roundMoney((open / receivable.amountReceivable) * 100)
        : null,
  };
}

export function buildCommissionReceiptPreview(
  input: CommissionReceiptPreviewContext
): CommissionReceiptPreviewResult {
  const scoped = resolveScopedReceivablesForPreview(input);
  const commissionMode = input.commissionMode ?? "released";
  const isForecast = input.receivableScope === "open";

  const ordersByNfeId = input.ordersByNfeId;
  const ambiguousNfeIds = input.ambiguousNfeIds ?? new Set<number>();
  const useMaterializedSchedules = input.materializedSchedulesByReceivableId !== undefined;
  const auditByReceivable = groupAuditRowsByReceivable(input.persistedAuditRows ?? []);
  const lines: CommissionReceiptPreviewLine[] = [];

  for (const receivable of scoped) {
    if (
      !customerMatchesFilter(
        receivable.customerName,
        receivable.customerExternalId,
        input.customer
      )
    ) {
      continue;
    }

    if (isCommissionInternalGroupReceivable(receivable)) {
      const line = buildGroupCompanyExcludedLine({
        receivable,
        year: input.year,
        month: input.month,
      });
      lines.push(isForecast ? applyOpenForecastAmountsToLine(line, receivable) : line);
      continue;
    }

    const nfeIdForLink = receivable.nomusNfeId ?? null;
    if (nfeIdForLink != null && ambiguousNfeIds.has(nfeIdForLink)) {
      const line: CommissionReceiptPreviewLine = {
        ...buildExceptionLine({
          receivable,
          year: input.year,
          month: input.month,
          status: "NO_SALES_LINK",
          statusReason: COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON,
        }),
        orderCode: null,
        localOrderId: null,
        linkResolutionSource: "AMBIGUOUS",
        linkResolutionStatus: "AMBIGUOUS",
      };
      lines.push(isForecast ? applyOpenForecastAmountsToLine(line, receivable) : line);
      continue;
    }

    if (useMaterializedSchedules) {
      const schedules =
        input.materializedSchedulesByReceivableId!.get(receivable.nomusReceivableId) ?? [];
      const nfeId = receivable.nomusNfeId ?? null;
      const order = nfeId != null ? ordersByNfeId.get(nfeId) : undefined;
      const commissionRecord =
        nfeId != null ? input.commissionRecordsByNfeId?.get(nfeId) : undefined;
      const scheduleLines = buildLinesForReceivableWithMaterializedSchedule({
        receivable,
        schedules,
        year: input.year,
        month: input.month,
        exclusionRules: input.exclusionRules,
        order,
        orderSnapshotDiagnosis:
          nfeId != null ? input.orderSnapshotDiagnosisByNfeId?.get(nfeId) : undefined,
        identityCtx: input.identityCtx,
        commissionRecord,
        commissionMode,
      }).map((line) =>
        line.commissionReceivableScheduleId
          ? {
              ...line,
              linkResolutionSource: "SCHEDULE" as const,
              linkResolutionStatus: "OK" as const,
            }
          : {
              ...line,
              linkResolutionSource: line.localOrderId
                ? ("INVOICE_SALES_ORDER" as const)
                : ("UNRESOLVED" as const),
              linkResolutionStatus: line.localOrderId
                ? ("OK" as const)
                : ("UNRESOLVED" as const),
            }
      );
      for (const line of scheduleLines) {
        if (
          !sellerMatchesFilter(
            line.canonicalSellerName,
            line.rawSellerName,
            input.seller
          )
        ) {
          continue;
        }
        lines.push(line);
      }
      continue;
    }

    const auditRows = auditByReceivable.get(receivable.nomusReceivableId) ?? [];
    if (!isForecast && auditRows.length > 0) {
      for (const row of auditRows) {
        if (
          !sellerMatchesFilter(
            row.canonicalSellerName,
            row.rawSellerName ?? row.commissionPersonName,
            input.seller
          )
        ) {
          continue;
        }
        lines.push(previewLineFromAuditRow(row, input.year, input.month));
      }
      continue;
    }

    const nfeId = receivable.nomusNfeId ?? null;
    const order = nfeId != null ? ordersByNfeId.get(nfeId) : undefined;

    if (!order) {
      const line = buildExceptionLine({
        receivable,
        year: input.year,
        month: input.month,
        status: "NO_SALES_LINK",
        statusReason: "Título sem vínculo com pedido/NF",
      });
      lines.push(isForecast ? applyOpenForecastAmountsToLine(line, receivable) : line);
      continue;
    }

    if (!input.allowItemRecalculationFallback) {
      const line = buildExceptionLine({
        receivable,
        year: input.year,
        month: input.month,
        status: "NO_SCHEDULE",
        statusReason: COMMISSION_RECEIPT_NO_SCHEDULE_REASON,
        order,
        identityCtx: input.identityCtx,
        commissionRecord:
          nfeId != null ? input.commissionRecordsByNfeId?.get(nfeId) : undefined,
      });
      lines.push(isForecast ? applyOpenForecastAmountsToLine(line, receivable) : line);
      continue;
    }

    const calculated = calculatePreviewLinesForReceivable({
      receivable,
      order,
      year: input.year,
      month: input.month,
      rules: input.rules,
      exclusionRules: input.exclusionRules,
      identityCtx: input.identityCtx,
      itemRateOverrides: input.itemRateOverrides,
    });

    for (const line of calculated) {
      if (
        !sellerMatchesFilter(
          line.canonicalSellerName,
          line.rawSellerName,
          input.seller
        )
      ) {
        continue;
      }
      lines.push(line);
    }
  }

  return aggregateCommissionReceiptPreview(lines, input, scoped.length);
}

/** Previsão oficial — títulos em aberto, mesmas regras do fechamento por recebimento. */
export function buildCommissionReceivableForecastPreview(
  input: CommissionReceiptPreviewContext
): CommissionReceiptPreviewResult {
  return buildCommissionReceiptPreview({
    ...input,
    receivableScope: "open",
    commissionMode: "forecast",
    allowItemRecalculationFallback: false,
  });
}

export function receiptPreviewCsvHeader(): string[] {
  return [
    "ledgerLineKey",
    "nomusReceivableId",
    "installmentNumber",
    "receiptDate",
    "settlementDate",
    "customerName",
    "orderCode",
    "nfeNumber",
    "productCode",
    "canonicalSellerName",
    "status",
    "commissionableBaseAmount",
    "ratePercent",
    "expectedCommissionAmount",
    "releasedCommissionAmount",
    "statusReason",
  ];
}

export function receiptPreviewLineToCsvRow(line: CommissionReceiptPreviewLine): string[] {
  return [
    line.ledgerLineKey,
    String(line.nomusReceivableId),
    line.installmentNumber != null ? String(line.installmentNumber) : "",
    line.receiptDate ?? "",
    line.settlementDate,
    line.customerName ?? "",
    line.orderCode ?? "",
    line.nfeNumber ?? "",
    line.productCode ?? "",
    line.canonicalSellerName ?? line.rawSellerName ?? "",
    line.status,
    line.commissionableBaseAmount.toFixed(2),
    line.ratePercent.toFixed(4),
    line.expectedCommissionAmount.toFixed(2),
    line.releasedCommissionAmount.toFixed(2),
    line.statusReason ?? "",
  ];
}
