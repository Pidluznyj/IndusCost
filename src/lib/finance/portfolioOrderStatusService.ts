/**
 * Service puro — Status Pedidos (visão consolidada por Pedido de Venda).
 * Entrada: facts OrderToCashAuditFact (já materializados).
 * Sem Prisma, sem HTTP, sem side-effects.
 *
 * Regras:
 * - 1 linha por pedido (salesOrderId → orderCode)
 * - orderNet / CR 1× por pedido (não somar facts)
 * - lineBilled só evidência de item (nunca CR / NF cabeçalho)
 * - PENDING não contribui como faturado
 */

import {
  resolveOrderToCashAuditLineBilledValue,
  type OrderToCashAuditFactRecord,
} from "./orderToCashAuditApi.js";
import { isCanceledOrderItemFact } from "./orderItemFulfillmentStatus.js";
import {
  normalizeOrderStatusSearch,
  matchOrderStatusSearch,
} from "./portfolioOrderStatusSearch.js";

/** Fact de entrada — FactRecord + campos opcionais ainda não no select padrão. */
export type PortfolioOrderStatusFact = OrderToCashAuditFactRecord & {
  /** Precomputado (ex.: list row); se ausente, resolve via evidência de item. */
  lineBilledValue?: number | null;
  salesOrderItemId?: string | null;
  externalSalesOrderItemId?: number | null;
  /** Status do item no pedido (ex.: CANCELADO). */
  orderItemStatus?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  nomusMatchConfidence?: string | null;
  /**
   * Nome oficial do Responsável Comercial do CLIENTE (CRM/carteira). Vem do
   * `CrmCustomerCommercialOwner` (manual) via loader — nunca do setor/área
   * operacional do pedido (`responsibleArea`).
   */
  commercialResponsibleName?: string | null;
  commercialResponsibleId?: string | null;
  fiscalStage?: string | null;
  commercialStage?: string | null;
  cashStage?: string | null;
  hasPaymentConditionMissing?: boolean | null;
};

export type PortfolioOrderStatusConsolidated =
  | "COMPLETO_RECEBIDO"
  | "COMPLETO_CR_ABERTO"
  | "COMPLETO_SEM_CR"
  | "COMPLETO_COM_CANCELAMENTO"
  | "RECEBIDO_COM_CANCELAMENTO"
  | "PARCIAL_RECEBIDO"
  | "PARCIAL_CR_ABERTO"
  | "PARCIAL_SEM_CR"
  | "PARCIAL_COM_CANCELAMENTO"
  | "SEM_ATENDIMENTO_FUTURO"
  | "SEM_ATENDIMENTO_ATRASADO"
  | "NF_SEM_CR"
  | "BLOQUEADO_REVISAO"
  | "CANCELADO";

export const PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS = [
  "DOCUMENTO_COM_EXCEDENTE",
  "PRODUTO_FORA_DO_PEDIDO",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "DIVERGENCIA_PRECO",
  "DOCUMENTO_PARCIAL",
  "DOCUMENTO_SEM_CR",
  "CR_SEM_RATEIO_SEGURO",
] as const;

export type PortfolioOrderStatusDivergenceAlert =
  (typeof PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS)[number];

export type PortfolioOrderStatusPrimaryCardId =
  | "total"
  | "completos"
  | "parciais"
  | "sem_atendimento"
  | "com_divergencia"
  | "cr_aberto"
  | "recebidos"
  | "bloqueados"
  | "com_cancelamento";

export type PortfolioOrderStatusRow = {
  orderKey: string;
  salesOrderId: string | null;
  orderCode: string | null;
  orderIssueDate: string | null;
  orderExpectedDeliveryDate: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  /**
   * Pessoa responsável pela carteira/cliente no CRM Comercial.
   * Fonte oficial: `CrmCustomerCommercialOwner` (manual). Nunca é setor
   * (`responsibleArea` = FINANCEIRO / FATURAMENTO / ...).
   */
  commercialResponsibleName: string | null;
  /**
   * Vendedor do PEDIDO (Nomus / `SalesOrder.externalSellerId` +
   * `nomusSellerName`). Fonte oficial para comissão.
   */
  orderSellerName: string | null;
  /**
   * Setor / responsável operacional do pedido (`responsibleArea` do fact,
   * ex.: `COMERCIAL`, `FINANCEIRO`, `FATURAMENTO`, `EXPEDIÇÃO`). Nunca
   * exibir como Responsável Comercial.
   */
  operationalResponsibleArea: string | null;

  /** Valor original do pedido (orderNet / soma itens). */
  totalOrderValue: number;
  /** Alias de totalOrderValue — valor pedido original. */
  originalOrderValue: number;
  /** Soma dos itens não cancelados. */
  activeOrderValue: number;
  /** Soma dos itens cancelados. */
  canceledOrderValue: number;
  /** Soma dos itens atendidos com corte (saldo cortado encerrado). */
  cutOrderValue: number;
  allocatedOrderValue: number;
  lineBilledValue: number;
  /**
   * Saldo pendente ativo (itens não cancelados ainda sem atendimento).
   * Alias histórico: pendingOrderValue.
   */
  pendingOrderValue: number;
  pendingActiveOrderValue: number;
  /** % sobre itens ativos (cancelados não entram). */
  fulfillmentPercent: number;
  fulfillmentPercentActive: number;

  receivableTotalValue: number;
  receivableOpenValue: number;
  receivableReceivedValue: number;

  operationalStatus: string;
  fiscalStatus: string;
  financialStatus: string;
  consolidatedOrderStatus: PortfolioOrderStatusConsolidated;

  temperature: string | null;
  confidenceScore: number | null;
  alerts: string[];
  recommendedAction: string | null;

  factCount: number;
  /** Itens pendentes ativos (exclui cancelados). */
  pendingItemCount: number;
  pendingActiveItemsCount: number;
  allocatedItemCount: number;
  fulfilledItemsCount: number;
  canceledItemsCount: number;
  cutItemsCount: number;
  /** true só com pendência ativa real (não cancelada). */
  hasPendingItems: boolean;
  hasCanceledItems: boolean;
  hasAllocation: boolean;
  hasOpenCr: boolean;
  hasReceived: boolean;
  hasDivergences: boolean;
  hasOverdueReceivable: boolean;
  hasDeliveryDelay: boolean;
  hasMissingStockDocument: boolean;
  hasPaymentConditionMissing: boolean;
  hasMissingSeller: boolean;
  hasMissingCommercialResponsible: boolean;
  /** Tokens de produto/SKU do pedido (para filtro, sem expor facts). */
  productTokens: string[];
  nfeNumbers: string[];
  /** ExternalIds de documentos de saída vinculados (para busca inteligente). */
  stockDocumentExternalIds: number[];
  nfeHeaderMaxValue: number;
  validInvoiceCount: number;
  canceledInvoiceCount: number;
  hasValidInvoice: boolean;
  hasCanceledInvoice: boolean;
  /**
   * CR recebido/parcial vinculado a NF cancelada (alerta fiscal × financeiro).
   * Não altera status financeiro oficial do CR.
   */
  hasReceivedCrLinkedToCanceledNfe: boolean;
  /** Status fiscal consolidado (ex.: NFE_AUTHORIZED, NFE_CANCELLED). */
  billingStatus: string;
  /**
   * Preenchido quando `filters.search` casa com a linha.
   * Null/ausente quando não há busca inteligente aplicada.
   */
  searchMatchedBy?:
    | "CUSTOMER"
    | "SALES_ORDER"
    | "NFE"
    | "STOCK_DOCUMENT"
    | "PRODUCT"
    | null;
  searchMatchedText?: string | null;
};

export type PortfolioOrderStatusPrimaryCard = {
  id: PortfolioOrderStatusPrimaryCardId;
  label: string;
  /** Pedidos distintos (nunca facts). */
  count: number;
  /** Soma de totalOrderValue dos pedidos do card. */
  totalOrderValue: number;
  /** Percentual de pedidos sobre o total do universo base. */
  percentOfTotal: number;
  hint: string;
  tone: "neutral" | "green" | "blue" | "amber" | "gray" | "orange" | "red";
};

/** Tooltips oficiais dos cards principais (Status Pedidos). */
export const PORTFOLIO_ORDER_STATUS_PRIMARY_CARD_HINTS: Record<
  PortfolioOrderStatusPrimaryCardId,
  string
> = {
  total: "Total de pedidos distintos dentro do filtro.",
  completos:
    "Pedidos com atendimento operacional completo dos itens ativos (inclui completo com cancelamento).",
  parciais:
    "Pedidos com pelo menos um item ativo atendido e pelo menos um item ativo ainda pendente. Itens cancelados não geram parcial.",
  sem_atendimento:
    "Pedidos sem item casado com documento de saída/NF.",
  com_divergencia:
    "Pedidos com excesso, produto fora, documento parcial, divergência de preço ou outro alerta técnico.",
  cr_aberto:
    "Pedidos com título financeiro aberto. Valores são agregados uma vez por pedido/título.",
  recebidos: "Pedidos com recebimento/baixa identificada.",
  bloqueados:
    "Pedidos antigos ou sem evidência suficiente para tratar como carteira confiável.",
  com_cancelamento:
    "Pedidos com pelo menos um item cancelado no pedido de venda.",
};

export type PortfolioOrderStatusDrilldownCard = {
  id: string;
  parentCardId: PortfolioOrderStatusPrimaryCardId | null;
  label: string;
  count: number;
  hint: string;
};

export type PortfolioOrderStatusSummary = {
  totalOrders: number;
  totalOrderValue: number;
  totalAllocatedValue: number;
  totalLineBilledValue: number;
  totalPendingValue: number;
  totalCanceledValue: number;
  totalCutValue: number;
  totalReceivableValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  statusCounts: Record<PortfolioOrderStatusConsolidated, number>;
  withDivergences: number;
  withOpenCr: number;
  withReceived: number;
  withCanceledItems: number;
  withCutItems: number;
  canceledItemsCount: number;
  cutItemsCount: number;
  summarySource: "aggregated_orders";
  crAggregation: "max_per_order_excluding_pending_lines";
  lineBilledRule: "item_evidence_only";
};

export type PortfolioOrderStatusFilters = {
  customerExternalId?: number | null;
  customerName?: string | null;
  sellerName?: string | null;
  responsibleName?: string | null;
  productOrSku?: string | null;
  /**
   * Busca inteligente: cliente, pedido (PD), NF ou documento de saída.
   * Combina com os demais filtros; resultado permanece 1 linha/pedido.
   */
  search?: string | null;
  consolidatedStatus?: PortfolioOrderStatusConsolidated | null;
  operationalStatus?: string | null;
  financialStatus?: string | null;
  temperature?: string | null;
  alert?: string | null;
  selectedCard?: PortfolioOrderStatusPrimaryCardId | null;
  selectedDrilldown?: string | null;
  onlyWithDivergences?: boolean;
  onlyWithOpenCr?: boolean;
  onlyWithPendingBalance?: boolean;
  year?: number | null;
  from?: string | Date | null;
  to?: string | Date | null;
};

export type PortfolioOrderStatusSortBy =
  | "orderCode"
  | "orderIssueDate"
  | "orderExpectedDeliveryDate"
  | "customerName"
  | "orderSellerName"
  | "totalOrderValue"
  | "allocatedOrderValue"
  | "lineBilledValue"
  | "pendingOrderValue"
  | "fulfillmentPercent"
  | "receivableTotalValue"
  | "receivableOpenValue"
  | "receivableReceivedValue"
  | "consolidatedOrderStatus"
  | "temperature"
  | "confidenceScore";

export type PortfolioOrderStatusSort = {
  sortBy: PortfolioOrderStatusSortBy;
  sortDirection: "asc" | "desc";
};

export type BuildPortfolioOrderStatusInput = {
  facts: readonly PortfolioOrderStatusFact[];
  /** Data de referência para FUTURO vs ATRASADO (default: agora). */
  asOf?: Date | string | null;
  filters?: PortfolioOrderStatusFilters | null;
  sort?: PortfolioOrderStatusSort | null;
  selectedCard?: PortfolioOrderStatusPrimaryCardId | null;
};

export type BuildPortfolioOrderStatusResult = {
  rows: PortfolioOrderStatusRow[];
  primaryCards: PortfolioOrderStatusPrimaryCard[];
  drilldownCards: PortfolioOrderStatusDrilldownCard[];
  summary: PortfolioOrderStatusSummary;
};

const MONEY_EPS = 0.009;
const DIVERGENCE_SET = new Set<string>(PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS);

const EMPTY_STATUS_COUNTS = (): Record<PortfolioOrderStatusConsolidated, number> => ({
  COMPLETO_RECEBIDO: 0,
  COMPLETO_CR_ABERTO: 0,
  COMPLETO_SEM_CR: 0,
  COMPLETO_COM_CANCELAMENTO: 0,
  RECEBIDO_COM_CANCELAMENTO: 0,
  PARCIAL_RECEBIDO: 0,
  PARCIAL_CR_ABERTO: 0,
  PARCIAL_SEM_CR: 0,
  PARCIAL_COM_CANCELAMENTO: 0,
  SEM_ATENDIMENTO_FUTURO: 0,
  SEM_ATENDIMENTO_ATRASADO: 0,
  NF_SEM_CR: 0,
  BLOQUEADO_REVISAO: 0,
  CANCELADO: 0,
});

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseOrderStatusAlerts(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      return parseOrderStatusAlerts(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function orderKeyOf(fact: PortfolioOrderStatusFact): string {
  if (fact.salesOrderId?.trim()) return fact.salesOrderId.trim();
  if (fact.orderCode?.trim()) return `code:${fact.orderCode.trim()}`;
  return `fact:${fact.id}`;
}

function itemKeyOf(fact: PortfolioOrderStatusFact): string {
  if (fact.salesOrderItemId?.trim()) return `item:${fact.salesOrderItemId.trim()}`;
  if (fact.externalSalesOrderItemId != null) {
    return `ext-item:${fact.externalSalesOrderItemId}`;
  }
  const code = (fact.productCode ?? fact.sku ?? "").trim().toUpperCase();
  if (code) return `sku:${code}`;
  return `fact-item:${fact.id}`;
}

function isPendingLine(fact: PortfolioOrderStatusFact): boolean {
  return (fact.lineType ?? "").toUpperCase() === "ORDER_ITEM_PENDING";
}

/** Pendência ativa: linha PENDING que não é item cancelado. */
export function isActivePendingLine(fact: PortfolioOrderStatusFact): boolean {
  return isPendingLine(fact) && !isCanceledOrderItemFact(fact);
}

export function isCanceledPendingLine(fact: PortfolioOrderStatusFact): boolean {
  const type = (fact.lineType ?? "").toUpperCase();
  if (type === "ORDER_ITEM_CANCELED") return true;
  return isPendingLine(fact) && isCanceledOrderItemFact(fact);
}

function isAllocatedLine(fact: PortfolioOrderStatusFact): boolean {
  const type = (fact.lineType ?? "").toUpperCase();
  if (type === "ORDER_ITEM_PENDING") return false;
  if (type === "ORDER_ITEM_CANCELED") return false;
  if (type === "ORDER_ITEM_CUT") return false;
  if (type === "DOCUMENT_EXTRA_ITEM") return false;
  const qty = fact.quantityUsedForOrder ?? 0;
  const alloc = fact.allocatedValueByOrderPrice ?? 0;
  return qty > MONEY_EPS || alloc > MONEY_EPS || type === "ORDER_ITEM_ALLOCATED";
}

/** Linha de corte encerra saldo cortado (contabiliza no valor cortado). */
export function isCutLine(fact: PortfolioOrderStatusFact): boolean {
  const type = (fact.lineType ?? "").toUpperCase();
  if (type === "ORDER_ITEM_CUT") return true;
  if (fact.nomusIsCut === true) return true;
  const norm = (fact.nomusItemStatusNormalized ?? "").trim().toUpperCase();
  return norm === "FULFILLED_WITH_CUT";
}

/**
 * Valor cobrado da linha — evidência de item apenas.
 * PENDING → 0; nunca CR total / NF cabeçalho.
 */
export function resolveFactLineBilledValue(fact: PortfolioOrderStatusFact): number {
  if (isPendingLine(fact)) return 0;
  if (fact.lineBilledValue != null && Number.isFinite(fact.lineBilledValue)) {
    return Math.max(0, fact.lineBilledValue);
  }
  const resolved = resolveOrderToCashAuditLineBilledValue({
    lineType: fact.lineType,
    quantityUsedForOrder: fact.quantityUsedForOrder,
    excessQuantity: fact.excessQuantity,
    outsideOrderQuantity: fact.outsideOrderQuantity,
    stockDocumentItemTotalValue: fact.stockDocumentItemTotalValue,
    stockDocumentItemQuantity: fact.stockDocumentItemQuantity,
    stockDocumentItemUnitValue: fact.stockDocumentItemUnitValue,
    nfeItemTotalValue: fact.nfeItemTotalValue,
    nfeItemQuantity: fact.nfeItemQuantity,
    nfeItemUnitValue: fact.nfeItemUnitValue,
    allocatedValueByDocumentPrice: fact.allocatedValueByDocumentPrice,
  });
  if (resolved.lineBilledValue != null && Number.isFinite(resolved.lineBilledValue)) {
    return Math.max(0, resolved.lineBilledValue);
  }
  // Fallback explícito: só allocatedValueByDocumentPrice em linhas alocadas
  if (isAllocatedLine(fact) && fact.allocatedValueByDocumentPrice != null) {
    return Math.max(0, fact.allocatedValueByDocumentPrice);
  }
  return 0;
}

function collectAlerts(facts: readonly PortfolioOrderStatusFact[]): string[] {
  const set = new Set<string>();
  for (const fact of facts) {
    for (const a of parseOrderStatusAlerts(fact.alertsJson)) set.add(a);
    if (fact.hasExcessQuantity) set.add("DOCUMENTO_COM_EXCEDENTE");
    if (fact.hasProductOutsideOrder) set.add("PRODUTO_FORA_DO_PEDIDO");
    if (fact.hasNfeHeaderGreaterThanOrder) set.add("NF_CABECALHO_MAIOR_PEDIDO");
    if (fact.hasPriceMismatch) set.add("DIVERGENCIA_PRECO");
    if (fact.hasPartialFulfillment) set.add("DOCUMENTO_PARCIAL");
    if (fact.hasDocumentWithoutReceivable) set.add("DOCUMENTO_SEM_CR");
    if (fact.hasOverdueReceivable) set.add("CR_VENCIDO");
    if (fact.hasDeliveryDelay) set.add("ENTREGA_VENCIDA");
    if (fact.hasMissingStockDocument) set.add("SEM_DOCUMENTO_SAIDA");
    if (fact.hasPaymentConditionMissing) set.add("SEM_CONDICAO_PAGAMENTO");
    for (const b of parseOrderStatusAlerts(fact.blockingReasonsJson)) set.add(b);
  }
  return [...set].sort();
}

function isMissingSellerName(name: string | null | undefined): boolean {
  const s = (name ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return (
    lower === "sem vendedor informado" ||
    lower === "sem vendedor" ||
    lower === "não informado" ||
    lower === "nao informado"
  );
}

function hasDivergenceAlerts(alerts: readonly string[]): boolean {
  return alerts.some((a) => DIVERGENCE_SET.has(a));
}

function pickDominantStage(
  facts: readonly PortfolioOrderStatusFact[],
  field: "operationalStage" | "financialStage" | "orderToCashStage" | "fiscalStage"
): string | null {
  const scores = new Map<string, number>();
  for (const fact of facts) {
    const raw =
      field === "fiscalStage"
        ? (fact.fiscalStage ?? null)
        : (fact[field] as string | null | undefined);
    const stage = raw?.trim();
    if (!stage) continue;
    scores.set(stage, (scores.get(stage) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestScore = -1;
  for (const [stage, score] of scores) {
    if (score > bestScore) {
      best = stage;
      bestScore = score;
    }
  }
  return best;
}

function isCanceledOrder(facts: readonly PortfolioOrderStatusFact[]): boolean {
  // Cancelamento total do pedido (não confundir com item cancelado isolado).
  for (const fact of facts) {
    if (isCanceledOrderItemFact(fact) && isPendingLine(fact)) continue;
    const stages = [
      fact.orderToCashStage,
      fact.commercialStage,
      fact.operationalStage,
      fact.financialStage,
    ];
    if (stages.some((s) => (s ?? "").toUpperCase().includes("CANCEL"))) return true;
    const alerts = parseOrderStatusAlerts(fact.alertsJson);
    if (alerts.some((a) => a.toUpperCase().includes("CANCEL"))) return true;
  }
  const orderItems = facts.filter(
    (f) => isPendingLine(f) || isAllocatedLine(f)
  );
  if (orderItems.length === 0) return false;
  const canceledOnly = orderItems.every(
    (f) => isCanceledOrderItemFact(f) || isCanceledPendingLine(f)
  );
  return canceledOnly && !orderItems.some(isAllocatedLine);
}

function isBlockedOrder(
  facts: readonly PortfolioOrderStatusFact[],
  alerts: readonly string[]
): boolean {
  if (alerts.includes("PEDIDO_ANTIGO_SEM_EVOLUCAO")) return true;
  for (const fact of facts) {
    if ((fact.orderToCashStage ?? "").toUpperCase() === "BLOQUEADO_REVISAO") return true;
    if (parseOrderStatusAlerts(fact.blockingReasonsJson).length > 0) return true;
  }
  return false;
}

function isNfSemCrOrder(
  facts: readonly PortfolioOrderStatusFact[],
  alerts: readonly string[],
  receivableTotal: number
): boolean {
  if (alerts.includes("DOCUMENTO_SEM_CR") && receivableTotal <= MONEY_EPS) return true;
  for (const fact of facts) {
    const stage = (fact.orderToCashStage ?? "").toUpperCase();
    if (stage === "NF_SEM_CR" || stage === "DOCUMENTO_SEM_NF") {
      if (receivableTotal <= MONEY_EPS) return true;
    }
    const fin = (fact.financialStage ?? "").toUpperCase();
    if (
      (fin === "INVOICED_WITHOUT_CR" || fin === "NO_CR") &&
      !isPendingLine(fact) &&
      (fact.nfeNumber || fact.stockDocumentExternalId != null) &&
      receivableTotal <= MONEY_EPS
    ) {
      return true;
    }
    if (fact.hasDocumentWithoutReceivable && receivableTotal <= MONEY_EPS) return true;
  }
  return false;
}

function financialBranch(input: {
  open: number;
  received: number;
  financialStage: string | null;
}): "RECEBIDO" | "CR_ABERTO" | "SEM_CR" {
  const stage = (input.financialStage ?? "").toUpperCase();
  const receivedFlag =
    input.received > MONEY_EPS ||
    stage === "CR_RECEIVED" ||
    stage === "RECEIVED" ||
    stage.includes("RECEIVED");
  if (receivedFlag && input.open <= MONEY_EPS) return "RECEBIDO";
  if (input.open > MONEY_EPS) return "CR_ABERTO";
  if (input.received > MONEY_EPS) return "RECEBIDO";
  return "SEM_CR";
}

/**
 * Classifica um pedido a partir das suas facts.
 * Item cancelado não gera parcial nem pendência ativa.
 */
export function classifyOrderStatus(
  orderFacts: readonly PortfolioOrderStatusFact[],
  options?: { asOf?: Date | string | null }
): {
  consolidatedOrderStatus: PortfolioOrderStatusConsolidated;
  operationalStatus: string;
  fiscalStatus: string;
  financialStatus: string;
  hasPendingItems: boolean;
  hasCanceledItems: boolean;
  hasAllocation: boolean;
  hasOpenCr: boolean;
  hasReceived: boolean;
  hasDivergences: boolean;
  alerts: string[];
} {
  const alerts = collectAlerts(orderFacts);
  const hasPendingActiveItems = orderFacts.some(isActivePendingLine);
  const hasCanceledItems = orderFacts.some(isCanceledOrderItemFact);
  const hasAllocation = orderFacts.some(isAllocatedLine);

  let receivableOpen = 0;
  let receivableReceived = 0;
  let receivableTotal = 0;
  for (const fact of orderFacts) {
    if (isPendingLine(fact)) continue;
    receivableOpen = Math.max(receivableOpen, fact.receivableOpenValue ?? 0);
    receivableReceived = Math.max(receivableReceived, fact.receivableReceivedValue ?? 0);
    receivableTotal = Math.max(receivableTotal, fact.receivableTotalValue ?? 0);
  }

  const hasOpenCr = receivableOpen > MONEY_EPS;
  const financialStage = pickDominantStage(orderFacts, "financialStage");
  const finBranch = financialBranch({
    open: receivableOpen,
    received: receivableReceived,
    financialStage,
  });
  const hasReceived = finBranch === "RECEBIDO" || receivableReceived > MONEY_EPS;
  const hasDivergences = hasDivergenceAlerts(alerts);

  const operationalStatus =
    pickDominantStage(orderFacts, "operationalStage") ??
    (!hasAllocation
      ? "NOT_FULFILLED"
      : hasPendingActiveItems
        ? "PARTIALLY_FULFILLED"
        : "FULLY_FULFILLED");

  const fiscalStatus =
    pickDominantStage(orderFacts, "fiscalStage") ??
    (orderFacts.some((f) => !isPendingLine(f) && f.nfeNumber)
      ? "HAS_NFE"
      : "NO_NFE");

  const financialStatus =
    finBranch === "RECEBIDO"
      ? "CR_RECEIVED"
      : finBranch === "CR_ABERTO"
        ? "CR_OPEN"
        : "NO_CR";

  let consolidatedOrderStatus: PortfolioOrderStatusConsolidated;

  if (isCanceledOrder(orderFacts)) {
    consolidatedOrderStatus = "CANCELADO";
  } else if (isBlockedOrder(orderFacts, alerts)) {
    consolidatedOrderStatus = "BLOQUEADO_REVISAO";
  } else if (
    isNfSemCrOrder(orderFacts, alerts, receivableTotal) &&
    hasAllocation &&
    !hasPendingActiveItems
  ) {
    consolidatedOrderStatus =
      hasCanceledItems ? "COMPLETO_COM_CANCELAMENTO" : "NF_SEM_CR";
  } else if (!hasAllocation) {
    const asOf = toDate(options?.asOf) ?? new Date();
    const delivery = orderFacts
      .map((f) => toDate(f.orderExpectedDeliveryDate))
      .find((d) => d != null);
    if (delivery && delivery.getTime() < asOf.getTime()) {
      consolidatedOrderStatus = "SEM_ATENDIMENTO_ATRASADO";
    } else {
      consolidatedOrderStatus = "SEM_ATENDIMENTO_FUTURO";
    }
  } else if (hasPendingActiveItems) {
    // Parcial só com item ativo pendente real
    if (hasCanceledItems) {
      consolidatedOrderStatus = "PARCIAL_COM_CANCELAMENTO";
    } else if (finBranch === "RECEBIDO") {
      consolidatedOrderStatus = "PARCIAL_RECEBIDO";
    } else if (finBranch === "CR_ABERTO") {
      consolidatedOrderStatus = "PARCIAL_CR_ABERTO";
    } else {
      consolidatedOrderStatus = "PARCIAL_SEM_CR";
    }
  } else if (hasCanceledItems) {
    // Ativos 100% atendidos + itens cancelados
    if (finBranch === "RECEBIDO") {
      consolidatedOrderStatus = "RECEBIDO_COM_CANCELAMENTO";
    } else {
      consolidatedOrderStatus = "COMPLETO_COM_CANCELAMENTO";
    }
  } else {
    // Completo (sem pendência ativa)
    if (finBranch === "RECEBIDO") consolidatedOrderStatus = "COMPLETO_RECEBIDO";
    else if (finBranch === "CR_ABERTO") consolidatedOrderStatus = "COMPLETO_CR_ABERTO";
    else if (isNfSemCrOrder(orderFacts, alerts, receivableTotal)) {
      consolidatedOrderStatus = "NF_SEM_CR";
    } else {
      consolidatedOrderStatus = "COMPLETO_SEM_CR";
    }
  }

  return {
    consolidatedOrderStatus,
    operationalStatus,
    fiscalStatus,
    financialStatus,
    hasPendingItems: hasPendingActiveItems,
    hasCanceledItems,
    hasAllocation,
    hasOpenCr,
    hasReceived,
    hasDivergences,
    alerts,
  };
}

/**
 * Agrega facts de um único pedido em uma linha.
 *
 * Valor do pedido:
 * 1) orderNetValue (1×) se presente
 * 2) senão soma dedupe de orderItemTotalValue por itemKey
 *
 * Atendido: soma allocatedValueByOrderPrice (alocadas), capped no total do pedido.
 * Cobrado: soma lineBilledValue de evidência de item (PENDING = 0).
 * CR: Math.max excluindo PENDING.
 */
export function aggregateOrderFactsToRow(
  orderFacts: readonly PortfolioOrderStatusFact[],
  options?: { asOf?: Date | string | null }
): PortfolioOrderStatusRow {
  if (orderFacts.length === 0) {
    throw new Error("aggregateOrderFactsToRow: orderFacts vazio");
  }

  const first = orderFacts[0]!;
  const orderKey = orderKeyOf(first);

  let salesOrderId: string | null = null;
  let orderCode: string | null = null;
  let orderIssueDate: Date | string | null = null;
  let orderExpectedDeliveryDate: Date | string | null = null;
  let customerName: string | null = null;
  let externalCustomerId: number | null = null;
  let orderSellerName: string | null = null;
  let commercialResponsibleName: string | null = null;
  let operationalResponsibleArea: string | null = null;
  let orderNetValue: number | null = null;
  let temperature: string | null = null;
  let confidenceScore: number | null = null;
  let recommendedAction: string | null = null;
  let hasOverdueReceivable = false;
  let hasDeliveryDelay = false;
  let hasMissingStockDocument = false;
  let hasPaymentConditionMissing = false;

  const itemOrderValues = new Map<string, number>();
  const canceledItemValues = new Map<string, number>();
  const cutItemValues = new Map<string, number>();
  const activeItemValues = new Map<string, number>();
  let allocatedOrderValue = 0;
  let lineBilledValue = 0;
  let pendingActiveItemsCount = 0;
  let canceledItemsCount = 0;
  let cutItemsCount = 0;
  let allocatedItemCount = 0;
  let receivableTotal = 0;
  let receivableOpen = 0;
  let receivableReceived = 0;
  let nfeHeaderMax = 0;
  const nfeNumbers = new Set<string>();
  const stockDocumentExternalIds = new Set<number>();
  const productTokens = new Set<string>();
  const seenCanceledItems = new Set<string>();
  const seenCutItems = new Set<string>();
  const seenPendingActiveItems = new Set<string>();
  const seenFulfilledItems = new Set<string>();

  for (const fact of orderFacts) {
    // Coleta busca (NF / doc) em todas as linhas — inclusive canceladas/pendentes.
    if (fact.nfeNumber?.trim()) nfeNumbers.add(fact.nfeNumber.trim());
    if (fact.stockDocumentExternalId != null) {
      stockDocumentExternalIds.add(fact.stockDocumentExternalId);
    }

    if (!salesOrderId && fact.salesOrderId) salesOrderId = fact.salesOrderId;
    if (!orderCode && fact.orderCode) orderCode = fact.orderCode;
    if (!orderIssueDate && fact.orderIssueDate) orderIssueDate = fact.orderIssueDate;
    if (!orderExpectedDeliveryDate && fact.orderExpectedDeliveryDate) {
      orderExpectedDeliveryDate = fact.orderExpectedDeliveryDate;
    }
    if (!customerName && fact.customerName) customerName = fact.customerName;
    if (externalCustomerId == null && fact.externalCustomerId != null) {
      externalCustomerId = fact.externalCustomerId;
    }
    if (!orderSellerName && fact.sellerName) orderSellerName = fact.sellerName;
    // Responsável Comercial vem do CRM (carteira do cliente) — nunca do setor
    // (`responsibleArea` = FINANCEIRO / FATURAMENTO / …). O loader Prisma injeta
    // `fact.commercialResponsibleName` a partir de `CrmCustomerCommercialOwner`.
    if (!commercialResponsibleName && fact.commercialResponsibleName?.trim()) {
      commercialResponsibleName = fact.commercialResponsibleName.trim();
    }
    if (!operationalResponsibleArea && fact.responsibleArea?.trim()) {
      operationalResponsibleArea = fact.responsibleArea.trim();
    }
    if (fact.productCode?.trim()) {
      productTokens.add(fact.productCode.trim().toLowerCase());
    }
    if (fact.sku?.trim()) {
      productTokens.add(fact.sku.trim().toLowerCase());
    }
    if (orderNetValue == null && fact.orderNetValue != null && Number.isFinite(fact.orderNetValue)) {
      orderNetValue = fact.orderNetValue;
    }
    if (!temperature && fact.temperature) temperature = fact.temperature;
    if (confidenceScore == null && fact.confidenceScore != null) {
      confidenceScore = fact.confidenceScore;
    }
    if (!recommendedAction && fact.recommendedAction) {
      recommendedAction = fact.recommendedAction;
    }
    if (fact.hasOverdueReceivable) hasOverdueReceivable = true;
    if (fact.hasDeliveryDelay) hasDeliveryDelay = true;
    if (fact.hasMissingStockDocument) hasMissingStockDocument = true;
    if (fact.hasPaymentConditionMissing) hasPaymentConditionMissing = true;

    const itemKey = itemKeyOf(fact);
    const itemValue =
      fact.orderItemTotalValue != null && Number.isFinite(fact.orderItemTotalValue)
        ? Math.max(0, fact.orderItemTotalValue)
        : null;

    if (itemValue != null) {
      if (!itemOrderValues.has(itemKey)) {
        itemOrderValues.set(itemKey, itemValue);
      }
    }

    const cutFact = isCutLine(fact);

    if (isCanceledOrderItemFact(fact)) {
      if (!seenCanceledItems.has(itemKey)) {
        seenCanceledItems.add(itemKey);
        canceledItemsCount += 1;
        if (itemValue != null && !canceledItemValues.has(itemKey)) {
          canceledItemValues.set(itemKey, itemValue);
        }
      }
    } else if (cutFact) {
      if (!seenCutItems.has(itemKey)) {
        seenCutItems.add(itemKey);
        cutItemsCount += 1;
        if (itemValue != null && !cutItemValues.has(itemKey)) {
          cutItemValues.set(itemKey, itemValue);
        }
      }
    } else if (itemValue != null && !activeItemValues.has(itemKey)) {
      activeItemValues.set(itemKey, itemValue);
    }

    if (isActivePendingLine(fact)) {
      if (!seenPendingActiveItems.has(itemKey)) {
        seenPendingActiveItems.add(itemKey);
        pendingActiveItemsCount += 1;
      }
      continue;
    }

    if (isCanceledPendingLine(fact)) {
      continue;
    }

    // Linhas de corte também encerram saldo — não entram como pendência/alocação.
    if (cutFact) {
      continue;
    }

    // CR / NF título — nunca de PENDING
    receivableTotal = Math.max(receivableTotal, fact.receivableTotalValue ?? 0);
    receivableOpen = Math.max(receivableOpen, fact.receivableOpenValue ?? 0);
    receivableReceived = Math.max(receivableReceived, fact.receivableReceivedValue ?? 0);
    nfeHeaderMax = Math.max(nfeHeaderMax, fact.nfeHeaderValue ?? 0);

    if (isAllocatedLine(fact)) {
      if (!seenFulfilledItems.has(itemKey)) {
        seenFulfilledItems.add(itemKey);
        allocatedItemCount += 1;
      }
      allocatedOrderValue += Math.max(0, fact.allocatedValueByOrderPrice ?? 0);
      if (itemValue != null && !activeItemValues.has(itemKey)) {
        activeItemValues.set(itemKey, itemValue);
      }
    }

    lineBilledValue += resolveFactLineBilledValue(fact);
  }

  let itemValuesSum = 0;
  for (const v of itemOrderValues.values()) itemValuesSum += v;

  let canceledOrderValue = 0;
  for (const v of canceledItemValues.values()) canceledOrderValue += v;
  canceledOrderValue = round6(canceledOrderValue);

  let cutValue = 0;
  for (const v of cutItemValues.values()) cutValue += v;
  cutValue = round6(cutValue);

  let activeFromItems = 0;
  for (const v of activeItemValues.values()) activeFromItems += v;

  /**
   * Estratégia segura do valor do pedido:
   * - Preferir orderNetValue (1× no Fact)
   * - Senão soma dedupe por item
   * - Nunca usar soma de nfeHeaderValue / CR
   */
  const originalOrderValue = round6(
    orderNetValue != null && orderNetValue > 0 ? orderNetValue : itemValuesSum
  );
  const totalOrderValue = originalOrderValue;

  /**
   * Valor ativo = original − cancelados − cortados.
   * Fallback: soma dos itens ativos quando não há orderNet confiável.
   */
  const activeOrderValue = round6(
    orderNetValue != null && orderNetValue > 0
      ? Math.max(0, originalOrderValue - canceledOrderValue - cutValue)
      : activeFromItems > MONEY_EPS
        ? activeFromItems
        : Math.max(0, originalOrderValue - canceledOrderValue - cutValue)
  );

  // Atendido respeita teto dos itens ativos (não deixa excedente inflar carteira)
  const allocatedCapped = round6(
    activeOrderValue > 0
      ? Math.min(allocatedOrderValue, activeOrderValue)
      : allocatedOrderValue
  );

  // Saldo pendente ativo = valor ativo − atendido (nunca negativo).
  const pendingActiveOrderValue = round6(
    Math.max(0, activeOrderValue - allocatedCapped)
  );

  const billed = round6(lineBilledValue);
  const fulfillmentPercentActive =
    activeOrderValue > MONEY_EPS
      ? round2(Math.min(100, (allocatedCapped / activeOrderValue) * 100))
      : allocatedCapped > MONEY_EPS
        ? 100
        : 0;

  const classified = classifyOrderStatus(orderFacts, options);
  const hasMissingSeller = isMissingSellerName(orderSellerName);
  const hasMissingCommercialResponsible = !(commercialResponsibleName ?? "").trim();
  const alerts = [...classified.alerts];
  if (hasMissingSeller && !alerts.includes("SEM_VENDEDOR_NOMUS")) {
    alerts.push("SEM_VENDEDOR_NOMUS");
  }
  if (
    hasMissingCommercialResponsible &&
    !alerts.includes("SEM_RESPONSAVEL_COMERCIAL")
  ) {
    alerts.push("SEM_RESPONSAVEL_COMERCIAL");
  }
  if (classified.hasCanceledItems && !alerts.includes("PEDIDO_COM_ITENS_CANCELADOS")) {
    alerts.push("PEDIDO_COM_ITENS_CANCELADOS");
  }
  const hasCanceledInvoice =
    alerts.includes("NFE_CANCELED_LINKED_TO_ORDER") ||
    classified.fiscalStatus === "NFE_CANCELLED";
  const hasValidInvoice =
    nfeNumbers.size > 0 && classified.fiscalStatus !== "NFE_CANCELLED";
  const canceledInvoiceCount = hasCanceledInvoice ? 1 : 0;
  const validInvoiceCount = hasValidInvoice ? Math.max(1, nfeNumbers.size - canceledInvoiceCount) : 0;
  if (hasCanceledInvoice && !alerts.includes("NFE_CANCELED_LINKED_TO_ORDER")) {
    alerts.push("NFE_CANCELED_LINKED_TO_ORDER");
  }
  const hasReceivedCrLinkedToCanceledNfe =
    alerts.includes("RECEIVED_CR_LINKED_TO_CANCELED_NFE") ||
    (hasCanceledInvoice &&
      classified.hasReceived &&
      alerts.includes("CANCELED_NFE_WITH_RECEIVABLE"));
  if (
    hasReceivedCrLinkedToCanceledNfe &&
    !alerts.includes("RECEIVED_CR_LINKED_TO_CANCELED_NFE")
  ) {
    alerts.push("RECEIVED_CR_LINKED_TO_CANCELED_NFE");
  }
  if (
    hasCanceledInvoice &&
    (classified.hasReceived || classified.hasOpenCr) &&
    !alerts.includes("CANCELED_NFE_WITH_RECEIVABLE")
  ) {
    alerts.push("CANCELED_NFE_WITH_RECEIVABLE");
  }
  alerts.sort();

  return {
    orderKey,
    salesOrderId,
    orderCode,
    orderIssueDate: toIso(orderIssueDate),
    orderExpectedDeliveryDate: toIso(orderExpectedDeliveryDate),
    customerName,
    externalCustomerId,
    commercialResponsibleName,
    orderSellerName,
    operationalResponsibleArea,
    totalOrderValue,
    originalOrderValue,
    activeOrderValue,
    canceledOrderValue,
    cutOrderValue: cutValue,
    allocatedOrderValue: allocatedCapped,
    lineBilledValue: billed,
    pendingOrderValue: pendingActiveOrderValue,
    pendingActiveOrderValue,
    fulfillmentPercent: fulfillmentPercentActive,
    fulfillmentPercentActive,
    receivableTotalValue: round6(receivableTotal),
    receivableOpenValue: round6(receivableOpen),
    receivableReceivedValue: round6(receivableReceived),
    operationalStatus: classified.operationalStatus,
    fiscalStatus: classified.fiscalStatus,
    financialStatus: classified.financialStatus,
    consolidatedOrderStatus: classified.consolidatedOrderStatus,
    temperature,
    confidenceScore,
    alerts,
    recommendedAction,
    factCount: orderFacts.length,
    pendingItemCount: pendingActiveItemsCount,
    pendingActiveItemsCount,
    allocatedItemCount,
    fulfilledItemsCount: allocatedItemCount,
    canceledItemsCount,
    cutItemsCount,
    hasPendingItems: classified.hasPendingItems,
    hasCanceledItems: classified.hasCanceledItems,
    hasAllocation: classified.hasAllocation,
    hasOpenCr: classified.hasOpenCr,
    hasReceived: classified.hasReceived,
    hasDivergences: classified.hasDivergences,
    hasOverdueReceivable,
    hasDeliveryDelay,
    hasMissingStockDocument,
    hasPaymentConditionMissing,
    hasMissingSeller,
    hasMissingCommercialResponsible,
    productTokens: [...productTokens].sort(),
    nfeNumbers: [...nfeNumbers].sort(),
    stockDocumentExternalIds: [...stockDocumentExternalIds].sort((a, b) => a - b),
    nfeHeaderMaxValue: round6(nfeHeaderMax),
    validInvoiceCount,
    canceledInvoiceCount,
    hasValidInvoice,
    hasCanceledInvoice,
    hasReceivedCrLinkedToCanceledNfe,
    billingStatus: classified.fiscalStatus,
    searchMatchedBy: null,
    searchMatchedText: null,
  };
}

export function aggregateFactsToOrderStatusRows(
  facts: readonly PortfolioOrderStatusFact[],
  options?: { asOf?: Date | string | null }
): PortfolioOrderStatusRow[] {
  const byOrder = new Map<string, PortfolioOrderStatusFact[]>();
  for (const fact of facts) {
    const key = orderKeyOf(fact);
    const list = byOrder.get(key);
    if (list) list.push(fact);
    else byOrder.set(key, [fact]);
  }
  const rows: PortfolioOrderStatusRow[] = [];
  for (const group of byOrder.values()) {
    rows.push(aggregateOrderFactsToRow(group, options));
  }
  rows.sort((a, b) => {
    const c = (a.orderCode ?? "").localeCompare(b.orderCode ?? "", "pt-BR");
    if (c !== 0) return c;
    return (a.salesOrderId ?? "").localeCompare(b.salesOrderId ?? "");
  });
  return rows;
}

export function buildOrderStatusSummary(
  rows: readonly PortfolioOrderStatusRow[]
): PortfolioOrderStatusSummary {
  const statusCounts = EMPTY_STATUS_COUNTS();
  let totalOrderValue = 0;
  let totalAllocatedValue = 0;
  let totalLineBilledValue = 0;
  let totalPendingValue = 0;
  let totalCanceledValue = 0;
  let totalCutValue = 0;
  let totalReceivableValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let withDivergences = 0;
  let withOpenCr = 0;
  let withReceived = 0;
  let withCanceledItems = 0;
  let withCutItems = 0;
  let canceledItemsCount = 0;
  let cutItemsCount = 0;

  for (const row of rows) {
    statusCounts[row.consolidatedOrderStatus] += 1;
    totalOrderValue += row.totalOrderValue;
    totalAllocatedValue += row.allocatedOrderValue;
    totalLineBilledValue += row.lineBilledValue;
    totalPendingValue += row.pendingActiveOrderValue;
    totalCanceledValue += row.canceledOrderValue;
    totalCutValue += row.cutOrderValue ?? 0;
    totalReceivableValue += row.receivableTotalValue;
    totalReceivedValue += row.receivableReceivedValue;
    totalOpenValue += row.receivableOpenValue;
    if (row.hasDivergences) withDivergences += 1;
    if (row.hasOpenCr) withOpenCr += 1;
    if (row.hasReceived) withReceived += 1;
    if (row.hasCanceledItems) {
      withCanceledItems += 1;
      canceledItemsCount += row.canceledItemsCount;
    }
    if ((row.cutItemsCount ?? 0) > 0) {
      withCutItems += 1;
      cutItemsCount += row.cutItemsCount ?? 0;
    }
  }

  return {
    totalOrders: rows.length,
    totalOrderValue: round6(totalOrderValue),
    totalAllocatedValue: round6(totalAllocatedValue),
    totalLineBilledValue: round6(totalLineBilledValue),
    totalPendingValue: round6(totalPendingValue),
    totalCanceledValue: round6(totalCanceledValue),
    totalCutValue: round6(totalCutValue),
    totalReceivableValue: round6(totalReceivableValue),
    totalReceivedValue: round6(totalReceivedValue),
    totalOpenValue: round6(totalOpenValue),
    statusCounts,
    withDivergences,
    withOpenCr,
    withReceived,
    withCanceledItems,
    withCutItems,
    cutItemsCount,
    canceledItemsCount,
    summarySource: "aggregated_orders",
    crAggregation: "max_per_order_excluding_pending_lines",
    lineBilledRule: "item_evidence_only",
  };
}

const COMPLETO = new Set<PortfolioOrderStatusConsolidated>([
  "COMPLETO_RECEBIDO",
  "COMPLETO_CR_ABERTO",
  "COMPLETO_SEM_CR",
  "COMPLETO_COM_CANCELAMENTO",
  "RECEBIDO_COM_CANCELAMENTO",
]);
const PARCIAL = new Set<PortfolioOrderStatusConsolidated>([
  "PARCIAL_RECEBIDO",
  "PARCIAL_CR_ABERTO",
  "PARCIAL_SEM_CR",
  "PARCIAL_COM_CANCELAMENTO",
]);
const SEM_ATEND = new Set<PortfolioOrderStatusConsolidated>([
  "SEM_ATENDIMENTO_FUTURO",
  "SEM_ATENDIMENTO_ATRASADO",
]);
const RECEBIDOS = new Set<PortfolioOrderStatusConsolidated>([
  "COMPLETO_RECEBIDO",
  "PARCIAL_RECEBIDO",
  "RECEBIDO_COM_CANCELAMENTO",
]);

export function buildPrimaryCards(
  rows: readonly PortfolioOrderStatusRow[]
): PortfolioOrderStatusPrimaryCard[] {
  const totalOrders = rows.length;
  const percentOfTotal = (count: number) =>
    totalOrders === 0 ? 0 : Math.round((count / totalOrders) * 1000) / 10;

  const aggregate = (pred: (r: PortfolioOrderStatusRow) => boolean) => {
    let count = 0;
    let totalOrderValue = 0;
    for (const row of rows) {
      if (!pred(row)) continue;
      count += 1;
      totalOrderValue += row.totalOrderValue;
    }
    return {
      count,
      totalOrderValue,
      percentOfTotal: percentOfTotal(count),
    };
  };

  const card = (
    id: PortfolioOrderStatusPrimaryCardId,
    label: string,
    tone: PortfolioOrderStatusPrimaryCard["tone"],
    pred: (r: PortfolioOrderStatusRow) => boolean
  ): PortfolioOrderStatusPrimaryCard => ({
    id,
    label,
    tone,
    hint: PORTFOLIO_ORDER_STATUS_PRIMARY_CARD_HINTS[id],
    ...aggregate(pred),
  });

  return [
    card("total", "Total de pedidos", "neutral", () => true),
    card("completos", "Completos", "green", (r) =>
      COMPLETO.has(r.consolidatedOrderStatus)
    ),
    card("parciais", "Parciais", "amber", (r) =>
      PARCIAL.has(r.consolidatedOrderStatus)
    ),
    card("sem_atendimento", "Sem atendimento", "gray", (r) =>
      SEM_ATEND.has(r.consolidatedOrderStatus)
    ),
    card("com_divergencia", "Com divergência", "orange", (r) =>
      r.hasDivergences
    ),
    card("cr_aberto", "CR aberto", "blue", (r) => r.hasOpenCr),
    card(
      "recebidos",
      "Recebidos",
      "green",
      (r) => RECEBIDOS.has(r.consolidatedOrderStatus) || r.hasReceived
    ),
    card(
      "com_cancelamento",
      "Com cancelamento",
      "gray",
      (r) => r.hasCanceledItems
    ),
    card(
      "bloqueados",
      "Bloqueados",
      "red",
      (r) => r.consolidatedOrderStatus === "BLOQUEADO_REVISAO"
    ),
  ];
}

export function buildDrilldownCards(
  rows: readonly PortfolioOrderStatusRow[],
  selectedCard: PortfolioOrderStatusPrimaryCardId | null | undefined
): PortfolioOrderStatusDrilldownCard[] {
  const card =
    selectedCard && selectedCard !== "total" ? selectedCard : null;
  const scoped = card
    ? rows.filter((r) => matchesSelectedCard(r, card))
    : rows;
  const parent = card;
  const count = (pred: (r: PortfolioOrderStatusRow) => boolean) =>
    scoped.reduce((n, r) => n + (pred(r) ? 1 : 0), 0);
  const dd = (
    id: string,
    label: string,
    pred: (r: PortfolioOrderStatusRow) => boolean,
    hint?: string
  ): PortfolioOrderStatusDrilldownCard => ({
    id,
    parentCardId: parent,
    label,
    count: count(pred),
    hint: hint ?? label,
  });

  if (!card) {
    return [
      dd("com_item_pendente", "Com item pendente", (r) => r.hasPendingItems),
      dd(
        "com_cancelamento",
        "Com cancelamento",
        (r) => r.hasCanceledItems,
        "Pedidos com pelo menos um item cancelado."
      ),
      dd(
        "itens_cancelados",
        "Itens cancelados",
        (r) => r.canceledItemsCount > 0,
        "Pedidos que possuem itens cancelados no pedido de venda."
      ),
      dd(
        "valor_cancelado",
        "Com valor cancelado",
        (r) => r.canceledOrderValue > MONEY_EPS,
        "Pedidos com valor de itens cancelados > 0."
      ),
      dd("com_produto_fora", "Com produto fora", (r) =>
        r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
      ),
      dd("com_excedente", "Com excedente", (r) =>
        r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
      ),
      dd(
        "nf_sem_cr",
        "NF sem CR",
        (r) => r.consolidatedOrderStatus === "NF_SEM_CR"
      ),
      dd("cr_vencido", "CR vencido", (r) => isCrOverdue(r)),
      dd("sem_vendedor_nomus", "Sem vendedor Nomus", (r) => r.hasMissingSeller),
      dd(
        "sem_responsavel_comercial",
        "Sem responsável comercial",
        (r) => r.hasMissingCommercialResponsible
      ),
      dd("entrega_vencida", "Entrega vencida", (r) => isDeliveryOverdue(r)),
    ];
  }

  switch (card) {
    case "completos":
      return [
        dd(
          "completo_recebido",
          "Completos e recebidos",
          (r) => r.consolidatedOrderStatus === "COMPLETO_RECEBIDO"
        ),
        dd(
          "completo_cr_aberto",
          "Completos com CR aberto",
          (r) => r.consolidatedOrderStatus === "COMPLETO_CR_ABERTO"
        ),
        dd(
          "completo_sem_cr",
          "Completos sem CR",
          (r) => r.consolidatedOrderStatus === "COMPLETO_SEM_CR"
        ),
        dd(
          "completo_com_cancelamento",
          "Completos com cancelamento",
          (r) =>
            r.consolidatedOrderStatus === "COMPLETO_COM_CANCELAMENTO" ||
            r.consolidatedOrderStatus === "RECEBIDO_COM_CANCELAMENTO"
        ),
        dd(
          "completo_divergencia_preco",
          "Completos com divergência de preço",
          (r) => r.alerts.includes("DIVERGENCIA_PRECO")
        ),
        dd("completo_excesso", "Completos com excesso", (r) =>
          r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
        ),
        dd(
          "completo_sem_alerta",
          "Completos sem alerta",
          (r) => !r.hasDivergences && !isDeliveryOverdue(r) && !isCrOverdue(r)
        ),
      ];
    case "parciais":
      return [
        dd(
          "parcial_item_pendente",
          "Parcial com item pendente",
          (r) => r.hasPendingItems
        ),
        dd(
          "parcial_com_cancelamento",
          "Parcial com cancelamento",
          (r) => r.consolidatedOrderStatus === "PARCIAL_COM_CANCELAMENTO"
        ),
        dd("parcial_excesso", "Parcial com excesso", (r) =>
          r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
        ),
        dd("parcial_produto_fora", "Parcial com produto fora", (r) =>
          r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
        ),
        dd(
          "parcial_cr_aberto",
          "Parcial com CR aberto",
          (r) => r.consolidatedOrderStatus === "PARCIAL_CR_ABERTO" || r.hasOpenCr
        ),
        dd(
          "parcial_recebido",
          "Parcial já recebido",
          (r) =>
            r.consolidatedOrderStatus === "PARCIAL_RECEBIDO" ||
            (r.hasReceived && !r.hasOpenCr)
        ),
        dd(
          "parcial_sem_cr",
          "Parcial sem CR",
          (r) =>
            r.consolidatedOrderStatus === "PARCIAL_SEM_CR" ||
            r.receivableTotalValue <= MONEY_EPS
        ),
        dd("parcial_entrega_vencida", "Parcial com entrega vencida", (r) =>
          isDeliveryOverdue(r)
        ),
      ];
    case "sem_atendimento":
      return [
        dd(
          "sem_documento_saida",
          "Sem documento de saída",
          (r) => r.hasMissingStockDocument || !r.hasAllocation
        ),
        dd("sem_nf", "Sem NF", (r) => r.nfeNumbers.length === 0),
        dd(
          "sem_cr",
          "Sem CR",
          (r) => r.receivableTotalValue <= MONEY_EPS
        ),
        dd(
          "entrega_futura",
          "Entrega futura",
          (r) => r.consolidatedOrderStatus === "SEM_ATENDIMENTO_FUTURO"
        ),
        dd(
          "entrega_vencida_sem_atendimento",
          "Entrega vencida",
          (r) =>
            r.consolidatedOrderStatus === "SEM_ATENDIMENTO_ATRASADO" ||
            isDeliveryOverdue(r)
        ),
        dd(
          "cliente_sem_responsavel",
          "Cliente sem responsável",
          (r) => r.hasMissingCommercialResponsible
        ),
        dd(
          "pedido_sem_vendedor_nomus",
          "Pedido sem vendedor Nomus",
          (r) => r.hasMissingSeller
        ),
      ];
    case "com_divergencia":
      return [
        dd(
          "documento_excedente",
          "Documento com excedente",
          (r) => r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
        ),
        dd(
          "produto_fora_pedido",
          "Produto fora do pedido",
          (r) => r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
        ),
        dd("nf_maior_pedido", "NF maior que pedido", (r) =>
          r.alerts.includes("NF_CABECALHO_MAIOR_PEDIDO")
        ),
        dd("divergencia_preco", "Divergência de preço", (r) =>
          r.alerts.includes("DIVERGENCIA_PRECO")
        ),
        dd("documento_sem_cr", "Documento sem CR", (r) =>
          r.alerts.includes("DOCUMENTO_SEM_CR")
        ),
        dd("cr_vencido", "CR vencido", (r) => isCrOverdue(r)),
        dd(
          "condicao_pagamento_ausente",
          "Condição de pagamento ausente",
          (r) =>
            r.hasPaymentConditionMissing ||
            r.alerts.includes("SEM_CONDICAO_PAGAMENTO")
        ),
      ];
    case "cr_aberto":
      return [
        dd("cr_aberto_a_vencer", "CR aberto a vencer", (r) => isCrAVencer(r)),
        dd("cr_vencido", "CR vencido", (r) => isCrOverdue(r)),
        dd("cr_parcialmente_recebido", "CR parcialmente recebido", (r) =>
          isCrPartiallyReceived(r)
        ),
        dd("cr_aberto_pedido_completo", "CR aberto com pedido completo", (r) =>
          COMPLETO.has(r.consolidatedOrderStatus)
        ),
        dd("cr_aberto_pedido_parcial", "CR aberto com pedido parcial", (r) =>
          PARCIAL.has(r.consolidatedOrderStatus)
        ),
        dd(
          "cr_aberto_sem_documento_seguro",
          "CR aberto sem documento seguro",
          (r) => isCrWithoutSafeDocument(r)
        ),
      ];
    case "recebidos":
      return [
        dd(
          "recebido_sem_alerta",
          "Recebido sem alerta",
          (r) => !r.hasDivergences && !isDeliveryOverdue(r) && !isCrOverdue(r)
        ),
        dd(
          "recebido_divergencia_operacional",
          "Recebido com divergência operacional",
          (r) => r.hasDivergences
        ),
        dd("recebido_pedido_parcial", "Recebido com pedido parcial", (r) =>
          PARCIAL.has(r.consolidatedOrderStatus)
        ),
        dd("recebido_excesso", "Recebido com excesso", (r) =>
          r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
        ),
        dd("recebido_produto_fora", "Recebido com produto fora", (r) =>
          r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
        ),
        dd("recebido_com_atraso", "Recebido com atraso", (r) =>
          isDeliveryOverdue(r)
        ),
      ];
    case "bloqueados":
      return [
        dd(
          "pedido_antigo_sem_evolucao",
          "Pedido antigo sem evolução",
          (r) => r.alerts.includes("PEDIDO_ANTIGO_SEM_EVOLUCAO")
        ),
        dd(
          "entrega_vencida_sem_documento",
          "Entrega vencida sem documento",
          (r) =>
            isDeliveryOverdue(r) &&
            (r.hasMissingStockDocument || !r.hasAllocation)
        ),
        dd("pedido_sem_nf", "Pedido sem NF", (r) => r.nfeNumbers.length === 0),
        dd(
          "pedido_sem_cr",
          "Pedido sem CR",
          (r) => r.receivableTotalValue <= MONEY_EPS
        ),
        dd(
          "pedido_sem_responsavel",
          "Pedido sem responsável comercial",
          (r) => r.hasMissingCommercialResponsible
        ),
        dd(
          "pedido_sem_vendedor",
          "Pedido sem vendedor Nomus",
          (r) => r.hasMissingSeller
        ),
        dd(
          "pedido_vinculo_inconsistente",
          "Pedido com vínculo inconsistente",
          (r) =>
            r.alerts.includes("CR_SEM_RATEIO_SEGURO") ||
            (r.hasDivergences && r.hasMissingStockDocument)
        ),
      ];
    case "com_cancelamento":
      return [
        dd(
          "recebido_com_cancelamento",
          "Recebido com cancelamento",
          (r) => r.consolidatedOrderStatus === "RECEBIDO_COM_CANCELAMENTO"
        ),
        dd(
          "completo_com_cancelamento",
          "Completo com cancelamento",
          (r) => r.consolidatedOrderStatus === "COMPLETO_COM_CANCELAMENTO"
        ),
        dd(
          "parcial_com_cancelamento",
          "Parcial com cancelamento",
          (r) => r.consolidatedOrderStatus === "PARCIAL_COM_CANCELAMENTO"
        ),
        dd(
          "itens_cancelados",
          "Com itens cancelados",
          (r) => r.canceledItemsCount > 0
        ),
        dd(
          "valor_cancelado",
          "Com valor cancelado",
          (r) => r.canceledOrderValue > MONEY_EPS
        ),
      ];
    default:
      return [];
  }
}

function isCrOverdue(row: PortfolioOrderStatusRow): boolean {
  return (
    row.hasOpenCr &&
    (row.hasOverdueReceivable || row.alerts.includes("CR_VENCIDO"))
  );
}

function isCrAVencer(row: PortfolioOrderStatusRow): boolean {
  return row.hasOpenCr && !isCrOverdue(row);
}

function isCrPartiallyReceived(row: PortfolioOrderStatusRow): boolean {
  return (
    row.hasOpenCr &&
    row.receivableReceivedValue > MONEY_EPS &&
    row.receivableOpenValue > MONEY_EPS
  );
}

function isCrWithoutSafeDocument(row: PortfolioOrderStatusRow): boolean {
  return (
    row.hasOpenCr &&
    (!row.hasAllocation ||
      row.hasMissingStockDocument ||
      row.alerts.includes("CR_SEM_RATEIO_SEGURO") ||
      row.alerts.includes("DOCUMENTO_SEM_CR"))
  );
}

function isDeliveryOverdue(row: PortfolioOrderStatusRow): boolean {
  return row.hasDeliveryDelay || row.alerts.includes("ENTREGA_VENCIDA");
}

function matchesSelectedCard(
  row: PortfolioOrderStatusRow,
  card: PortfolioOrderStatusPrimaryCardId
): boolean {
  switch (card) {
    case "total":
      return true;
    case "completos":
      return COMPLETO.has(row.consolidatedOrderStatus);
    case "parciais":
      return PARCIAL.has(row.consolidatedOrderStatus);
    case "sem_atendimento":
      return SEM_ATEND.has(row.consolidatedOrderStatus);
    case "com_divergencia":
      return row.hasDivergences;
    case "cr_aberto":
      return row.hasOpenCr;
    case "recebidos":
      return RECEBIDOS.has(row.consolidatedOrderStatus) || row.hasReceived;
    case "com_cancelamento":
      return row.hasCanceledItems;
    case "bloqueados":
      return row.consolidatedOrderStatus === "BLOQUEADO_REVISAO";
    default:
      return true;
  }
}

function matchesSelectedDrilldown(
  row: PortfolioOrderStatusRow,
  drilldown: string
): boolean {
  switch (drilldown) {
    case "com_item_pendente":
    case "parcial_item_pendente":
      return row.hasPendingItems;
    case "com_cancelamento":
    case "itens_cancelados":
    case "completo_com_cancelamento":
    case "parcial_com_cancelamento":
    case "recebido_com_cancelamento":
    case "valor_cancelado":
      if (drilldown === "recebido_com_cancelamento") {
        return row.consolidatedOrderStatus === "RECEBIDO_COM_CANCELAMENTO";
      }
      if (drilldown === "completo_com_cancelamento") {
        return (
          row.consolidatedOrderStatus === "COMPLETO_COM_CANCELAMENTO" ||
          row.consolidatedOrderStatus === "RECEBIDO_COM_CANCELAMENTO"
        );
      }
      if (drilldown === "parcial_com_cancelamento") {
        return row.consolidatedOrderStatus === "PARCIAL_COM_CANCELAMENTO";
      }
      if (drilldown === "valor_cancelado") {
        return row.canceledOrderValue > MONEY_EPS;
      }
      return row.hasCanceledItems;
    case "com_produto_fora":
    case "parcial_produto_fora":
    case "produto_fora_pedido":
    case "recebido_produto_fora":
      return row.alerts.includes("PRODUTO_FORA_DO_PEDIDO");
    case "com_excedente":
    case "parcial_excesso":
    case "completo_excesso":
    case "documento_excedente":
    case "recebido_excesso":
      return row.alerts.includes("DOCUMENTO_COM_EXCEDENTE");
    case "nf_sem_cr":
      return row.consolidatedOrderStatus === "NF_SEM_CR";
    case "cr_vencido":
      return isCrOverdue(row);
    case "sem_vendedor_nomus":
    case "pedido_sem_vendedor_nomus":
    case "pedido_sem_vendedor":
      return row.hasMissingSeller;
    case "sem_responsavel_comercial":
    case "cliente_sem_responsavel":
    case "pedido_sem_responsavel":
      return row.hasMissingCommercialResponsible;
    case "entrega_vencida":
    case "parcial_entrega_vencida":
    case "recebido_com_atraso":
      return isDeliveryOverdue(row);
    case "entrega_vencida_sem_atendimento":
      return (
        row.consolidatedOrderStatus === "SEM_ATENDIMENTO_ATRASADO" ||
        isDeliveryOverdue(row)
      );
    case "completo_recebido":
      return row.consolidatedOrderStatus === "COMPLETO_RECEBIDO";
    case "completo_cr_aberto":
      return row.consolidatedOrderStatus === "COMPLETO_CR_ABERTO";
    case "completo_sem_cr":
      return row.consolidatedOrderStatus === "COMPLETO_SEM_CR";
    case "completo_divergencia_preco":
    case "divergencia_preco":
      return row.alerts.includes("DIVERGENCIA_PRECO");
    case "completo_sem_alerta":
    case "recebido_sem_alerta":
      return !row.hasDivergences && !isDeliveryOverdue(row) && !isCrOverdue(row);
    case "parcial_cr_aberto":
      return row.consolidatedOrderStatus === "PARCIAL_CR_ABERTO" || row.hasOpenCr;
    case "parcial_recebido":
      return (
        row.consolidatedOrderStatus === "PARCIAL_RECEBIDO" ||
        (row.hasReceived && !row.hasOpenCr)
      );
    case "parcial_sem_cr":
      return (
        row.consolidatedOrderStatus === "PARCIAL_SEM_CR" ||
        row.receivableTotalValue <= MONEY_EPS
      );
    case "sem_documento_saida":
      return row.hasMissingStockDocument || !row.hasAllocation;
    case "sem_nf":
    case "pedido_sem_nf":
      return row.nfeNumbers.length === 0;
    case "sem_cr":
    case "pedido_sem_cr":
      return row.receivableTotalValue <= MONEY_EPS;
    case "entrega_futura":
    case "sem_futuro":
      return row.consolidatedOrderStatus === "SEM_ATENDIMENTO_FUTURO";
    case "sem_atrasado":
      return row.consolidatedOrderStatus === "SEM_ATENDIMENTO_ATRASADO";
    case "nf_maior_pedido":
      return row.alerts.includes("NF_CABECALHO_MAIOR_PEDIDO");
    case "documento_sem_cr":
      return row.alerts.includes("DOCUMENTO_SEM_CR");
    case "condicao_pagamento_ausente":
      return (
        row.hasPaymentConditionMissing ||
        row.alerts.includes("SEM_CONDICAO_PAGAMENTO")
      );
    case "cr_aberto_a_vencer":
      return isCrAVencer(row);
    case "cr_parcialmente_recebido":
      return isCrPartiallyReceived(row);
    case "cr_aberto_pedido_completo":
      return COMPLETO.has(row.consolidatedOrderStatus);
    case "cr_aberto_pedido_parcial":
      return PARCIAL.has(row.consolidatedOrderStatus);
    case "cr_aberto_sem_documento_seguro":
      return isCrWithoutSafeDocument(row);
    case "recebido_divergencia_operacional":
      return row.hasDivergences;
    case "recebido_pedido_parcial":
      return PARCIAL.has(row.consolidatedOrderStatus);
    case "pedido_antigo_sem_evolucao":
    case "bloqueado_revisao":
      return (
        row.consolidatedOrderStatus === "BLOQUEADO_REVISAO" ||
        row.alerts.includes("PEDIDO_ANTIGO_SEM_EVOLUCAO")
      );
    case "entrega_vencida_sem_documento":
      return (
        isDeliveryOverdue(row) &&
        (row.hasMissingStockDocument || !row.hasAllocation)
      );
    case "pedido_vinculo_inconsistente":
      return (
        row.alerts.includes("CR_SEM_RATEIO_SEGURO") ||
        (row.hasDivergences && row.hasMissingStockDocument)
      );
    case "excesso":
    case "fora_pedido":
    case "preco":
    case "cancelados":
      // aliases legados
      if (drilldown === "excesso")
        return row.alerts.includes("DOCUMENTO_COM_EXCEDENTE");
      if (drilldown === "fora_pedido")
        return row.alerts.includes("PRODUTO_FORA_DO_PEDIDO");
      if (drilldown === "preco") return row.alerts.includes("DIVERGENCIA_PRECO");
      return row.consolidatedOrderStatus === "CANCELADO" || row.hasCanceledItems;
    default:
      return true;
  }
}

export function applyOrderStatusFilters(
  rows: readonly PortfolioOrderStatusRow[],
  filters: PortfolioOrderStatusFilters | null | undefined
): PortfolioOrderStatusRow[] {
  if (!filters) return [...rows];

  const searchNorm = normalizeOrderStatusSearch(filters.search);

  return rows.flatMap((row) => {
    if (
      filters.customerExternalId != null &&
      row.externalCustomerId !== filters.customerExternalId
    ) {
      return [];
    }
    if (filters.customerName?.trim()) {
      const name = (row.customerName ?? "").toLowerCase();
      if (!name.includes(filters.customerName.trim().toLowerCase())) return [];
    }

    let searchMatchedBy: PortfolioOrderStatusRow["searchMatchedBy"] =
      row.searchMatchedBy ?? null;
    let searchMatchedText: string | null = row.searchMatchedText ?? null;
    if (searchNorm) {
      if (!searchNorm.usable) return [];
      const hit = matchOrderStatusSearch(row, searchNorm);
      if (!hit) return [];
      searchMatchedBy = hit.matchedBy;
      searchMatchedText = hit.matchedText;
    }

    if (filters.sellerName?.trim()) {
      const seller = (row.orderSellerName ?? "").toLowerCase();
      if (!seller.includes(filters.sellerName.trim().toLowerCase())) return [];
    }
    if (filters.responsibleName?.trim()) {
      const resp = (row.commercialResponsibleName ?? "").toLowerCase();
      if (!resp.includes(filters.responsibleName.trim().toLowerCase())) return [];
    }
    if (filters.productOrSku?.trim()) {
      const needle = filters.productOrSku.trim().toLowerCase();
      const hit = row.productTokens.some(
        (t) => t.includes(needle) || needle.includes(t)
      );
      if (!hit) return [];
    }
    if (
      filters.consolidatedStatus &&
      row.consolidatedOrderStatus !== filters.consolidatedStatus
    ) {
      return [];
    }
    if (
      filters.operationalStatus?.trim() &&
      row.operationalStatus !== filters.operationalStatus.trim()
    ) {
      return [];
    }
    if (
      filters.financialStatus?.trim() &&
      row.financialStatus !== filters.financialStatus.trim()
    ) {
      return [];
    }
    if (filters.temperature?.trim()) {
      const wanted = filters.temperature.trim().toUpperCase();
      const rowTemp = (row.temperature ?? "").trim().toUpperCase();
      const normalizedRow =
        rowTemp === "AMARELO" || rowTemp === "AMBAR" || rowTemp === "ÂMBAR"
          ? "MORNO"
          : rowTemp === "VERDE" || rowTemp === "GREEN"
            ? "FRIO"
            : rowTemp === "VERMELHO" || rowTemp === "RED"
              ? "QUENTE"
              : rowTemp;
      if (normalizedRow !== wanted && rowTemp !== wanted) return [];
    }
    if (filters.alert?.trim() && !row.alerts.includes(filters.alert.trim())) {
      return [];
    }
    if (filters.onlyWithDivergences && !row.hasDivergences) return [];
    if (filters.onlyWithOpenCr && !row.hasOpenCr) return [];
    if (filters.onlyWithPendingBalance && row.pendingOrderValue <= MONEY_EPS) {
      return [];
    }

    if (filters.year != null && row.orderIssueDate) {
      const y = new Date(row.orderIssueDate).getFullYear();
      if (y !== filters.year) return [];
    }
    if (filters.from) {
      const from = toDate(filters.from);
      const issue = toDate(row.orderIssueDate);
      if (from && issue && issue.getTime() < from.getTime()) return [];
    }
    if (filters.to) {
      const to = toDate(filters.to);
      const issue = toDate(row.orderIssueDate);
      if (to && issue && issue.getTime() > to.getTime()) return [];
    }

    if (filters.selectedCard && !matchesSelectedCard(row, filters.selectedCard)) {
      return [];
    }
    if (
      filters.selectedDrilldown &&
      !matchesSelectedDrilldown(row, filters.selectedDrilldown)
    ) {
      return [];
    }

    return [
      {
        ...row,
        searchMatchedBy,
        searchMatchedText,
      },
    ];
  });
}

export function sortOrderStatusRows(
  rows: readonly PortfolioOrderStatusRow[],
  sort: PortfolioOrderStatusSort | null | undefined
): PortfolioOrderStatusRow[] {
  const sortBy = sort?.sortBy ?? "orderIssueDate";
  const direction = sort?.sortDirection ?? "desc";
  const mul = direction === "asc" ? 1 : -1;
  const sorted = [...rows];

  const cmpStr = (a: string | null, b: string | null) =>
    (a ?? "").localeCompare(b ?? "", "pt-BR");
  const cmpNum = (a: number, b: number) => a - b;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "orderCode":
        cmp = cmpStr(a.orderCode, b.orderCode);
        break;
      case "orderIssueDate":
        cmp = cmpStr(a.orderIssueDate, b.orderIssueDate);
        break;
      case "orderExpectedDeliveryDate":
        cmp = cmpStr(a.orderExpectedDeliveryDate, b.orderExpectedDeliveryDate);
        break;
      case "customerName":
        cmp = cmpStr(a.customerName, b.customerName);
        break;
      case "orderSellerName":
        cmp = cmpStr(a.orderSellerName, b.orderSellerName);
        break;
      case "totalOrderValue":
        cmp = cmpNum(a.totalOrderValue, b.totalOrderValue);
        break;
      case "allocatedOrderValue":
        cmp = cmpNum(a.allocatedOrderValue, b.allocatedOrderValue);
        break;
      case "lineBilledValue":
        cmp = cmpNum(a.lineBilledValue, b.lineBilledValue);
        break;
      case "pendingOrderValue":
        cmp = cmpNum(a.pendingOrderValue, b.pendingOrderValue);
        break;
      case "fulfillmentPercent":
        cmp = cmpNum(a.fulfillmentPercent, b.fulfillmentPercent);
        break;
      case "receivableTotalValue":
        cmp = cmpNum(a.receivableTotalValue, b.receivableTotalValue);
        break;
      case "receivableOpenValue":
        cmp = cmpNum(a.receivableOpenValue, b.receivableOpenValue);
        break;
      case "receivableReceivedValue":
        cmp = cmpNum(a.receivableReceivedValue, b.receivableReceivedValue);
        break;
      case "consolidatedOrderStatus":
        cmp = cmpStr(a.consolidatedOrderStatus, b.consolidatedOrderStatus);
        break;
      case "temperature":
        cmp = cmpStr(a.temperature, b.temperature);
        break;
      case "confidenceScore":
        cmp = cmpNum(a.confidenceScore ?? 0, b.confidenceScore ?? 0);
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp * mul;
    return cmpStr(a.orderCode, b.orderCode);
  });
  return sorted;
}

/**
 * Orquestra agregação → filtros → sort → cards/summary.
 * Cards/summary usam o universo **após** filtros (pedidos distintos).
 */
export function buildPortfolioOrderStatus(
  input: BuildPortfolioOrderStatusInput
): BuildPortfolioOrderStatusResult {
  const allRows = aggregateFactsToOrderStatusRows(input.facts, {
    asOf: input.asOf,
  });

  const selectedCard =
    input.selectedCard ?? input.filters?.selectedCard ?? null;
  const selectedDrilldown = input.filters?.selectedDrilldown ?? null;

  // Cards/drilldowns no universo dos filtros de query — sem selectedCard.
  // A seleção do card estreita só a tabela (e o summary da página).
  const baseFilters: PortfolioOrderStatusFilters = {
    ...(input.filters ?? {}),
    selectedCard: null,
    selectedDrilldown: null,
  };
  const baseRows = applyOrderStatusFilters(allRows, baseFilters);
  const primaryCards = buildPrimaryCards(baseRows);
  const drilldownCards = buildDrilldownCards(baseRows, selectedCard);

  const filtered = applyOrderStatusFilters(baseRows, {
    selectedCard,
    selectedDrilldown,
  });
  const rows = sortOrderStatusRows(filtered, input.sort ?? null);
  const summary = buildOrderStatusSummary(rows);

  return { rows, primaryCards, drilldownCards, summary };
}
