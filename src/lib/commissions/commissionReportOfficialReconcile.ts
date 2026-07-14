/**
 * Reconciliação Relatório de Comissões × snapshot/schedule oficial (Auditoria 360º).
 * Lógica pura — segura para frontend e scripts.
 *
 * Precedência: ledger liberado > schedule > order snapshot > legado.
 * Comissão paga NÃO é alterada aqui (apenas classificação/exibição da listagem).
 */

import { roundMoney } from "./commission-money.shared.js";

export const COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT =
  "A comissão oficial do snapshot do pedido diverge da classificação da tela. Usando snapshot oficial.";

export const COMMISSION_SOURCE_MISMATCH_STATUS = "COMMISSION_SOURCE_MISMATCH" as const;

export type OfficialCommissionSnapshotRef = {
  salesOrderId: string;
  orderCode: string | null;
  totalFinalCommissionAmount: number;
  totalSoldAmount: number;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  /** Soma dos schedules ACTIVE ligados ao snapshot. */
  scheduledCommissionSum: number;
  /** Status dos itens (diagnóstico). */
  itemStatuses: string[];
};

export type ReportLineOfficialFields = {
  status: string;
  statusReason: string | null;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  grossCommissionAmount: number;
  commissionableBaseAmount: number;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  source: string;
  scheduledCommissionAmount?: number | null;
};

function round2(n: number): number {
  return roundMoney(n ?? 0);
}

/** Mesma regra do relatório: o que a UI mostra como “comissão final”. */
export function lineFinalCommissionForDiagnosis(line: {
  status: string;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  grossCommissionAmount?: number;
}): number {
  if (line.status === "COMMISSIONABLE") return round2(line.releasedCommissionAmount);
  if (line.status === COMMISSION_SOURCE_MISMATCH_STATUS) {
    return round2(
      line.expectedCommissionAmount > 0
        ? line.expectedCommissionAmount
        : (line.grossCommissionAmount ?? 0)
    );
  }
  return 0;
}

export function officialSnapshotHasCommission(
  snap: Pick<OfficialCommissionSnapshotRef, "totalFinalCommissionAmount" | "scheduledCommissionSum">
): boolean {
  return (
    round2(snap.totalFinalCommissionAmount) > 0 || round2(snap.scheduledCommissionSum) > 0
  );
}

export function reportLineMisclassifiedAgainstSnapshot(
  line: Pick<ReportLineOfficialFields, "status" | "expectedCommissionAmount" | "releasedCommissionAmount">,
  snap: Pick<OfficialCommissionSnapshotRef, "totalFinalCommissionAmount" | "scheduledCommissionSum">
): boolean {
  if (!officialSnapshotHasCommission(snap)) return false;
  // Exclusões oficiais permanecem zeradas — não forçar snapshot.
  if (
    line.status === "CUSTOMER_EXCLUDED" ||
    line.status === "GROUP_COMPANY_EXCLUDED"
  ) {
    return false;
  }
  const displayed = lineFinalCommissionForDiagnosis({
    status: line.status,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    grossCommissionAmount: line.expectedCommissionAmount,
  });
  if (displayed > 0.009) return false;
  return (
    line.status === "NO_MARGIN" ||
    line.status === "ZERO_AMOUNT" ||
    line.status === "NO_RULE" ||
    line.status === "NO_SCHEDULE" ||
    line.status === "STALE_SCHEDULE" ||
    (line.status === "COMMISSIONABLE" &&
      round2(line.expectedCommissionAmount) <= 0.009 &&
      round2(line.releasedCommissionAmount) <= 0.009)
  );
}

/**
 * Ajusta linha do relatório para respeitar snapshot/schedule oficial.
 * Não aumenta released acima do schedule/snapshot (não libera pagamento indevido).
 */
export function reconcileReportLineWithOfficialSnapshot(
  line: ReportLineOfficialFields,
  snap: OfficialCommissionSnapshotRef | null | undefined
): ReportLineOfficialFields {
  if (!snap || !officialSnapshotHasCommission(snap)) return line;

  const officialAmount = round2(
    snap.scheduledCommissionSum > 0
      ? snap.scheduledCommissionSum
      : snap.totalFinalCommissionAmount
  );
  const officialBase = round2(snap.totalSoldAmount);

  if (!reportLineMisclassifiedAgainstSnapshot(line, snap)) {
    // Mesmo alinhado, preferir vendedor canônico do snapshot se a linha está vazia.
    if (!line.canonicalSellerId && snap.canonicalSellerId) {
      return {
        ...line,
        canonicalSellerId: snap.canonicalSellerId,
        canonicalSellerName: snap.canonicalSellerName,
        rawSellerId: line.rawSellerId ?? snap.rawSellerId,
        rawSellerName: line.rawSellerName ?? snap.rawSellerName,
      };
    }
    return line;
  }

  const wasReleased = line.status === "COMMISSIONABLE" && line.releasedCommissionAmount > 0.009;

  return {
    ...line,
    status: wasReleased ? "COMMISSIONABLE" : COMMISSION_SOURCE_MISMATCH_STATUS,
    statusReason: wasReleased
      ? line.statusReason
      : COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT,
    expectedCommissionAmount: Math.max(round2(line.expectedCommissionAmount), officialAmount),
    grossCommissionAmount: Math.max(round2(line.grossCommissionAmount), officialAmount),
    // Não inventar liberação: mismatch mostra prevista; COMMISSIONABLE mantém released.
    releasedCommissionAmount: wasReleased
      ? round2(line.releasedCommissionAmount)
      : round2(line.releasedCommissionAmount),
    commissionableBaseAmount: Math.max(round2(line.commissionableBaseAmount), officialBase),
    canonicalSellerId: line.canonicalSellerId ?? snap.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName ?? snap.canonicalSellerName,
    rawSellerId: line.rawSellerId ?? snap.rawSellerId,
    rawSellerName: line.rawSellerName ?? snap.rawSellerName,
    source:
      snap.scheduledCommissionSum > 0
        ? "RECEIVABLE_SCHEDULE"
        : "ORDER_SNAPSHOT",
    scheduledCommissionAmount:
      line.scheduledCommissionAmount != null && line.scheduledCommissionAmount > 0
        ? line.scheduledCommissionAmount
        : officialAmount,
  };
}

export type CommissionReportDivergenceClass =
  | "MATCH"
  | "REPORT_ZERO_SNAPSHOT_HAS_COMMISSION"
  | "REPORT_IGNORES_ORDER_SNAPSHOT"
  | "REPORT_USES_LEGACY_MARGIN"
  | "REPORT_USES_RECEIPT_ONLY"
  | "SELLER_MAPPING_MISMATCH"
  | "NO_MARGIN_MISCLASSIFIED"
  | "PERIOD_AXIS_MISMATCH"
  | "RECEIVABLE_SCHEDULE_NOT_JOINED"
  | "UNKNOWN";

export function classifyReportVsSnapshotDivergence(input: {
  snapCommission: number;
  reportDisplayedCommission: number;
  reportStatus: string | null;
  scheduleSum: number;
}): CommissionReportDivergenceClass {
  const snap = round2(input.snapCommission);
  const report = round2(input.reportDisplayedCommission);
  if (snap > 0 && report <= 0) {
    if (input.reportStatus === "NO_MARGIN" || input.reportStatus === "ZERO_AMOUNT") {
      return "NO_MARGIN_MISCLASSIFIED";
    }
    if (input.scheduleSum > 0) return "REPORT_IGNORES_ORDER_SNAPSHOT";
    return "REPORT_ZERO_SNAPSHOT_HAS_COMMISSION";
  }
  if (Math.abs(snap - report) <= 0.02) return "MATCH";
  return "UNKNOWN";
}
