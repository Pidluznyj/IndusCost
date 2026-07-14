/**
 * Tipos e helpers do Relatório Comercial > Pedidos de Venda (branding IndusCost).
 *
 * Frontend-safe: NÃO importa Prisma. Espelha o formato de contrato usado em
 * `financeAccountsReceivableTitles.ts` (Contas a Receber > Títulos).
 *
 * Fonte oficial: SalesOrder / SalesOrderItem (Nomus). Proposta é origem
 * comercial e não deve ser fonte oficial deste relatório.
 */

export const SALES_ORDER_REPORT_ROWS_LIMIT = 5000;

export type SalesOrderReportFilterLabel = {
  label: string;
  value: string;
};

export type SalesOrderReportSummary = {
  ordersCount: number;
  totalItemsCount: number;
  activeItemsCount: number;
  canceledItemsCount: number;
  cutItemsCount: number;
  originalValue: number;
  canceledValue: number;
  cutValue: number;
  activeValue: number;
  invoicedValue: number;
  pendingBalance: number;
  averageTicket: number;
  invoicedCount: number;
  notInvoicedCount: number;
};

export type SalesOrderReportRow = {
  orderId: string;
  orderCode: string;
  externalSalesOrderCode: string | null;
  customerName: string;
  customerCnpj: string | null;
  companyName: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  sellerName: string;
  sellerExternalId: number | null;
  commercialResponsibleName: string | null;
  operationalResponsibleName: string | null;
  status: string;
  statusLabel: string;
  paymentConditionLabel: string;
  paymentMethodLabel: string;
  itemsCount: number;
  activeItemsCount: number;
  canceledItemsCount: number;
  cutItemsCount: number;
  originalValue: number;
  canceledValue: number;
  cutValue: number;
  activeValue: number;
  invoicedValue: number;
  pendingBalance: number;
  hasInvoice: boolean;
  nfeCount: number;
  nfeNumbers: string[];
  nfeDocument: string;
  lastNfeDate: string | null;
  alertsSummary: string;
};

export type SalesOrderReportAppliedFilters = {
  customerId: string;
  customerName: string | null;
  status: string;
  sellerKey: string;
  sellerLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  month: number | null;
  search: string;
};

export type SalesOrderReportPayload = {
  generatedAt: string;
  emitterName: string | null;
  filters: SalesOrderReportAppliedFilters;
  filterLabels: SalesOrderReportFilterLabel[];
  summary: SalesOrderReportSummary;
  rows: SalesOrderReportRow[];
  truncated: boolean;
  totalOrdersInScope: number;
};

// ---------------------------------------------------------------------------
// Helpers puros (usados por backend + testes)
// ---------------------------------------------------------------------------

/** Ticket médio protegido contra divisão por zero. */
export function computeSalesOrderReportAverageTicket(
  totalActive: number,
  ordersCount: number
): number {
  if (!Number.isFinite(totalActive) || !Number.isFinite(ordersCount) || ordersCount <= 0) {
    return 0;
  }
  return totalActive / ordersCount;
}

/** Soma segura ignorando valores não finitos. */
export function sumSalesOrderReportField<T>(
  rows: readonly T[],
  extractor: (row: T) => number | null | undefined
): number {
  let total = 0;
  for (const row of rows) {
    const value = Number(extractor(row) ?? 0);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** Contagem de linhas cujo predicado é verdadeiro. */
export function countSalesOrderReportRows<T>(
  rows: readonly T[],
  predicate: (row: T) => boolean
): number {
  let n = 0;
  for (const row of rows) if (predicate(row)) n += 1;
  return n;
}

/** Recomputa o summary a partir das linhas emitidas (garante consistência PDF/XLSX). */
export function computeSalesOrderReportSummaryFromRows(
  rows: readonly SalesOrderReportRow[]
): SalesOrderReportSummary {
  const originalValue = sumSalesOrderReportField(rows, (r) => r.originalValue);
  const canceledValue = sumSalesOrderReportField(rows, (r) => r.canceledValue);
  const cutValue = sumSalesOrderReportField(rows, (r) => r.cutValue);
  const activeValue = sumSalesOrderReportField(rows, (r) => r.activeValue);
  const invoicedValue = sumSalesOrderReportField(rows, (r) => r.invoicedValue);
  const pendingBalance = sumSalesOrderReportField(rows, (r) => r.pendingBalance);
  const totalItemsCount = sumSalesOrderReportField(rows, (r) => r.itemsCount);
  const activeItemsCount = sumSalesOrderReportField(rows, (r) => r.activeItemsCount);
  const canceledItemsCount = sumSalesOrderReportField(rows, (r) => r.canceledItemsCount);
  const cutItemsCount = sumSalesOrderReportField(rows, (r) => r.cutItemsCount);
  return {
    ordersCount: rows.length,
    totalItemsCount,
    activeItemsCount,
    canceledItemsCount,
    cutItemsCount,
    originalValue,
    canceledValue,
    cutValue,
    activeValue,
    invoicedValue,
    pendingBalance,
    averageTicket: computeSalesOrderReportAverageTicket(activeValue, rows.length),
    invoicedCount: countSalesOrderReportRows(rows, (r) => r.hasInvoice),
    notInvoicedCount: countSalesOrderReportRows(rows, (r) => !r.hasInvoice),
  };
}

// ---------------------------------------------------------------------------
// Filtros aplicados → banda "Filtros aplicados" da capa
// ---------------------------------------------------------------------------

const SALES_ORDER_REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

export function formatSalesOrderReportStatusLabel(status: string | null | undefined): string {
  const trimmed = status?.trim() ?? "";
  if (!trimmed) return "—";
  return SALES_ORDER_REPORT_STATUS_LABELS[trimmed] ?? trimmed;
}

const SALES_ORDER_REPORT_MONTH_LABELS: Record<number, string> = {
  1: "Janeiro",
  2: "Fevereiro",
  3: "Março",
  4: "Abril",
  5: "Maio",
  6: "Junho",
  7: "Julho",
  8: "Agosto",
  9: "Setembro",
  10: "Outubro",
  11: "Novembro",
  12: "Dezembro",
};

function safeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Monta linhas do bloco "Filtros aplicados" a partir dos filtros brutos. */
export function buildSalesOrderReportFilterLabels(
  filters: SalesOrderReportAppliedFilters
): SalesOrderReportFilterLabel[] {
  const lines: SalesOrderReportFilterLabel[] = [];
  const customerName = safeText(filters.customerName);
  const status = safeText(filters.status);
  const startDate = safeText(filters.startDate);
  const endDate = safeText(filters.endDate);
  const search = safeText(filters.search);

  if (customerName) {
    lines.push({ label: "Cliente", value: customerName });
  } else if (filters.customerId) {
    lines.push({ label: "Cliente (ID)", value: filters.customerId });
  }
  if (filters.year != null) {
    lines.push({ label: "Ano emissão", value: String(filters.year) });
  }
  if (filters.month != null) {
    const label =
      SALES_ORDER_REPORT_MONTH_LABELS[filters.month] ?? String(filters.month);
    lines.push({ label: "Mês emissão", value: label });
  }
  if (startDate || endDate) {
    lines.push({
      label: "Emissão",
      value: `${startDate || "…"} — ${endDate || "…"}`,
    });
  }
  if (status) {
    lines.push({ label: "Status", value: formatSalesOrderReportStatusLabel(status) });
  }
  if (filters.sellerLabel) {
    lines.push({ label: "Vendedor pedido", value: filters.sellerLabel });
  }
  if (search) {
    lines.push({ label: "Busca", value: search });
  }
  return lines;
}

/** Slug amigável para nome de arquivo. */
export function slugifySalesOrderReportName(value: string | null | undefined): string {
  const raw = safeText(value);
  if (!raw) return "todos";
  return (
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "todos"
  );
}

/** Nome canônico dos arquivos exportados (PDF/XLSX). */
export function salesOrderReportExportFilename(input: {
  format: "pdf" | "xlsx";
  customerName: string | null | undefined;
  referenceDate?: Date;
}): string {
  const date = input.referenceDate ?? new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const slug = slugifySalesOrderReportName(input.customerName);
  return `pedidos-de-venda-${slug}-${y}-${m}-${d}.${input.format}`;
}
