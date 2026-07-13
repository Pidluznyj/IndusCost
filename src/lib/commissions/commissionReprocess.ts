/**
 * Reprocessamento idempotente de comissões (lógica pura).
 * Motor oficial: materializeCommissionForSalesOrder + rebuildCommissionReceivableSchedule.
 * Não usa Proposal como fonte; vendedor = Pedido de Venda Nomus.
 * Browser-safe: sem node:crypto (painel UI importa este módulo).
 */

export const COMMISSION_REPROCESS_LOCK_KEY = "commission.reprocess.lock" as const;
export const COMMISSION_REPROCESS_PREVIEW_KIND = "COMMISSION_REPROCESS_PREVIEW" as const;
export const COMMISSION_REPROCESS_APPLY_KIND = "COMMISSION_REPROCESS_APPLY" as const;
export const COMMISSION_REPROCESS_ENGINE =
  "materializeCommissionForSalesOrder+rebuildCommissionReceivableSchedule" as const;

/** Ciclo de vida operacional na UI (mapeado a partir do snapshot/fechamento). */
export type CommissionReprocessLifecycle =
  | "forecast"
  | "confirmed"
  | "released"
  | "paid";

export type CommissionReprocessDateAxis = "issue" | "nfe" | "settlement";

export type CommissionReprocessFilters = {
  from: string | null;
  to: string | null;
  dateAxis: CommissionReprocessDateAxis;
  customerExternalId: number | null;
  sellerExternalId: number | null;
  salesOrderCode: string | null;
  productCode: string | null;
  priceTableId: string | null;
  statuses: CommissionReprocessLifecycle[];
  includeConfirmedNotPaid: boolean;
  includeReleasedNotPaid: boolean;
  includePaid: boolean;
};

export type CommissionReprocessBlockReason =
  | "PAID_CLOSED_LEDGER"
  | "PAID_RECORD"
  | "RELEASED_FLAG_OFF"
  | "CONFIRMED_FLAG_OFF"
  | "NO_CHANGE"
  | "ERROR";

export type CommissionReprocessDiffRow = {
  salesOrderId: string;
  orderCode: string | null;
  customerName: string | null;
  customerExternalId: number | null;
  sellerName: string | null;
  sellerExternalId: number | null;
  lifecycle: CommissionReprocessLifecycle;
  currentAmount: number;
  recalculatedAmount: number;
  difference: number;
  changed: boolean;
  blocked: boolean;
  blockReason: CommissionReprocessBlockReason | null;
  blockMessage: string | null;
  action: "recalculate" | "blocked" | "unchanged" | "error";
  snapshotAction: string | null;
  error: string | null;
};

export type CommissionReprocessSummary = {
  analyzedCount: number;
  changedCount: number;
  blockedCount: number;
  errorCount: number;
  currentTotal: number;
  recalculatedTotal: number;
  differenceTotal: number;
};

export type CommissionReprocessPreviewResult = {
  mode: "preview";
  engine: typeof COMMISSION_REPROCESS_ENGINE;
  filters: CommissionReprocessFilters;
  filtersHash: string;
  summary: CommissionReprocessSummary;
  affectedBySeller: Array<{
    sellerName: string | null;
    sellerExternalId: number | null;
    count: number;
    difference: number;
  }>;
  affectedByCustomer: Array<{
    customerName: string | null;
    customerExternalId: number | null;
    count: number;
    difference: number;
  }>;
  affectedOrders: Array<{ salesOrderId: string; orderCode: string | null; difference: number }>;
  blockedRows: CommissionReprocessDiffRow[];
  changedRows: CommissionReprocessDiffRow[];
  errors: Array<{ salesOrderId: string; message: string }>;
  runToken: string;
  auditId: string | null;
};

export type CommissionReprocessApplyResult = {
  mode: "apply";
  engine: typeof COMMISSION_REPROCESS_ENGINE;
  runId: string;
  filters: CommissionReprocessFilters;
  filtersHash: string;
  summary: CommissionReprocessSummary;
  affectedRows: CommissionReprocessDiffRow[];
  blockedRows: CommissionReprocessDiffRow[];
  errors: Array<{ salesOrderId: string; message: string }>;
  auditId: string;
};

export function roundCommissionMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildCommissionReprocessDiff(before: number, after: number): number {
  return roundCommissionMoney(after - before);
}

/** Hash estável FNV-1a 128-bit (hex 32 chars) — browser + Node, sem node:crypto. */
function stableFnv1a128Hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  let h3 = 0x811c9dc5 ^ 0x85ebca6b;
  let h4 = 0x811c9dc5 ^ 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
    h3 ^= c + i;
    h3 = Math.imul(h3, 0x01000193);
    h4 ^= c ^ (i << 1);
    h4 = Math.imul(h4, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h3 >>> 0).toString(16).padStart(8, "0") +
    (h4 >>> 0).toString(16).padStart(8, "0")
  );
}

export function hashCommissionReprocessFilters(filters: CommissionReprocessFilters): string {
  const payload = JSON.stringify({
    from: filters.from,
    to: filters.to,
    dateAxis: filters.dateAxis,
    customerExternalId: filters.customerExternalId,
    sellerExternalId: filters.sellerExternalId,
    salesOrderCode: filters.salesOrderCode?.trim().toUpperCase() ?? null,
    productCode: filters.productCode?.trim().toUpperCase() ?? null,
    priceTableId: filters.priceTableId,
    statuses: [...filters.statuses].sort(),
    includeConfirmedNotPaid: filters.includeConfirmedNotPaid,
    includeReleasedNotPaid: filters.includeReleasedNotPaid,
    includePaid: filters.includePaid,
  });
  return stableFnv1a128Hex(payload);
}

export function classifyCommissionReprocessLifecycle(input: {
  hasNfe: boolean;
  hasSettledReceivable: boolean;
  inClosedLedger: boolean;
  paidRecord: boolean;
}): CommissionReprocessLifecycle {
  if (input.inClosedLedger || input.paidRecord) return "paid";
  if (input.hasSettledReceivable) return "released";
  if (input.hasNfe) return "confirmed";
  return "forecast";
}

export function resolveReprocessRowDecision(input: {
  lifecycle: CommissionReprocessLifecycle;
  difference: number;
  includeConfirmedNotPaid: boolean;
  includeReleasedNotPaid: boolean;
  includePaid: boolean;
  error?: string | null;
}): {
  blocked: boolean;
  blockReason: CommissionReprocessBlockReason | null;
  blockMessage: string | null;
  action: CommissionReprocessDiffRow["action"];
  changed: boolean;
} {
  if (input.error) {
    return {
      blocked: true,
      blockReason: "ERROR",
      blockMessage: input.error,
      action: "error",
      changed: false,
    };
  }

  const absDiff = Math.abs(input.difference);
  const wouldChange = absDiff >= 0.005;

  if (input.lifecycle === "paid") {
    return {
      blocked: true,
      blockReason: "PAID_CLOSED_LEDGER",
      blockMessage: input.includePaid
        ? "Comissão já paga/fechada: listada por includePaid, sem alteração automática."
        : "Bloqueada por já paga/fechada no ledger oficial.",
      action: "blocked",
      changed: false,
    };
  }

  if (input.lifecycle === "released" && !input.includeReleasedNotPaid) {
    return {
      blocked: true,
      blockReason: "RELEASED_FLAG_OFF",
      blockMessage:
        "Liberada para pagamento — marque 'incluir liberadas não pagas' para recalcular.",
      action: "blocked",
      changed: false,
    };
  }

  if (input.lifecycle === "confirmed" && !input.includeConfirmedNotPaid) {
    return {
      blocked: true,
      blockReason: "CONFIRMED_FLAG_OFF",
      blockMessage:
        "Confirmada não paga — marque 'incluir confirmadas não pagas' para recalcular.",
      action: "blocked",
      changed: false,
    };
  }

  if (!wouldChange) {
    return {
      blocked: false,
      blockReason: "NO_CHANGE",
      blockMessage: null,
      action: "unchanged",
      changed: false,
    };
  }

  return {
    blocked: false,
    blockReason: null,
    blockMessage: null,
    action: "recalculate",
    changed: true,
  };
}

export function aggregateCommissionReprocessSummary(
  rows: CommissionReprocessDiffRow[]
): CommissionReprocessSummary {
  let currentTotal = 0;
  let recalculatedTotal = 0;
  let changedCount = 0;
  let blockedCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    currentTotal += row.currentAmount;
    recalculatedTotal += row.recalculatedAmount;
    if (row.changed) changedCount += 1;
    if (row.blocked) blockedCount += 1;
    if (row.action === "error") errorCount += 1;
  }

  return {
    analyzedCount: rows.length,
    changedCount,
    blockedCount,
    errorCount,
    currentTotal: roundCommissionMoney(currentTotal),
    recalculatedTotal: roundCommissionMoney(recalculatedTotal),
    differenceTotal: buildCommissionReprocessDiff(currentTotal, recalculatedTotal),
  };
}

export function groupReprocessAffected(
  rows: CommissionReprocessDiffRow[]
): Pick<
  CommissionReprocessPreviewResult,
  "affectedBySeller" | "affectedByCustomer" | "affectedOrders"
> {
  const relevant = rows.filter((r) => r.changed || r.blocked);
  const bySeller = new Map<
    string,
    { sellerName: string | null; sellerExternalId: number | null; count: number; difference: number }
  >();
  const byCustomer = new Map<
    string,
    {
      customerName: string | null;
      customerExternalId: number | null;
      count: number;
      difference: number;
    }
  >();

  for (const row of relevant) {
    const sk = `${row.sellerExternalId ?? "null"}|${row.sellerName ?? ""}`;
    const seller = bySeller.get(sk) ?? {
      sellerName: row.sellerName,
      sellerExternalId: row.sellerExternalId,
      count: 0,
      difference: 0,
    };
    seller.count += 1;
    seller.difference = roundCommissionMoney(seller.difference + row.difference);
    bySeller.set(sk, seller);

    const ck = `${row.customerExternalId ?? "null"}|${row.customerName ?? ""}`;
    const customer = byCustomer.get(ck) ?? {
      customerName: row.customerName,
      customerExternalId: row.customerExternalId,
      count: 0,
      difference: 0,
    };
    customer.count += 1;
    customer.difference = roundCommissionMoney(customer.difference + row.difference);
    byCustomer.set(ck, customer);
  }

  return {
    affectedBySeller: [...bySeller.values()].sort((a, b) => b.count - a.count),
    affectedByCustomer: [...byCustomer.values()].sort((a, b) => b.count - a.count),
    affectedOrders: relevant.map((r) => ({
      salesOrderId: r.salesOrderId,
      orderCode: r.orderCode,
      difference: r.difference,
    })),
  };
}

export function assertCanReprocessCommission(user: {
  role: string;
  permissions?: string[];
}): { ok: true } | { ok: false; status: 403; message: string } {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    message: "Apenas SUPER_ADMIN ou ADMIN podem reprocessar comissões.",
  };
}

export function assertCanPreviewCommissionReprocess(user: {
  role: string;
  permissions?: string[];
  hasAnyPermission?: (perms: string[]) => boolean;
}): { ok: true } | { ok: false; status: 403; message: string } {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return { ok: true };
  const perms = user.permissions ?? [];
  const allowed = [
    "commissions.view",
    "commissions.payments.manage",
    "commissions.rules.manage",
    "commissions.audit.view",
  ];
  if (user.hasAnyPermission?.(allowed) || allowed.some((p) => perms.includes(p))) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    message: "Sem permissão para gerar prévia de reprocessamento de comissões.",
  };
}

export function defaultCommissionReprocessFilters(
  partial?: Partial<CommissionReprocessFilters>
): CommissionReprocessFilters {
  return {
    from: partial?.from ?? null,
    to: partial?.to ?? null,
    dateAxis: partial?.dateAxis ?? "issue",
    customerExternalId: partial?.customerExternalId ?? null,
    sellerExternalId: partial?.sellerExternalId ?? null,
    salesOrderCode: partial?.salesOrderCode ?? null,
    productCode: partial?.productCode ?? null,
    priceTableId: partial?.priceTableId ?? null,
    statuses: partial?.statuses ?? ["forecast", "confirmed", "released", "paid"],
    includeConfirmedNotPaid: partial?.includeConfirmedNotPaid ?? true,
    includeReleasedNotPaid: partial?.includeReleasedNotPaid ?? false,
    includePaid: partial?.includePaid ?? false,
  };
}

export function buildCommissionReprocessCsv(rows: CommissionReprocessDiffRow[]): string {
  const header = [
    "pedido",
    "cliente",
    "vendedor",
    "status",
    "comissao_atual",
    "comissao_recalculada",
    "diferenca",
    "acao",
    "bloqueio",
    "motivo",
  ].join(";");
  const lines = rows.map((r) =>
    [
      r.orderCode ?? r.salesOrderId,
      r.customerName ?? "",
      r.sellerName ?? "",
      r.lifecycle,
      r.currentAmount.toFixed(2),
      r.recalculatedAmount.toFixed(2),
      r.difference.toFixed(2),
      r.action,
      r.blocked ? "sim" : "nao",
      (r.blockMessage ?? r.error ?? "").replace(/;/g, ","),
    ].join(";")
  );
  return [header, ...lines].join("\n");
}
