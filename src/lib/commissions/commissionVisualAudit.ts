/**
 * Auditoria visual por Contas a Receber — lógica pura (sem Prisma).
 */
import { roundMoney } from "./commission-money.js";
import {
  customerExclusionAlertLabel,
} from "./commissionCustomerExclusionApply.js";
import {
  VISUAL_AUDIT_MODE_LABELS,
  type VisualAuditAppraisalMode,
} from "./commissionVisualAudit.shared.js";

export {
  parseVisualAuditAppraisalMode,
  VISUAL_AUDIT_APPRAISAL_MODES,
  VISUAL_AUDIT_MODE_DESCRIPTIONS,
  VISUAL_AUDIT_MODE_LABELS,
  type VisualAuditAppraisalMode,
} from "./commissionVisualAudit.shared.js";

export type VisualAuditReceivableTitleStatus =
  | "BAIXADO"
  | "PARCIAL"
  | "EM_ABERTO"
  | "VENCIDO"
  | "FUTURO"
  | "SEM_VINCULO";

export type VisualAuditCommissionStatus =
  | "LIBERADA"
  | "PARCIALMENTE_LIBERADA"
  | "AGUARDANDO_RECEBIMENTO"
  | "BLOQUEADA_INADIMPLENCIA"
  | "SEM_COMISSAO"
  | "DIVERGENTE";

export type VisualAuditAlertCode =
  | "TITULO_SEM_SCHEDULE"
  | "SCHEDULE_SEM_NOMUS_AR"
  | "COMISSAO_LIBERADA_ACIMA_PREVISTA"
  | "COMISSAO_PREVISTA_ZERADA_COM_BASE"
  | "NF_SEM_TITULO"
  | "TITULO_SEM_BAIXA"
  | "TITULO_BAIXADO_SEM_LIBERACAO"
  | "DIFERENCA_ARREDONDAMENTO"
  | "CLIENTE_SEM_COMISSAO"
  | "PERCENTUAL_FORA_REGUA";

export type VisualAuditRowInput = {
  lineId: string;
  recordId: string;
  scheduleId: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  confirmedAt: string | null;
  documentKey: string;
  documentBaseAmount: number;
  documentCommissionTotal: number;
  itemBaseAmount: number;
  itemCommissionAmount: number;
  itemRatePercent: number;
  productCode: string | null;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  dueDate: string | null;
  settlementDate: string | null;
  receivableAmount: number;
  receivedAmount: number;
  openBalance: number;
  allocationPercent: number | null;
  commissionExpected: number;
  commissionReleased: number;
  hasArLink: boolean;
  hasSchedule: boolean;
  customerNoCommission: boolean;
  isCommissionable: boolean;
  exclusionReason: string | null;
  exclusionRuleId: string | null;
};

export type VisualAuditRow = VisualAuditRowInput & {
  allocatedBaseAmount: number;
  receivableTitleStatus: VisualAuditReceivableTitleStatus;
  commissionStatus: VisualAuditCommissionStatus;
  commissionPending: number;
  financialSharePercent: number | null;
  alerts: VisualAuditAlertCode[];
  alertLabels: string[];
};

export type VisualAuditCards = {
  appraisalMode: VisualAuditAppraisalMode;
  documentAmountTotal: number;
  receivableAmountTotal: number;
  receivedAmountTotal: number;
  commissionableBaseTotal: number;
  commissionCalculatedTotal: number;
  commissionExpectedTotal: number;
  commissionReleasedTotal: number;
  commissionPendingTotal: number;
  commissionFutureTotal: number;
  commissionBlockedTotal: number;
  documentCount: number;
  receivableCount: number;
  scheduleCount: number;
  divergenceCount: number;
  averageRatePercent: number;
};

export type VisualAuditNomusReference = {
  base: number | null;
  commission: number | null;
  baseDiff: number | null;
  commissionDiff: number | null;
  baseDiffPercent: number | null;
  commissionDiffPercent: number | null;
  nomusAverageRatePercent: number | null;
  indusAverageRatePercent: number | null;
  comparable: boolean;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function resolveAllocatedBaseAmount(row: VisualAuditRowInput): number {
  const pct = row.allocationPercent;
  if (pct != null && pct > 0) {
    return roundMoney(row.itemBaseAmount * (pct / 100));
  }
  if (row.commissionExpected > 0 && row.itemRatePercent > 0) {
    return roundMoney(row.commissionExpected / (row.itemRatePercent / 100));
  }
  return roundMoney(row.itemBaseAmount);
}

export function resolveReceivableUniqueKey(row: VisualAuditRowInput): string | null {
  if (row.nomusReceivableId != null) return `cr:${row.nomusReceivableId}`;
  if (row.scheduleId) return `sch:${row.scheduleId}`;
  return null;
}

export function resolveReceivableTitleStatus(input: {
  nomusReceivableId: number | null;
  hasArLink: boolean;
  receivableAmount: number;
  receivedAmount: number;
  openBalance: number;
  dueDate: string | null;
  settlementDate: string | null;
}): VisualAuditReceivableTitleStatus {
  if (input.nomusReceivableId == null || !input.hasArLink) return "SEM_VINCULO";
  const recv = roundMoney(input.receivedAmount);
  const amount = roundMoney(input.receivableAmount);
  const balance = roundMoney(input.openBalance);
  if (input.settlementDate || (amount > 0 && recv >= amount) || (balance <= 0 && recv > 0)) {
    return recv > 0 && balance > 0 ? "PARCIAL" : "BAIXADO";
  }
  if (recv > 0) return "PARCIAL";
  const today = startOfDay(new Date());
  if (input.dueDate) {
    const due = startOfDay(new Date(input.dueDate));
    if (due.getTime() < today.getTime()) return "VENCIDO";
    if (due.getTime() > today.getTime()) return "FUTURO";
  }
  return "EM_ABERTO";
}

export function resolveVisualAuditAlerts(row: VisualAuditRowInput): {
  alerts: VisualAuditAlertCode[];
  alertLabels: string[];
} {
  const alerts: VisualAuditAlertCode[] = [];
  const labels: string[] = [];

  const push = (code: VisualAuditAlertCode, label: string) => {
    alerts.push(code);
    labels.push(label);
  };

  if (!row.hasSchedule && row.nomusReceivableId != null) {
    push("TITULO_SEM_SCHEDULE", "Título sem CommissionPaymentSchedule");
  }
  if (row.scheduleId && row.nomusReceivableId != null && !row.hasArLink) {
    push("SCHEDULE_SEM_NOMUS_AR", "Schedule sem NomusAccountsReceivable");
  }
  if (row.commissionReleased > row.commissionExpected + 0.01) {
    push("COMISSAO_LIBERADA_ACIMA_PREVISTA", "Comissão liberada maior que prevista");
  }
  if (row.commissionExpected <= 0 && row.itemBaseAmount > 0 && !row.customerNoCommission) {
    push("COMISSAO_PREVISTA_ZERADA_COM_BASE", "Comissão prevista zerada com base > 0");
  }
  if (row.documentCommissionTotal > 0 && !row.hasSchedule && row.nomusReceivableId == null) {
    push("NF_SEM_TITULO", "NF sem título vinculado");
  }
  if (row.receivedAmount > 0 && !row.settlementDate) {
    push("TITULO_SEM_BAIXA", "Título recebido sem data de baixa no CR");
  }
  if (row.receivedAmount > 0 && row.commissionReleased <= 0 && row.commissionExpected > 0) {
    push("TITULO_BAIXADO_SEM_LIBERACAO", "Título baixado sem comissão liberada");
  }
  const expectedRounded = roundMoney(row.commissionExpected);
  const releasedRounded = roundMoney(row.commissionReleased);
  if (
    Math.abs(row.commissionExpected - expectedRounded) > 0.001 ||
    Math.abs(row.commissionReleased - releasedRounded) > 0.001
  ) {
    push("DIFERENCA_ARREDONDAMENTO", "Possível diferença de arredondamento");
  }
  if (row.customerNoCommission) {
    push(
      "CLIENTE_SEM_COMISSAO",
      customerExclusionAlertLabel(row.exclusionReason)
    );
  }

  return { alerts, alertLabels: labels };
}

export function resolveCommissionVisualStatus(
  row: VisualAuditRowInput,
  alerts: VisualAuditAlertCode[]
): VisualAuditCommissionStatus {
  if (alerts.length > 0 && alerts.some((a) => a !== "CLIENTE_SEM_COMISSAO")) {
    return "DIVERGENTE";
  }
  if (row.commissionExpected <= 0 || row.customerNoCommission) return "SEM_COMISSAO";
  const title = resolveReceivableTitleStatus(row);
  if (title === "VENCIDO" && row.commissionReleased < row.commissionExpected) {
    return "BLOQUEADA_INADIMPLENCIA";
  }
  if (row.commissionReleased >= row.commissionExpected && row.commissionExpected > 0) {
    return "LIBERADA";
  }
  if (row.commissionReleased > 0) return "PARCIALMENTE_LIBERADA";
  return "AGUARDANDO_RECEBIMENTO";
}

export function buildVisualAuditRow(input: VisualAuditRowInput): VisualAuditRow {
  const { alerts, alertLabels } = resolveVisualAuditAlerts(input);
  const receivableTitleStatus = resolveReceivableTitleStatus(input);
  const commissionStatus = resolveCommissionVisualStatus(input, alerts);
  const commissionPending = roundMoney(
    Math.max(0, input.commissionExpected - input.commissionReleased)
  );
  const allocatedBaseAmount = resolveAllocatedBaseAmount(input);
  const financialSharePercent =
    input.documentBaseAmount > 0
      ? roundMoney((input.receivableAmount / input.documentBaseAmount) * 100)
      : null;

  return {
    ...input,
    allocatedBaseAmount,
    receivableTitleStatus,
    commissionStatus,
    commissionPending,
    financialSharePercent,
    alerts,
    alertLabels,
  };
}

export function filterRowsByAppraisalMode(
  rows: VisualAuditRow[],
  mode: VisualAuditAppraisalMode,
  period?: { from: Date | null; to: Date | null }
): VisualAuditRow[] {
  if (mode === "GENERATED") return rows;

  if (mode === "FORECAST") {
    return rows.filter((row) => {
      if (row.receivableTitleStatus === "SEM_VINCULO") return true;
      if (row.receivableTitleStatus === "BAIXADO") return false;
      if (row.commissionPending <= 0 && row.commissionExpected <= 0) return false;
      if (!period?.from && !period?.to) return true;
      if (!row.dueDate) return row.openBalance > 0;
      const due = new Date(row.dueDate).getTime();
      if (period.from && due < period.from.getTime()) return false;
      if (period.to && due > period.to.getTime()) return false;
      return true;
    });
  }

  return rows.filter((row) => {
    if (!row.settlementDate) return false;
    const settled = new Date(row.settlementDate).getTime();
    if (period?.from && settled < period.from.getTime()) return false;
    if (period?.to && settled > period.to.getTime()) return false;
    return true;
  });
}

export function computeVisualAuditCards(
  rows: VisualAuditRow[],
  mode: VisualAuditAppraisalMode = "GENERATED"
): VisualAuditCards {
  const docKeys = new Set<string>();
  const receivableKeys = new Set<string>();
  const scheduleKeys = new Set<string>();

  let documentAmountTotal = 0;
  let receivableAmountTotal = 0;
  let receivedAmountTotal = 0;
  let commissionableBaseTotal = 0;
  let commissionExpectedTotal = 0;
  let commissionReleasedTotal = 0;
  let commissionPendingTotal = 0;
  let commissionFutureTotal = 0;
  let commissionBlockedTotal = 0;
  let divergenceCount = 0;

  for (const row of rows) {
    if (!docKeys.has(row.documentKey)) {
      docKeys.add(row.documentKey);
      documentAmountTotal = roundMoney(documentAmountTotal + row.documentBaseAmount);
    }

    const receivableKey = resolveReceivableUniqueKey(row);
    if (receivableKey && !receivableKeys.has(receivableKey)) {
      receivableKeys.add(receivableKey);
      receivableAmountTotal = roundMoney(receivableAmountTotal + row.receivableAmount);
      receivedAmountTotal = roundMoney(receivedAmountTotal + row.receivedAmount);
    }

    const scheduleKey = row.scheduleId ?? row.lineId;
    if (!scheduleKeys.has(scheduleKey)) {
      scheduleKeys.add(scheduleKey);
      commissionableBaseTotal = roundMoney(
        commissionableBaseTotal + row.allocatedBaseAmount
      );
      commissionExpectedTotal = roundMoney(
        commissionExpectedTotal + row.commissionExpected
      );
      commissionReleasedTotal = roundMoney(
        commissionReleasedTotal + row.commissionReleased
      );
      commissionPendingTotal = roundMoney(
        commissionPendingTotal + row.commissionPending
      );
    }

    if (row.commissionStatus === "AGUARDANDO_RECEBIMENTO" && row.receivableTitleStatus === "FUTURO") {
      commissionFutureTotal = roundMoney(commissionFutureTotal + row.commissionPending);
    }
    if (row.commissionStatus === "BLOQUEADA_INADIMPLENCIA") {
      commissionBlockedTotal = roundMoney(commissionBlockedTotal + row.commissionPending);
    }
    if (row.alerts.length > 0) divergenceCount += 1;
  }

  const commissionCalculatedTotal = commissionExpectedTotal;
  const averageRatePercent =
    commissionableBaseTotal > 0
      ? roundMoney((commissionCalculatedTotal / commissionableBaseTotal) * 100)
      : 0;

  return {
    appraisalMode: mode,
    documentAmountTotal,
    receivableAmountTotal,
    receivedAmountTotal,
    commissionableBaseTotal,
    commissionCalculatedTotal,
    commissionExpectedTotal,
    commissionReleasedTotal,
    commissionPendingTotal,
    commissionFutureTotal,
    commissionBlockedTotal,
    documentCount: docKeys.size,
    receivableCount: receivableKeys.size,
    scheduleCount: scheduleKeys.size,
    divergenceCount,
    averageRatePercent,
  };
}

export function buildVisualAuditNomusReference(input: {
  mode: VisualAuditAppraisalMode;
  cards: VisualAuditCards;
  nomusBase: number | null;
  nomusCommission: number | null;
}): VisualAuditNomusReference {
  const comparable = input.mode === "PAYABLE";
  const indusBase = comparable
    ? input.cards.commissionableBaseTotal
    : input.cards.commissionableBaseTotal;
  const indusCommission = comparable
    ? input.cards.commissionReleasedTotal
    : input.cards.commissionCalculatedTotal;

  const baseDiff =
    input.nomusBase != null ? roundMoney(indusBase - input.nomusBase) : null;
  const commissionDiff =
    input.nomusCommission != null
      ? roundMoney(indusCommission - input.nomusCommission)
      : null;

  return {
    base: input.nomusBase,
    commission: input.nomusCommission,
    baseDiff,
    commissionDiff,
    baseDiffPercent:
      input.nomusBase != null && input.nomusBase > 0 && baseDiff != null
        ? roundMoney((baseDiff / input.nomusBase) * 100)
        : null,
    commissionDiffPercent:
      input.nomusCommission != null && input.nomusCommission > 0 && commissionDiff != null
        ? roundMoney((commissionDiff / input.nomusCommission) * 100)
        : null,
    nomusAverageRatePercent:
      input.nomusBase != null && input.nomusBase > 0 && input.nomusCommission != null
        ? roundMoney((input.nomusCommission / input.nomusBase) * 100)
        : null,
    indusAverageRatePercent: input.cards.averageRatePercent,
    comparable,
  };
}

export function visualAuditRowToCsv(
  row: VisualAuditRow,
  mode: VisualAuditAppraisalMode
): Record<string, string | number> {
  return {
    apuracao: VISUAL_AUDIT_MODE_LABELS[mode],
    vendedor: row.commissionPersonName,
    cliente: row.customerName ?? "",
    pedido: row.orderCode ?? "",
    nfe: row.nfeNumber ?? "",
    dataNf: row.confirmedAt ?? "",
    valorDocumento: row.documentBaseAmount,
    comissaoDocumento: row.documentCommissionTotal,
    codigoContaReceber: row.nomusReceivableId ?? "",
    parcela: row.installmentNumber ?? "",
    vencimento: row.dueDate ?? "",
    baixa: row.settlementDate ?? "",
    valorTitulo: row.receivableAmount,
    valorRecebido: row.receivedAmount,
    saldoAberto: row.openBalance,
    percentualTitulo: row.allocationPercent ?? row.financialSharePercent ?? "",
    baseItem: row.itemBaseAmount,
    baseRateada: row.allocatedBaseAmount,
    percentualItem: row.itemRatePercent,
    produto: row.productCode ?? "",
    comissionavel: row.isCommissionable ? "SIM" : "NAO",
    motivoExclusao: row.exclusionReason ?? "",
    regraExclusaoId: row.exclusionRuleId ?? "",
    comissaoPrevista: row.commissionExpected,
    comissaoLiberada: row.commissionReleased,
    comissaoPendente: row.commissionPending,
    statusTitulo: row.receivableTitleStatus,
    statusComissao: row.commissionStatus,
    alertas: row.alertLabels.join("; "),
  };
}

export function buildVisualAuditCsvSummaryLines(
  cards: VisualAuditCards
): string[] {
  return [
    `# apuracao=${cards.appraisalMode}`,
    `# documentos=${cards.documentCount}`,
    `# titulos_unicos=${cards.receivableCount}`,
    `# parcelas=${cards.scheduleCount}`,
    `# valor_nf_unico=${cards.documentAmountTotal}`,
    `# valor_cr_unico=${cards.receivableAmountTotal}`,
    `# valor_recebido=${cards.receivedAmountTotal}`,
    `# base_rateada=${cards.commissionableBaseTotal}`,
    `# comissao_prevista=${cards.commissionExpectedTotal}`,
    `# comissao_liberada=${cards.commissionReleasedTotal}`,
    `# comissao_pendente=${cards.commissionPendingTotal}`,
    `# percentual_medio=${cards.averageRatePercent}`,
  ];
}

export function buildVisualAuditCsv(
  rows: VisualAuditRow[],
  cards: VisualAuditCards
): string {
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  if (rows.length === 0) {
    return [...buildVisualAuditCsvSummaryLines(cards), "apuracao,vendedor,cliente"].join("\n");
  }

  const sample = visualAuditRowToCsv(rows[0]!, cards.appraisalMode);
  const headers = Object.keys(sample);
  const lines = rows.map((row) =>
    headers.map((h) => escape(visualAuditRowToCsv(row, cards.appraisalMode)[h] ?? "")).join(",")
  );
  return [
    ...buildVisualAuditCsvSummaryLines(cards),
    headers.join(","),
    ...lines,
  ].join("\n");
}
