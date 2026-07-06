/**
 * Auditoria read-only de rastreabilidade de comissão — tipos e helpers puros.
 */
import {
  COMMISSION_RECEIPT_NO_SCHEDULE_REASON,
  mapMaterializedScheduleToLedgerStatus,
  releaseCommissionFromMaterializedSchedule,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import { roundMoney } from "./commission-money.js";

export type CommissionTraceAuditStatus = "PASS" | "FAIL";

export type CommissionTraceAuditQuery = {
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  receivableCode?: string | null;
  customer?: string | null;
  sku?: string | null;
  includeLines?: boolean;
  nomusBase?: number | null;
  nomusCommission?: number | null;
};

export type CommissionTraceDataSource = {
  field: string;
  source: string;
  note?: string | null;
};

export type CommissionTraceSale = {
  salesOrderId: string;
  orderNumber: string;
  nfeNumbers: string[];
  nfeExternalIds: number[];
  customerId: string;
  customerName: string;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  saleDate: string | null;
};

export type CommissionTraceItem = {
  itemSnapshotId: string;
  salesOrderItemId: string;
  sku: string | null;
  productName: string;
  soldAmount: number;
  marginPercent: number | null;
  ruleId: string | null;
  ruleName: string | null;
  commissionRatePercent: number;
  grossCommissionAmount: number;
  finalCommissionAmount: number;
  status: string;
  exclusionReason: string | null;
};

export type CommissionTraceReceivable = {
  scheduleId: string | null;
  receivableId: number | null;
  receivableCode: string | null;
  installmentNumber: number | null;
  nominalAmount: number;
  sharePercent: number | null;
  scheduledCommissionAmount: number;
  grossScheduledCommissionAmount: number | null;
  scheduleStatus: string;
  ledgerStatus: string;
  statusReason: string | null;
};

export type CommissionTraceReceipt = {
  receivableId: number;
  receivableCode: string | null;
  settlementDate: string | null;
  dueDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  receivedSharePercent: number | null;
  releasedCommissionAmount: number;
  pendingCommissionAmount: number;
  grossCommissionAmount: number | null;
  commissionableBaseAmount: number;
  status: string;
  statusReason: string | null;
};

export type CommissionTraceNomusAudit = {
  nomusBase: number | null;
  nomusCommission: number | null;
  indusReleasedCommission: number;
  indusCommissionableBase: number;
  baseDifference: number | null;
  commissionDifference: number | null;
  explanation: string | null;
};

export type CommissionTraceClosing = {
  closingId: string;
  year: number;
  month: number;
  status: string;
  calculationHash: string | null;
  closedAt: string | null;
  isImmutable: boolean;
};

export type CommissionTraceAuditReport = {
  status: CommissionTraceAuditStatus;
  auditedAt: string;
  errorMessage?: string | null;
  sale: CommissionTraceSale | null;
  orderSnapshot: {
    snapshotId: string | null;
    sourceHash: string | null;
    totalSoldAmount: number;
    totalGrossCommissionAmount: number;
    totalFinalCommissionAmount: number;
    snapshotStatus: string | null;
  };
  items: CommissionTraceItem[];
  receivables: CommissionTraceReceivable[];
  receipts: CommissionTraceReceipt[];
  totals: {
    totalReceived: number;
    totalCommissionableBase: number;
    totalGrossCommission: number;
    totalExcludedCommission: number;
    totalFinalCommission: number;
    totalReleasedCommission: number;
    totalPendingCommission: number;
  };
  closing: CommissionTraceClosing | null;
  nomusAudit: CommissionTraceNomusAudit | null;
  alerts: Array<{ code: string; severity: string; message: string }>;
  dataSources: CommissionTraceDataSource[];
  checklist: Record<string, boolean | string>;
};

export function buildEmptyCommissionTraceReport(errorMessage: string): CommissionTraceAuditReport {
  return {
    status: "FAIL",
    auditedAt: new Date().toISOString(),
    errorMessage,
    sale: null,
    orderSnapshot: {
      snapshotId: null,
      sourceHash: null,
      totalSoldAmount: 0,
      totalGrossCommissionAmount: 0,
      totalFinalCommissionAmount: 0,
      snapshotStatus: null,
    },
    items: [],
    receivables: [],
    receipts: [],
    totals: {
      totalReceived: 0,
      totalCommissionableBase: 0,
      totalGrossCommission: 0,
      totalExcludedCommission: 0,
      totalFinalCommission: 0,
      totalReleasedCommission: 0,
      totalPendingCommission: 0,
    },
    closing: null,
    nomusAudit: null,
    alerts: [],
    dataSources: [],
    checklist: {},
  };
}

export function readRuleNameFromSnapshot(ruleSnapshotJson: unknown): string | null {
  if (ruleSnapshotJson == null || typeof ruleSnapshotJson !== "object") return null;
  const name = (ruleSnapshotJson as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function buildCommissionTraceReceipt(input: {
  schedule: MaterializedReceivableScheduleInput | null;
  receivable: CommissionReceiptReceivableInput;
}): CommissionTraceReceipt {
  if (!input.schedule) {
    return {
      receivableId: input.receivable.nomusReceivableId,
      receivableCode: input.receivable.receivableNumber,
      settlementDate: input.receivable.settlementDate?.toISOString() ?? null,
      dueDate: input.receivable.dueDate?.toISOString() ?? null,
      amountReceivable: roundMoney(input.receivable.amountReceivable),
      amountReceived: roundMoney(input.receivable.amountReceived),
      receivedSharePercent: null,
      releasedCommissionAmount: 0,
      pendingCommissionAmount: 0,
      grossCommissionAmount: null,
      commissionableBaseAmount: 0,
      status: "NO_SCHEDULE",
      statusReason: COMMISSION_RECEIPT_NO_SCHEDULE_REASON,
    };
  }

  const { status, reason } = mapMaterializedScheduleToLedgerStatus(input.schedule);
  const release = releaseCommissionFromMaterializedSchedule({
    schedule: input.schedule,
    receivable: input.receivable,
  });
  const scheduled = roundMoney(input.schedule.scheduledCommissionAmount);
  const released =
    status === "COMMISSIONABLE" ? release.expectedCommissionAmount : 0;
  const gross =
    input.schedule.scheduleStatus === "CUSTOMER_EXCLUDED"
      ? roundMoney(
          input.schedule.grossScheduledCommissionAmount ??
            (scheduled > 0 ? scheduled : release.expectedCommissionAmount)
        )
      : release.expectedCommissionAmount;

  return {
    receivableId: input.receivable.nomusReceivableId,
    receivableCode:
      input.receivable.receivableNumber ?? input.schedule.receivableCode,
    settlementDate: input.receivable.settlementDate?.toISOString() ?? null,
    dueDate: input.receivable.dueDate?.toISOString() ?? null,
    amountReceivable: roundMoney(
      input.schedule.receivableNominalAmount || input.receivable.amountReceivable
    ),
    amountReceived: roundMoney(input.receivable.amountReceived),
    receivedSharePercent: release.receivedSharePercent,
    releasedCommissionAmount: released,
    pendingCommissionAmount: roundMoney(Math.max(0, scheduled - released)),
    grossCommissionAmount: gross,
    commissionableBaseAmount: release.commissionableBaseAmount,
    status,
    statusReason: reason,
  };
}

export function computeCommissionTraceTotals(input: {
  items: CommissionTraceItem[];
  receipts: CommissionTraceReceipt[];
}): CommissionTraceAuditReport["totals"] {
  const totalGrossCommission = roundMoney(
    input.items.reduce((sum, row) => sum + row.grossCommissionAmount, 0)
  );
  const totalFinalCommission = roundMoney(
    input.items.reduce((sum, row) => sum + row.finalCommissionAmount, 0)
  );
  const totalExcludedCommission = roundMoney(totalGrossCommission - totalFinalCommission);
  const totalReceived = roundMoney(
    input.receipts.reduce((sum, row) => sum + row.amountReceived, 0)
  );
  const totalCommissionableBase = roundMoney(
    input.receipts.reduce((sum, row) => sum + row.commissionableBaseAmount, 0)
  );
  const totalReleasedCommission = roundMoney(
    input.receipts.reduce((sum, row) => sum + row.releasedCommissionAmount, 0)
  );
  const totalPendingCommission = roundMoney(
    input.receipts.reduce((sum, row) => sum + row.pendingCommissionAmount, 0)
  );

  return {
    totalReceived,
    totalCommissionableBase,
    totalGrossCommission,
    totalExcludedCommission,
    totalFinalCommission,
    totalReleasedCommission,
    totalPendingCommission,
  };
}

export function buildCommissionTraceNomusAudit(input: {
  nomusBase: number | null;
  nomusCommission: number | null;
  indusReleasedCommission: number;
  indusCommissionableBase: number;
}): CommissionTraceNomusAudit | null {
  if (input.nomusBase == null && input.nomusCommission == null) return null;
  const baseDifference =
    input.nomusBase != null
      ? roundMoney(input.indusCommissionableBase - input.nomusBase)
      : null;
  const commissionDifference =
    input.nomusCommission != null
      ? roundMoney(input.indusReleasedCommission - input.nomusCommission)
      : null;
  const parts: string[] = [];
  if (baseDifference != null && Math.abs(baseDifference) > 0.01) {
    parts.push(`Base IndusCost ${input.indusCommissionableBase} vs Nomus ${input.nomusBase} (Δ ${baseDifference})`);
  }
  if (commissionDifference != null && Math.abs(commissionDifference) > 0.01) {
    parts.push(
      `Comissão liberada IndusCost ${input.indusReleasedCommission} vs Nomus ${input.nomusCommission} (Δ ${commissionDifference})`
    );
  }
  return {
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
    indusReleasedCommission: input.indusReleasedCommission,
    indusCommissionableBase: input.indusCommissionableBase,
    baseDifference,
    commissionDifference,
    explanation: parts.length > 0 ? parts.join("; ") : "Sem diferença material vs referência Nomus informada.",
  };
}

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}

export function buildCommissionTraceCsv(report: CommissionTraceAuditReport): string {
  const lines: string[] = [];
  lines.push(csvLine(["section", "field", "value"]));
  lines.push(csvLine(["meta", "status", report.status]));

  if (report.sale) {
    for (const [key, value] of Object.entries(report.sale)) {
      lines.push(csvLine(["sale", key, Array.isArray(value) ? value.join("|") : value]));
    }
  }

  for (const item of report.items) {
    lines.push(
      csvLine([
        "item",
        item.sku,
        item.productName,
        item.soldAmount,
        item.marginPercent,
        item.commissionRatePercent,
        item.finalCommissionAmount,
        item.status,
      ])
    );
  }

  for (const receivable of report.receivables) {
    lines.push(
      csvLine([
        "receivable",
        receivable.receivableCode,
        receivable.nominalAmount,
        receivable.sharePercent,
        receivable.scheduledCommissionAmount,
        receivable.scheduleStatus,
      ])
    );
  }

  for (const receipt of report.receipts) {
    lines.push(
      csvLine([
        "receipt",
        receipt.receivableCode,
        receipt.settlementDate,
        receipt.amountReceived,
        receipt.releasedCommissionAmount,
        receipt.pendingCommissionAmount,
        receipt.status,
      ])
    );
  }

  for (const [key, value] of Object.entries(report.totals)) {
    lines.push(csvLine(["totals", key, value]));
  }

  for (const alert of report.alerts) {
    lines.push(csvLine(["alert", alert.code, alert.severity, alert.message]));
  }

  return `${lines.join("\n")}\n`;
}

export function formatCommissionTraceText(report: CommissionTraceAuditReport): string {
  const out: string[] = [];
  out.push("=== Auditoria — Rastreabilidade de comissão ===\n");
  out.push(`Status: ${report.status}`);

  if (report.errorMessage) {
    out.push(`Erro: ${report.errorMessage}`);
    return out.join("\n");
  }

  if (report.sale) {
    out.push(`\n--- Venda ---`);
    out.push(`Pedido: ${report.sale.orderNumber} (${report.sale.salesOrderId})`);
    out.push(`NF: ${report.sale.nfeNumbers.join(", ") || "—"}`);
    out.push(`Cliente: ${report.sale.customerName}`);
    out.push(
      `Vendedor: ${report.sale.rawSellerName ?? report.sale.rawSellerId ?? "—"} → ${report.sale.canonicalSellerName ?? "—"}`
    );
  }

  if (report.orderSnapshot.snapshotId) {
    out.push(`\n--- Snapshot materializado ---`);
    out.push(`ID: ${report.orderSnapshot.snapshotId}`);
    out.push(`Comissão bruta: ${report.orderSnapshot.totalGrossCommissionAmount}`);
    out.push(`Comissão final: ${report.orderSnapshot.totalFinalCommissionAmount}`);
  }

  if (report.items.length > 0) {
    out.push(`\n--- Itens (${report.items.length}) ---`);
    for (const item of report.items) {
      out.push(
        `  ${item.sku ?? "—"} | vendido=${item.soldAmount} | margem=${item.marginPercent ?? "—"}% | taxa=${item.commissionRatePercent}% | comissão=${item.finalCommissionAmount} [${item.status}]`
      );
    }
  }

  if (report.receivables.length > 0) {
    out.push(`\n--- Títulos ---`);
    for (const row of report.receivables) {
      out.push(
        `  ${row.receivableCode ?? row.receivableId ?? "—"} | nominal=${row.nominalAmount} | programada=${row.scheduledCommissionAmount} | ${row.scheduleStatus}`
      );
    }
  }

  if (report.receipts.length > 0) {
    out.push(`\n--- Recebimentos ---`);
    for (const row of report.receipts) {
      out.push(
        `  ${row.receivableCode ?? row.receivableId} | baixa=${row.settlementDate ?? "—"} | recebido=${row.amountReceived} | liberada=${row.releasedCommissionAmount} | pendente=${row.pendingCommissionAmount} | ${row.status}`
      );
    }
  }

  out.push(`\n--- Totais ---`);
  out.push(`Recebido: ${report.totals.totalReceived}`);
  out.push(`Base comissionável: ${report.totals.totalCommissionableBase}`);
  out.push(`Comissão bruta: ${report.totals.totalGrossCommission}`);
  out.push(`Comissão excluída: ${report.totals.totalExcludedCommission}`);
  out.push(`Comissão final: ${report.totals.totalFinalCommission}`);
  out.push(`Comissão liberada: ${report.totals.totalReleasedCommission}`);

  if (report.closing) {
    out.push(`\n--- Fechamento ${report.closing.year}-${String(report.closing.month).padStart(2, "0")} ---`);
    out.push(`Status: ${report.closing.status} | imutável: ${report.closing.isImmutable ? "sim" : "não"}`);
  }

  if (report.nomusAudit) {
    out.push(`\n--- Auditoria Nomus ---`);
    out.push(report.nomusAudit.explanation ?? "—");
  }

  if (report.alerts.length > 0) {
    out.push(`\n--- Alertas ---`);
    for (const alert of report.alerts) {
      out.push(`  [${alert.severity}] ${alert.code}: ${alert.message}`);
    }
  }

  return out.join("\n");
}
