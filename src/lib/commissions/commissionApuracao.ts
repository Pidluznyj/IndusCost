/**
 * Relatório de Apuração de Comissão — lógica pura (sem Prisma).
 * Organiza dados do motor oficial; não recalcula comissões.
 */

import type { CommissionRecordStatus } from "@prisma/client";
import { roundMoney } from "./commission-money.js";
import {
  hasBlockingCommissionAuditTypes,
  isOutOfTablePriceMetadata,
} from "./commissionOutOfTable.js";
import {
  isCommissionRecordWithoutResolvedSeller,
  resolveCommissionSellerDisplay,
} from "./commissionSellerDisplay.js";

export type CommissionApuracaoLineStatus =
  | "CALCULADA"
  | "LIBERADA"
  | "PAGA"
  | "PENDENTE_RECEBIMENTO"
  | "DIVERGENTE"
  | "BLOQUEADA";

export type CommissionApuracaoCompareStatus =
  | "OK"
  | "DIFERENCA_VALOR"
  | "DIFERENCA_PERCENTUAL"
  | "NF_NAO_ENCONTRADA"
  | "CONTA_RECEBER_NAO_ENCONTRADA"
  | "VENDEDOR_DIVERGENTE"
  | "SEM_TABELA_COMERCIAL"
  | "SEM_CUSTO_OFICIAL"
  | "PRECO_ABAIXO_ATACADO"
  | "RECEBIMENTO_NAO_IDENTIFICADO"
  | "NAO_COMPARADO";

export type CommissionApuracaoRecordInput = {
  id: string;
  status: CommissionRecordStatus;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  customerName: string | null;
  productCode: string | null;
  productName: string | null;
  baseAmount: number;
  ratePercent: number;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  calculatedAt: string;
  confirmedAt: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  nomusSellerId?: number | null;
  metadataJson: unknown;
  schedule?: {
    id: string;
    nomusReceivableId: number | null;
    installmentNumber: number | null;
    dueDate: string | null;
    receivableAmount: number;
    receivedAmount: number;
    commissionExpectedAmount: number;
    commissionReleasedAmount: number;
    receivedAt?: string | null;
  } | null;
  hasOpenAuditIssue?: boolean;
  hasBlockingAuditIssue?: boolean;
  auditIssueTypes?: string[];
  outOfTablePrice?: boolean;
};

export type CommissionApuracaoLine = {
  lineId: string;
  recordId: string;
  scheduleId: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  receivableCode: string | null;
  productCode: string | null;
  productName: string | null;
  nfeIssueDate: string | null;
  dueDate: string | null;
  receivedAt: string | null;
  duplicateAmount: number;
  calculationBase: number;
  ratePercent: number;
  commissionCalculated: number;
  commissionReleased: number;
  commissionPaid: number;
  balance: number;
  commercialTierCode: string | null;
  commercialTierName: string | null;
  ruleSource: string | null;
  ruleName: string | null;
  recordStatus: CommissionRecordStatus;
  apuracaoStatus: CommissionApuracaoLineStatus;
  blockReason: string | null;
  compareStatus: CommissionApuracaoCompareStatus;
  compareNote: string | null;
  isPayable: boolean;
  outOfTablePrice: boolean;
};

export type CommissionApuracaoTotals = {
  duplicateAmountTotal: number;
  calculationBaseTotal: number;
  commissionCalculatedTotal: number;
  commissionReleasedTotal: number;
  commissionPaidTotal: number;
  balanceTotal: number;
  linesOkCount: number;
  divergenceCount: number;
  blockedCount: number;
  payableCount: number;
  nomusReferenceBase: number | null;
  nomusReferenceCommission: number | null;
  nomusDiffAmount: number | null;
  nomusDiffPercent: number | null;
};

export type CommissionApuracaoDiagnostics = {
  recordsInPeriod: number;
  recordsConfirmedStatus: number;
  recordsForecastOnly: number;
  recordsWithoutConfirmedAt: number;
  periodBasis: "confirmedAt" | "calculatedAt";
  message: string | null;
};

function metaStr(metadataJson: unknown, key: string): string | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const v = (metadataJson as Record<string, unknown>)[key];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

export function resolveApuracaoLineStatus(
  recordStatus: CommissionRecordStatus,
  released: number,
  paid: number,
  commission: number,
  hasAudit: boolean
): CommissionApuracaoLineStatus {
  if (hasAudit || recordStatus === "ERROR") return "DIVERGENTE";
  if (recordStatus === "PAID_TOTAL" || (paid > 0 && paid >= commission)) return "PAGA";
  if (
    recordStatus === "RELEASED" ||
    recordStatus === "PARTIALLY_RELEASED" ||
    recordStatus === "PAID_PARTIAL" ||
    released > 0
  ) {
    return released >= commission ? "LIBERADA" : "LIBERADA";
  }
  if (
    recordStatus === "WAITING_RECEIVABLE" ||
    recordStatus === "WAITING_PAYMENT" ||
    recordStatus === "CONFIRMED_BY_OUTPUT_DOCUMENT"
  ) {
    return "PENDENTE_RECEBIMENTO";
  }
  if (recordStatus === "FORECAST_FROM_ORDER" || recordStatus === "WAITING_NFE") {
    return "CALCULADA";
  }
  if (recordStatus === "CANCELLED" || recordStatus === "REVERSED") return "BLOQUEADA";
  return "CALCULADA";
}

export function resolveBlockReason(
  record: CommissionApuracaoRecordInput,
  apuracaoStatus: CommissionApuracaoLineStatus
): string | null {
  const types = record.auditIssueTypes ?? [];
  if (types.includes("NO_COMMERCIAL_PRICE_TABLE")) return "Sem tabela comercial";
  if (types.includes("BELOW_MINIMUM_COMMERCIAL_TABLE_PRICE")) {
    return "Preço abaixo do Atacado (legado — recalcule o período)";
  }
  if (types.includes("NO_COMMISSION_RULE")) return "Sem regra de comissão";
  if (types.includes("NFE_WITHOUT_RECEIVABLE")) return "NF-e sem conta a receber";
  if (types.includes("NFE_WITHOUT_OUTPUT_DOCUMENT")) return "NF-e sem documento de saída";
  if (types.includes("RECEIVED_WITHOUT_RELEASE")) return "Recebimento sem liberação";
  if (
    isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: record.commissionPersonId,
      commissionPerson: {
        id: record.commissionPersonId,
        name: record.commissionPersonName,
      },
      nomusSellerId: record.nomusSellerId ?? null,
    })
  ) {
    return resolveCommissionSellerDisplay({
      commissionPersonId: record.commissionPersonId,
      commissionPerson: {
        id: record.commissionPersonId,
        name: record.commissionPersonName,
      },
      nomusSellerId: record.nomusSellerId ?? null,
    }).label;
  }
  if (apuracaoStatus === "BLOQUEADA") return "Registro cancelado ou estornado";
  if (apuracaoStatus === "DIVERGENTE") return "Divergência de auditoria em aberto";
  return null;
}

export function isApuracaoLinePayable(
  line: Pick<CommissionApuracaoLine, "apuracaoStatus" | "blockReason" | "commissionReleased">
): boolean {
  if (line.blockReason) return false;
  if (line.apuracaoStatus === "DIVERGENTE" || line.apuracaoStatus === "BLOQUEADA") return false;
  if (line.apuracaoStatus === "PENDENTE_RECEBIMENTO" || line.apuracaoStatus === "CALCULADA") {
    return false;
  }
  return line.commissionReleased > 0 || line.apuracaoStatus === "LIBERADA" || line.apuracaoStatus === "PAGA";
}

export function buildApuracaoLine(record: CommissionApuracaoRecordInput): CommissionApuracaoLine {
  const schedule = record.schedule;
  const duplicateAmount = schedule?.receivableAmount ?? record.baseAmount;

  const scheduleShare =
    schedule && record.commissionAmount > 0
      ? schedule.commissionExpectedAmount / record.commissionAmount
      : 1;
  const calculationBase = schedule
    ? roundMoney(record.baseAmount * scheduleShare)
    : record.baseAmount;
  const commissionCalculated = schedule
    ? schedule.commissionExpectedAmount
    : record.commissionAmount;
  const commissionReleased = schedule?.commissionReleasedAmount ?? record.releasedAmount;
  const commissionPaid = record.paidAmount;
  const balance = roundMoney(Math.max(0, commissionCalculated - commissionReleased - commissionPaid));

  const auditTypes = record.auditIssueTypes ?? [];
  const hasBlockingAudit =
    record.hasBlockingAuditIssue ??
    (auditTypes.length > 0
      ? hasBlockingCommissionAuditTypes(auditTypes)
      : Boolean(record.hasOpenAuditIssue));
  const outOfTablePrice =
    record.outOfTablePrice ?? isOutOfTablePriceMetadata(record.metadataJson);

  const apuracaoStatus = resolveApuracaoLineStatus(
    record.status,
    commissionReleased,
    commissionPaid,
    commissionCalculated,
    hasBlockingAudit
  );
  const blockReason = resolveBlockReason(record, apuracaoStatus);

  const tierCode = metaStr(record.metadataJson, "tierCode");
  const tierName = metaStr(record.metadataJson, "tierName");
  const ruleName = metaStr(record.metadataJson, "ruleName");
  const calculationType = metaStr(record.metadataJson, "calculationType");

  const line: CommissionApuracaoLine = {
    lineId: schedule ? `${record.id}:${schedule.id}` : record.id,
    recordId: record.id,
    scheduleId: schedule?.id ?? null,
    commissionPersonId: record.commissionPersonId,
    commissionPersonName: record.commissionPersonName,
    customerName: record.customerName,
    orderCode: record.orderCode,
    nfeNumber: record.nfeNumber,
    receivableCode:
      schedule?.nomusReceivableId != null ? String(schedule.nomusReceivableId) : null,
    productCode: record.productCode,
    productName: record.productName,
    nfeIssueDate: record.confirmedAt,
    dueDate: schedule?.dueDate ?? null,
    receivedAt: schedule?.receivedAt ?? null,
    duplicateAmount: roundMoney(duplicateAmount),
    calculationBase: roundMoney(calculationBase),
    ratePercent: record.ratePercent,
    commissionCalculated: roundMoney(commissionCalculated),
    commissionReleased: roundMoney(commissionReleased),
    commissionPaid: roundMoney(commissionPaid),
    balance: roundMoney(balance),
    commercialTierCode: tierCode,
    commercialTierName: tierName,
    ruleSource: calculationType ?? (tierCode ? "COMMERCIAL_PRICE_TIER" : "FIXED_PERCENT"),
    ruleName,
    recordStatus: record.status,
    apuracaoStatus,
    blockReason,
    compareStatus: "NAO_COMPARADO",
    compareNote: null,
    isPayable: false,
    outOfTablePrice,
  };
  line.isPayable = isApuracaoLinePayable(line);
  return line;
}

export function buildApuracaoLines(records: CommissionApuracaoRecordInput[]): CommissionApuracaoLine[] {
  const lines: CommissionApuracaoLine[] = [];
  for (const record of records) {
    if (record.schedule) {
      lines.push(buildApuracaoLine(record));
    } else {
      lines.push(buildApuracaoLine({ ...record, schedule: null }));
    }
  }
  return lines.sort((a, b) => {
    const aKey = a.commissionPersonName.localeCompare(b.commissionPersonName, "pt-BR");
    if (aKey !== 0) return aKey;
    return (a.nfeNumber ?? "").localeCompare(b.nfeNumber ?? "", "pt-BR");
  });
}

export function computeApuracaoTotals(
  lines: CommissionApuracaoLine[],
  nomusReference?: { base: number | null; commission: number | null }
): CommissionApuracaoTotals {
  let duplicateAmountTotal = 0;
  let calculationBaseTotal = 0;
  let commissionCalculatedTotal = 0;
  let commissionReleasedTotal = 0;
  let commissionPaidTotal = 0;
  let balanceTotal = 0;
  let linesOkCount = 0;
  let divergenceCount = 0;
  let blockedCount = 0;
  let payableCount = 0;

  for (const line of lines) {
    duplicateAmountTotal = roundMoney(duplicateAmountTotal + line.duplicateAmount);
    calculationBaseTotal = roundMoney(calculationBaseTotal + line.calculationBase);
    commissionCalculatedTotal = roundMoney(commissionCalculatedTotal + line.commissionCalculated);
    commissionReleasedTotal = roundMoney(commissionReleasedTotal + line.commissionReleased);
    commissionPaidTotal = roundMoney(commissionPaidTotal + line.commissionPaid);
    balanceTotal = roundMoney(balanceTotal + line.balance);

    if (line.apuracaoStatus === "DIVERGENTE") divergenceCount += 1;
    else if (line.apuracaoStatus === "BLOQUEADA") blockedCount += 1;
    else linesOkCount += 1;
    if (line.isPayable) payableCount += 1;
  }

  const nomusReferenceBase = nomusReference?.base ?? null;
  const nomusReferenceCommission = nomusReference?.commission ?? null;
  let nomusDiffAmount: number | null = null;
  let nomusDiffPercent: number | null = null;
  if (nomusReferenceCommission != null) {
    nomusDiffAmount = roundMoney(commissionCalculatedTotal - nomusReferenceCommission);
    nomusDiffPercent =
      nomusReferenceCommission !== 0
        ? roundMoney((nomusDiffAmount / nomusReferenceCommission) * 100)
        : null;
  }

  return {
    duplicateAmountTotal,
    calculationBaseTotal,
    commissionCalculatedTotal,
    commissionReleasedTotal,
    commissionPaidTotal,
    balanceTotal,
    linesOkCount,
    divergenceCount,
    blockedCount,
    payableCount,
    nomusReferenceBase,
    nomusReferenceCommission,
    nomusDiffAmount,
    nomusDiffPercent,
  };
}

export function apuracaoLineToCsvRow(line: CommissionApuracaoLine): Record<string, string | number> {
  return {
    vendedor: line.commissionPersonName,
    cliente: line.customerName ?? "",
    pedido: line.orderCode ?? "",
    nfe: line.nfeNumber ?? "",
    contaReceber: line.receivableCode ?? "",
    valorDuplicata: line.duplicateAmount,
    baseCalculo: line.calculationBase,
    percentual: line.ratePercent,
    comissao: line.commissionCalculated,
    comissaoLiberada: line.commissionReleased,
    comissaoPaga: line.commissionPaid,
    saldo: line.balance,
    faixa: line.commercialTierName ?? line.commercialTierCode ?? "",
    regra: line.ruleName ?? "",
    status: line.apuracaoStatus,
    motivo: line.blockReason ?? "",
    precoForaTabela: line.outOfTablePrice ? "Sim" : "Não",
  };
}
