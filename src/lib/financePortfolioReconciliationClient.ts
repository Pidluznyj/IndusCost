/**
 * Tipos e query builder do cliente da Conciliação de Carteira (read-only).
 * Não recalcula fatos — só monta query string para a API materializada.
 */

export type PortfolioReconciliationUiFilters = {
  runId: string;
  customerExternalId: string;
  year: string;
  month: string;
  orderCode: string;
  status: string;
  confidenceLevel: string;
  forecastSource: string;
  onlyIssues: boolean;
  page: number;
  pageSize: number;
};

export type PortfolioReconciliationSummaryCards = {
  totalPedidos: number;
  totalValorPedidos: number;
  totalAlocadoPorPrecoPedido: number;
  totalAlocadoPorPrecoDocumento: number;
  totalContasReceber: number;
  totalRecebido: number;
  saldoCarteira: number;
  valorComDivergencia: number;
  valorSemConfianca: number;
  pedidosComAlerta: number;
  alertasEncontrados: number;
  divergenciasEncontradas: number;
  nfsHeaderOnly: number;
};

export type PortfolioReconciliationOrderRow = {
  salesOrderId: string | null;
  pedido: string | null;
  cliente: string | null;
  customerExternalId: number | null;
  valorPedido: number;
  valorAlocado: number;
  valorAlocadoPorDocumento: number;
  valorCR: number;
  recebido: number;
  saldo: number;
  forecastDate: string | null;
  forecastSource: string;
  forecastDates: string[];
  forecastLabel: string;
  forecastDueCount: number;
  confidenceLevel: string;
  status: string;
  alertas: string[];
  hasIssues: boolean;
  nfsHeaderOnly: boolean;
};

export type PortfolioReconciliationRunDto = {
  id: string;
  status: string;
  mode: string;
  startedAt: string | null;
  finishedAt: string | null;
  fromDate: string | null;
  toDate: string | null;
  customerExternalId: number | null;
  filters: unknown;
  summary: unknown;
  errorMessage: string | null;
  createdAt: string;
};

export type PortfolioReconciliationAvailableFilters = {
  statuses: string[];
  confidenceLevels: string[];
  forecastSources: string[];
  customers: Array<{ customerExternalId: number; customerName: string | null }>;
  years: number[];
  months: number[];
};

export type PortfolioReconciliationListPayload = {
  ok: boolean;
  message: string | null;
  run: PortfolioReconciliationRunDto | null;
  summary: PortfolioReconciliationSummaryCards | null;
  businessAnswers: PortfolioBusinessAnswers | null;
  rows: PortfolioReconciliationOrderRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  filters: PortfolioReconciliationUiFilters | Record<string, unknown> | null;
  availableFilters: PortfolioReconciliationAvailableFilters;
};

export type PortfolioBusinessAnswerFilterHint = {
  forecastSource?: "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED" | null;
  onlyIssues?: boolean;
  receiptBucket?:
    | "OVERDUE"
    | "NEXT_7_DAYS"
    | "NEXT_30_DAYS"
    | "AFTER_30_DAYS"
    | "WITHOUT_RELIABLE_DATE"
    | null;
};

export type PortfolioBusinessAnswers = {
  quantoTenhoParaReceber: {
    value: number;
    label: string;
    explanation: string;
    validationHint: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  quandoVouReceber: {
    nextDate: string | null;
    nextDateLabel: string | null;
    nextDateValue: number;
    overdueValue: number;
    next7DaysValue: number;
    next30DaysValue: number;
    over30DaysValue: number;
    withoutReliableDateValue: number;
    highlightKind: "OVERDUE" | "NEXT_DATE" | "EMPTY";
    highlightValue: number;
    highlightSubtitle: string;
    buckets: Array<{
      id: string;
      label: string;
      value: number;
      ordersCount: number;
    }>;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  jaVirouContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  faturadoSemContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  soPedidoCarteira: {
    value: number;
    ordersCount: number;
    reviewValue: number;
    reviewOrdersCount: number;
    totalOrderOnlyValue: number;
    totalOrderOnlyOrdersCount: number;
    label: string;
    explanation: string;
    displayPrimaryValue: number;
    displaySubtitle: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  precisaRevisar: {
    ordersCount: number;
    alertsCount: number;
    valueAtRisk: number;
    valorPedidosComAlerta: number;
    mainReasons: Array<{ reason: string; count: number; label?: string }>;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
};

export type PortfolioReconciliationOrderDetailPayload = {
  ok: boolean;
  message: string | null;
  detail: {
    salesOrderId: string;
    run: PortfolioReconciliationRunDto | null;
    order: PortfolioReconciliationOrderRow | null;
    header?: {
      order: PortfolioReconciliationOrderRow | null;
      orderIssueDate: string | null;
      expectedDeliveryDate: string | null;
      externalSalesOrderId: number | null;
      primaryAlerts: string[];
    };
    orderItems?: Array<Record<string, unknown>>;
    documentLinks?: Array<Record<string, unknown>>;
    allocations?: Array<Record<string, unknown>>;
    receivableTitles?: Array<Record<string, unknown>>;
    receivablesSummary?: Record<string, unknown> | null;
    managerNotes?: string[];
    technical?: {
      salesOrderId: string | null;
      externalSalesOrderId: number | null;
      orderCode: string | null;
      customerExternalId: number | null;
      nfeExternalIds: number[];
      stockDocumentExternalIds: number[];
      receivableIds: number[];
      links: Array<{ from: string; to: string; via: string }>;
      sanitizedTraces: Array<{
        factId: string;
        status: string | null;
        confidenceLevel: string;
        trace: Record<string, unknown> | null;
      }>;
    };
    items: Array<Record<string, unknown>>;
    linkedNfes: Array<Record<string, unknown>>;
    stockDocuments: Array<Record<string, unknown>>;
    allocatedItems: Array<Record<string, unknown>>;
    receivables: Record<string, unknown> | null;
    timeline: Array<{ at: string; kind: string; label: string }>;
    alertas: string[];
    traces: Array<{
      factId: string;
      status: string | null;
      confidenceLevel: string;
      trace: Record<string, unknown> | null;
    }>;
  } | null;
  run?: PortfolioReconciliationRunDto | null;
};

export type PortfolioReconciliationRunsPayload = {
  ok: boolean;
  runs: PortfolioReconciliationRunDto[];
};

export function createDefaultPortfolioReconciliationUiFilters(): PortfolioReconciliationUiFilters {
  return {
    runId: "",
    customerExternalId: "",
    year: "",
    month: "",
    orderCode: "",
    status: "",
    confidenceLevel: "",
    forecastSource: "",
    onlyIssues: false,
    page: 1,
    pageSize: 50,
  };
}

export function buildPortfolioReconciliationListQuery(
  filters: PortfolioReconciliationUiFilters
): string {
  const params = new URLSearchParams();
  if (filters.runId.trim()) params.set("runId", filters.runId.trim());
  if (filters.customerExternalId.trim()) {
    params.set("customerExternalId", filters.customerExternalId.trim());
  }
  if (filters.year.trim()) params.set("year", filters.year.trim());
  if (filters.month.trim()) params.set("month", filters.month.trim());
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  if (filters.confidenceLevel.trim()) {
    params.set("confidenceLevel", filters.confidenceLevel.trim());
  }
  if (filters.forecastSource.trim()) {
    params.set("forecastSource", filters.forecastSource.trim());
  }
  if (filters.onlyIssues) params.set("onlyIssues", "true");
  params.set("page", String(Math.max(1, filters.page)));
  params.set("pageSize", String(Math.max(1, filters.pageSize)));
  return params.toString();
}

export const PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE =
  "Esta visão é uma auditoria paralela de carteira, documentos de saída e contas a receber. Ela não altera o fluxo de caixa oficial.";

export const PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER =
  "Esta tela mostra a carteira sem duplicar valores. Quando um pedido já virou Contas a Receber, usamos o CR. Quando ainda não virou CR, usamos a NF/documento de saída. Quando ainda não foi faturado, usamos o pedido. O que não for confiável aparece em Precisa revisar.";

export const PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE =
  "Nenhuma conciliação materializada encontrada. Solicite a execução do rebuild manual no servidor.";
