/**
 * Auditoria visual oficial — mesmo universo do Fechamento do mês (settlementDate).
 */
import { roundMoney } from "./commission-money.js";
import type { VisualAuditCards } from "./commissionVisualAudit.js";
import type {
  ReceiptClosingApiLine,
  ReceiptClosingMaterializationCards,
  ReceiptClosingMaterializationSummary,
  ReceiptClosingPagePayload,
  ReceiptClosingReconciliationSummary,
} from "./commissionReceiptClosingApi.shared.js";
import { isReceiptClosingDivergentLineStatus } from "./commissionReceiptClosingApi.js";

export const COMMISSION_VISUAL_AUDIT_CLOSING_SCOPE_NOTE =
  "Auditoria do fechamento por recebimento (settlementDate). Mesmo universo de títulos baixados da aba Fechamento do mês.";

export const COMMISSION_VISUAL_AUDIT_CLOSING_RECONCILIATION_NOTE =
  "Esta aba audita o fechamento por recebimento. Regras de vendedor Nomus, cliente excluído, empresa do grupo e schedules materializados são idênticas ao Fechamento do mês.";

export const VISUAL_AUDIT_OFFICIAL_CATEGORY_LABELS: Record<VisualAuditOfficialCategory, string> = {
  COMMISSIONABLE: "OK / com schedule",
  CUSTOMER_EXCLUDED: "Cliente excluído",
  GROUP_COMPANY_EXCLUDED: "Empresa do grupo excluída",
  SELLER_UNRESOLVED: "Vendedor não resolvido",
  NO_SELLER: "Sem vendedor Nomus",
  NO_SCHEDULE: "Sem schedule",
  STALE_SCHEDULE: "Schedule desatualizado",
  NO_SALES_LINK: "Sem pedido vinculado",
  DIVERGENT: "Título divergente",
  OTHER: "Outros",
};

export type VisualAuditOfficialCategory =
  | "COMMISSIONABLE"
  | "CUSTOMER_EXCLUDED"
  | "GROUP_COMPANY_EXCLUDED"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER"
  | "NO_SCHEDULE"
  | "STALE_SCHEDULE"
  | "NO_SALES_LINK"
  | "DIVERGENT"
  | "OTHER";

const DIVERGENT_LINE_STATUSES = new Set([
  "NO_SALES_LINK",
  "NO_SCHEDULE",
  "NO_SELLER",
  "SELLER_UNRESOLVED",
  "NO_RULE",
  "NO_MARGIN",
  "STALE_SCHEDULE",
  "ERROR",
  "ZERO_AMOUNT",
]);

export type VisualAuditClosingRow = {
  lineId: string;
  recordId: string;
  scheduleId: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  confirmedAt: string | null;
  documentBaseAmount: number;
  documentCommissionTotal: number;
  nomusReceivableId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  dueDate: string | null;
  settlementDate: string | null;
  receivableAmount: number;
  receivedAmount: number;
  openBalance: number;
  financialSharePercent: number | null;
  allocatedBaseAmount: number;
  commissionExpected: number;
  commissionReleased: number;
  commissionPending: number;
  receivableTitleStatus: string;
  commissionStatus: string;
  alertLabels: string[];
  auditCategory: VisualAuditOfficialCategory;
  auditCategoryLabel: string;
  lineStatus: string;
  statusReason: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  productCode: string | null;
  commissionableBaseAmount: number;
  ratePercent: number;
  grossCommissionAmount: number;
  exclusionReason: string | null;
  isCriticalDivergence: boolean;
};

export type VisualAuditClosingFilters = {
  commissionPersonId?: string | null;
  customer?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  auditCategory?: VisualAuditOfficialCategory | null;
  onlyDivergences?: boolean;
};

export function resolveVisualAuditOfficialCategory(
  line: ReceiptClosingApiLine
): VisualAuditOfficialCategory {
  if (line.status === "GROUP_COMPANY_EXCLUDED") return "GROUP_COMPANY_EXCLUDED";
  if (line.status === "CUSTOMER_EXCLUDED") return "CUSTOMER_EXCLUDED";
  if (line.status === "SELLER_UNRESOLVED") return "SELLER_UNRESOLVED";
  if (line.status === "NO_SELLER") return "NO_SELLER";
  if (line.status === "NO_SCHEDULE") return "NO_SCHEDULE";
  if (line.status === "STALE_SCHEDULE") return "STALE_SCHEDULE";
  if (line.status === "NO_SALES_LINK") return "NO_SALES_LINK";
  if (line.status === "COMMISSIONABLE") return "COMMISSIONABLE";
  if (DIVERGENT_LINE_STATUSES.has(line.status)) return "DIVERGENT";
  return "OTHER";
}

function resolveCommissionStatusFromClosingLine(line: ReceiptClosingApiLine): string {
  if (line.status === "CUSTOMER_EXCLUDED" || line.status === "GROUP_COMPANY_EXCLUDED") {
    return "SEM_COMISSAO";
  }
  if (DIVERGENT_LINE_STATUSES.has(line.status)) return "DIVERGENTE";
  if (line.releasedCommissionAmount >= line.expectedCommissionAmount && line.expectedCommissionAmount > 0) {
    return "LIBERADA";
  }
  if (line.releasedCommissionAmount > 0) return "PARCIALMENTE_LIBERADA";
  if (line.expectedCommissionAmount <= 0) return "SEM_COMISSAO";
  return "AGUARDANDO_RECEBIMENTO";
}

function buildAlertLabels(line: ReceiptClosingApiLine, category: VisualAuditOfficialCategory): string[] {
  const labels: string[] = [];
  if (line.statusReason?.trim()) labels.push(line.statusReason.trim());
  if (line.exclusionReason?.trim() && !labels.includes(line.exclusionReason.trim())) {
    labels.push(line.exclusionReason.trim());
  }
  if (category !== "COMMISSIONABLE" && category !== "OTHER") {
    const catLabel = VISUAL_AUDIT_OFFICIAL_CATEGORY_LABELS[category];
    if (!labels.includes(catLabel)) labels.push(catLabel);
  }
  if (
    line.expectedCommissionAmount > 0 &&
    Math.abs(line.releasedCommissionAmount - line.expectedCommissionAmount) > 0.01
  ) {
    labels.push(
      `Diferença prevista vs liberada: R$ ${line.expectedCommissionAmount.toFixed(2)} → R$ ${line.releasedCommissionAmount.toFixed(2)}`
    );
  }
  return labels;
}

export function mapReceiptClosingLineToVisualAuditRow(
  line: ReceiptClosingApiLine
): VisualAuditClosingRow {
  const auditCategory = resolveVisualAuditOfficialCategory(line);
  const commissionStatus = resolveCommissionStatusFromClosingLine(line);
  const commissionPending = roundMoney(
    Math.max(0, line.expectedCommissionAmount - line.releasedCommissionAmount)
  );
  const sellerName =
    line.canonicalSellerName ?? line.rawSellerName ?? "Vendedor não resolvido";
  const sellerId = line.canonicalSellerId ?? line.rawSellerId?.toString() ?? "—";

  return {
    lineId: line.lineKey,
    recordId: line.lineKey,
    scheduleId: line.commissionReceivableScheduleId,
    commissionPersonId: sellerId,
    commissionPersonName: sellerName,
    customerName: line.customerName,
    orderCode: line.orderCode,
    nfeNumber: line.nfeNumber,
    confirmedAt: line.dueDate,
    documentBaseAmount: line.commissionableBaseAmount,
    documentCommissionTotal: line.grossCommissionAmount,
    nomusReceivableId: line.nomusReceivableId,
    receivableNumber: line.receivableNumber,
    installmentNumber: line.installmentNumber,
    dueDate: line.dueDate,
    settlementDate: line.settlementDate,
    receivableAmount: line.uniqueReceivedAmount,
    receivedAmount: line.uniqueReceivedAmount,
    openBalance: 0,
    financialSharePercent: null,
    allocatedBaseAmount: line.commissionableBaseAmount,
    commissionExpected: line.expectedCommissionAmount,
    commissionReleased: line.releasedCommissionAmount,
    commissionPending,
    receivableTitleStatus: line.settlementDate ? "BAIXADO" : "EM_ABERTO",
    commissionStatus,
    alertLabels: buildAlertLabels(line, auditCategory),
    auditCategory,
    auditCategoryLabel: VISUAL_AUDIT_OFFICIAL_CATEGORY_LABELS[auditCategory],
    lineStatus: line.status,
    statusReason: line.statusReason,
    rawSellerId: line.rawSellerId,
    rawSellerName: line.rawSellerName,
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
    sellerResolutionStatus: line.sellerResolutionStatus,
    productCode: line.productCode,
    commissionableBaseAmount: line.commissionableBaseAmount,
    ratePercent: line.ratePercent,
    grossCommissionAmount: line.grossCommissionAmount,
    exclusionReason: line.exclusionReason,
    isCriticalDivergence: isReceiptClosingDivergentLineStatus(line.status),
  };
}

export function buildVisualAuditClosingRows(
  closingPage: ReceiptClosingPagePayload
): VisualAuditClosingRow[] {
  const managerial = closingPage.lines.map(mapReceiptClosingLineToVisualAuditRow);
  const group = closingPage.groupCompanyAuditLines.map(mapReceiptClosingLineToVisualAuditRow);
  return [...managerial, ...group];
}

export function filterVisualAuditClosingRows(
  rows: VisualAuditClosingRow[],
  filters: VisualAuditClosingFilters
): VisualAuditClosingRow[] {
  let filtered = rows;

  if (filters.commissionPersonId?.trim()) {
    const id = filters.commissionPersonId.trim();
    filtered = filtered.filter(
      (row) => row.canonicalSellerId === id || row.commissionPersonId === id
    );
  }
  if (filters.customer?.trim()) {
    const needle = filters.customer.trim().toLowerCase();
    filtered = filtered.filter((row) =>
      (row.customerName ?? "").toLowerCase().includes(needle)
    );
  }
  if (filters.orderCode?.trim()) {
    const needle = filters.orderCode.trim().toLowerCase();
    filtered = filtered.filter((row) =>
      (row.orderCode ?? "").toLowerCase().includes(needle)
    );
  }
  if (filters.nfeNumber?.trim()) {
    const needle = filters.nfeNumber.trim().toLowerCase();
    filtered = filtered.filter((row) =>
      (row.nfeNumber ?? "").toLowerCase().includes(needle)
    );
  }
  if (filters.nomusReceivableId != null) {
    filtered = filtered.filter((row) => row.nomusReceivableId === filters.nomusReceivableId);
  }
  if (filters.auditCategory) {
    if (filters.auditCategory === "DIVERGENT") {
      filtered = filtered.filter((row) => row.isCriticalDivergence);
    } else {
      filtered = filtered.filter((row) => row.auditCategory === filters.auditCategory);
    }
  }
  if (filters.onlyDivergences) {
    filtered = filtered.filter((row) => row.isCriticalDivergence);
  }

  return filtered;
}

export function mapClosingMaterializationToVisualAuditCards(
  summary: ReceiptClosingMaterializationSummary,
  cards: ReceiptClosingMaterializationCards,
  reconciliation: ReceiptClosingReconciliationSummary
): VisualAuditCards {
  const averageRatePercent =
    cards.commissionableBaseAmount > 0
      ? roundMoney((cards.finalCommissionAmount / cards.commissionableBaseAmount) * 100)
      : 0;

  return {
    appraisalMode: "PAYABLE",
    documentAmountTotal: 0,
    receivableAmountTotal: cards.totalReceivedAmount,
    receivedAmountTotal: cards.totalReceivedAmount,
    commissionableBaseTotal: cards.commissionableBaseAmount,
    commissionCalculatedTotal: cards.grossCommissionAmount,
    commissionExpectedTotal: cards.grossCommissionAmount,
    commissionReleasedTotal: cards.finalCommissionAmount,
    commissionPendingTotal: 0,
    commissionFutureTotal: 0,
    commissionBlockedTotal: 0,
    documentCount: 0,
    receivableCount: summary.totalReceivablesCount,
    scheduleCount: summary.receivablesWithScheduleCount,
    divergenceCount: reconciliation.divergentReceivableCount,
    averageRatePercent,
  };
}

export function buildVisualAuditClosingDetail(row: VisualAuditClosingRow): {
  explanation: string;
  record: {
    productCode: string | null;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
  } | null;
  documentTotals: { base: number; commission: number };
} {
  const parts: string[] = [];
  parts.push(
    `Título CR ${row.nomusReceivableId ?? "—"} (parcela ${row.installmentNumber ?? "—"}) — ${row.auditCategoryLabel}.`
  );
  if (row.statusReason) parts.push(row.statusReason);
  if (row.settlementDate) {
    parts.push(
      `Baixa em ${new Date(row.settlementDate).toLocaleDateString("pt-BR")}: recebido R$ ${row.receivedAmount.toFixed(2)}.`
    );
  }
  parts.push(
    `Base comissionável R$ ${row.commissionableBaseAmount.toFixed(2)}; comissão prevista R$ ${row.commissionExpected.toFixed(2)}; liberada R$ ${row.commissionReleased.toFixed(2)}.`
  );
  if (row.rawSellerName && row.canonicalSellerName && row.rawSellerName !== row.canonicalSellerName) {
    parts.push(`Vendedor Nomus: ${row.rawSellerName} → canônico: ${row.canonicalSellerName}.`);
  }

  return {
    explanation: parts.join(" "),
    record: row.productCode
      ? {
          productCode: row.productCode,
          baseAmount: row.commissionableBaseAmount,
          ratePercent: row.ratePercent,
          commissionAmount: row.commissionExpected,
        }
      : null,
    documentTotals: {
      base: row.commissionableBaseAmount,
      commission: row.grossCommissionAmount,
    },
  };
}

export function buildVisualAuditClosingCsv(
  rows: VisualAuditClosingRow[],
  closingPage: ReceiptClosingPagePayload
): string {
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = [
    "categoria",
    "statusLinha",
    "motivo",
    "codigoContaReceber",
    "parcela",
    "vencimento",
    "baixa",
    "cliente",
    "pedido",
    "nfe",
    "produto",
    "vendedorNomus",
    "vendedorCanonico",
    "valorRecebido",
    "baseComissionavel",
    "percentual",
    "comissaoPrevista",
    "comissaoLiberada",
    "alertas",
  ];

  const summary = closingPage.materializationSummary;
  const meta = [
    `# auditoria_fechamento_por_recebimento`,
    `# ano=${closingPage.year}`,
    `# mes=${closingPage.month}`,
    `# titulos_recebidos=${summary.totalReceivablesCount}`,
    `# com_schedule=${summary.receivablesWithScheduleCount}`,
    `# sem_schedule=${summary.receivablesWithoutScheduleCount}`,
    `# clientes_excluidos=${summary.excludedCustomerCount}`,
    `# grupo_excluido=${summary.groupCompanyExcludedCount}`,
    `# vendedor_nao_resolvido=${summary.sellerUnresolvedCount}`,
    `# divergencias_criticas=${closingPage.reconciliation.divergentReceivableCount}`,
  ];

  const lines = rows.map((row) =>
    [
      row.auditCategoryLabel,
      row.lineStatus,
      row.statusReason ?? "",
      row.nomusReceivableId ?? "",
      row.installmentNumber ?? "",
      row.dueDate ?? "",
      row.settlementDate ?? "",
      row.customerName ?? "",
      row.orderCode ?? "",
      row.nfeNumber ?? "",
      row.productCode ?? "",
      row.rawSellerName ?? "",
      row.canonicalSellerName ?? "",
      row.receivedAmount,
      row.commissionableBaseAmount,
      row.ratePercent,
      row.commissionExpected,
      row.commissionReleased,
      row.alertLabels.join("; "),
    ]
      .map(escape)
      .join(",")
  );

  return [...meta, headers.join(","), ...lines].join("\n");
}

/** Conta títulos únicos com divergência crítica — mesma regra do fechamento. */
export function countVisualAuditCriticalDivergenceReceivables(
  rows: VisualAuditClosingRow[]
): number {
  const seen = new Set<number>();
  let count = 0;
  for (const row of rows) {
    if (row.nomusReceivableId == null || !row.isCriticalDivergence) continue;
    if (seen.has(row.nomusReceivableId)) continue;
    seen.add(row.nomusReceivableId);
    count += 1;
  }
  return count;
}

export function countVisualAuditRowsByCategory(
  rows: VisualAuditClosingRow[]
): Partial<Record<VisualAuditOfficialCategory, number>> {
  const counts: Partial<Record<VisualAuditOfficialCategory, number>> = {};
  for (const row of rows) {
    counts[row.auditCategory] = (counts[row.auditCategory] ?? 0) + 1;
  }
  return counts;
}
