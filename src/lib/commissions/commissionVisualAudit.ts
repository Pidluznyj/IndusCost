/**
 * Auditoria visual por Contas a Receber — lógica pura (sem Prisma).
 */
import { roundMoney } from "./commission-money.js";

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
};

export type VisualAuditRow = VisualAuditRowInput & {
  receivableTitleStatus: VisualAuditReceivableTitleStatus;
  commissionStatus: VisualAuditCommissionStatus;
  commissionPending: number;
  financialSharePercent: number | null;
  alerts: VisualAuditAlertCode[];
  alertLabels: string[];
};

export type VisualAuditCards = {
  documentAmountTotal: number;
  receivableAmountTotal: number;
  commissionableBaseTotal: number;
  commissionCalculatedTotal: number;
  commissionExpectedTotal: number;
  commissionReleasedTotal: number;
  commissionFutureTotal: number;
  commissionBlockedTotal: number;
  documentCount: number;
  scheduleCount: number;
  divergenceCount: number;
  averageRatePercent: number;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
    push("CLIENTE_SEM_COMISSAO", "Cliente marcado como sem comissão");
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
  const financialSharePercent =
    input.documentBaseAmount > 0
      ? roundMoney((input.receivableAmount / input.documentBaseAmount) * 100)
      : null;

  return {
    ...input,
    receivableTitleStatus,
    commissionStatus,
    commissionPending,
    financialSharePercent,
    alerts,
    alertLabels,
  };
}

export function computeVisualAuditCards(rows: VisualAuditRow[]): VisualAuditCards {
  const docKeys = new Set<string>();
  let documentAmountTotal = 0;
  let receivableAmountTotal = 0;
  let commissionableBaseTotal = 0;
  let commissionCalculatedTotal = 0;
  let commissionExpectedTotal = 0;
  let commissionReleasedTotal = 0;
  let commissionFutureTotal = 0;
  let commissionBlockedTotal = 0;
  let divergenceCount = 0;
  const docAmountByKey = new Map<string, number>();

  for (const row of rows) {
    if (!docAmountByKey.has(row.documentKey)) {
      docAmountByKey.set(row.documentKey, row.documentBaseAmount);
      documentAmountTotal = roundMoney(documentAmountTotal + row.documentBaseAmount);
      docKeys.add(row.documentKey);
    }
    commissionableBaseTotal = roundMoney(commissionableBaseTotal + row.itemBaseAmount);
    commissionCalculatedTotal = roundMoney(commissionCalculatedTotal + row.itemCommissionAmount);
    receivableAmountTotal = roundMoney(receivableAmountTotal + row.receivableAmount);
    commissionExpectedTotal = roundMoney(commissionExpectedTotal + row.commissionExpected);
    commissionReleasedTotal = roundMoney(commissionReleasedTotal + row.commissionReleased);
    if (row.commissionStatus === "AGUARDANDO_RECEBIMENTO" && row.receivableTitleStatus === "FUTURO") {
      commissionFutureTotal = roundMoney(commissionFutureTotal + row.commissionPending);
    }
    if (row.commissionStatus === "BLOQUEADA_INADIMPLENCIA") {
      commissionBlockedTotal = roundMoney(commissionBlockedTotal + row.commissionPending);
    }
    if (row.alerts.length > 0) divergenceCount += 1;
  }

  const averageRatePercent =
    commissionableBaseTotal > 0
      ? roundMoney((commissionCalculatedTotal / commissionableBaseTotal) * 100)
      : 0;

  return {
    documentAmountTotal,
    receivableAmountTotal,
    commissionableBaseTotal,
    commissionCalculatedTotal,
    commissionExpectedTotal,
    commissionReleasedTotal,
    commissionFutureTotal,
    commissionBlockedTotal,
    documentCount: docKeys.size,
    scheduleCount: rows.filter((r) => r.scheduleId).length,
    divergenceCount,
    averageRatePercent,
  };
}

export function visualAuditRowToCsv(row: VisualAuditRow): Record<string, string | number> {
  return {
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
    percentualTitulo: row.financialSharePercent ?? "",
    comissaoPrevista: row.commissionExpected,
    comissaoLiberada: row.commissionReleased,
    comissaoPendente: row.commissionPending,
    statusTitulo: row.receivableTitleStatus,
    statusComissao: row.commissionStatus,
    alertas: row.alertLabels.join("; "),
    baseItem: row.itemBaseAmount,
    percentualItem: row.itemRatePercent,
    produto: row.productCode ?? "",
  };
}

export function buildVisualAuditCsv(rows: VisualAuditRow[]): string {
  if (rows.length === 0) return "vendedor,cliente,pedido,nfe\n";
  const sample = visualAuditRowToCsv(rows[0]!);
  const headers = Object.keys(sample);
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = rows.map((row) =>
    headers.map((h) => escape(visualAuditRowToCsv(row)[h] ?? "")).join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}
