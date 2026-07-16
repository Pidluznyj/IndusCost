/**
 * Serviço de Auditoria Completa do Pedido — composição read-only.
 *
 * Fontes:
 *   - `SalesOrder` + `Customer` + `SalesOrderItem` (grão linha, com flags Nomus)
 *   - `OrderToCashAuditFact` (evidência item × NF × documento × CR)
 *   - `NomusNfe` (deduplicação e cabeçalho oficial)
 *   - `NomusStockDocument` (documentos de saída)
 *   - `NomusAccountsReceivable` (títulos oficiais — não alterar)
 *   - `PortfolioReconciliationRow`-derived (não usado por padrão; a UI usa apenas o Fact)
 *
 * Regras oficiais respeitadas:
 *   - CR real do Nomus prevalece; deduplicado por `externalId`.
 *   - NF cabeçalho **não** infla carteira sem alerta.
 *   - Item cancelado / cortado / stale → separado em buckets próprios; não vira pendente.
 *   - Status do item é por **linha** do pedido, não por SKU (`SalesOrderItem.id`).
 *   - Nada é gravado nem alterado — read-only.
 */
import { prisma } from "@/src/lib/prisma.js";
import { buildSalesOrderFiscalTaxesPayload } from "@/src/lib/sales-orders/salesOrderFiscalTaxes.server.js";
import { canViewSalesOrderFiscalTaxesFromPermissions } from "@/src/lib/sales-orders/salesOrderFiscalTaxesPermissions.js";
import type { OrderToCashAuditFactRecord } from "./orderToCashAuditApi.js";
import { enrichFactsWithOrderItemStatus } from "./orderToCashFactItemStatusEnrichment.server.js";
import {
  isFulfilledWithCutSalesOrderItem,
  isInactiveSalesOrderItemNomusFlags,
} from "@/src/lib/sales/nomusSalesOrderItemStatus.js";
import { loadManualCommercialOwnersForCustomers } from "@/src/lib/crmCustomerCommercialOwner.js";
import {
  resolveCommercialResponsibleDisplay,
  resolveOrderSellerIdentity,
  toOrderSellerDto,
  type ResolvedCommercialResponsibleDisplay,
  type ResolvedOrderSellerIdentity,
} from "@/src/lib/commercial/orderSellerIdentityResolver.js";
import { loadCommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.server.js";
import { calculateSalesOrderMarginsForOrders } from "@/src/lib/salesOrderMarginService.server.js";
import type { SalesOrderListReceivableInput } from "@/src/lib/salesOrderListPaymentSchedule.js";
import { buildSalesOrderPlannedReceivables } from "./salesOrderPlannedReceivables.js";
import {
  buildLinkedNfeFiscalAmounts,
} from "@/src/lib/sales/orderFiscalFinancialMetrics.js";
import {
  extractNfeCancellationMeta,
  normalizeNfeStatus,
  type NormalizedNfeStatus,
} from "./nfeStatus.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";

const MONEY_TOLERANCE = 0.01;

/** Vencimento CR no cronograma de comissão — YYYY/MM/DD (dia civil). */
function formatReceivableDueDateSlash(
  value: Date | string | null | undefined
): string | null {
  const key = toCivilDateKey(value);
  return key ? key.replace(/-/g, "/") : null;
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in (value as object)) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ---------------------------------------------------------------------- */
/*  Types                                                                  */
/* ---------------------------------------------------------------------- */

export type OrderFullAuditItem = {
  salesOrderItemId: string;
  externalSalesOrderItemId: number | null;
  itemSequence: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  /** ID externo Nomus do Produto (`SalesOrderItem.externalProductId`). */
  productExternalId: number | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalNetValue: number | null;
  nomusItemStatusRaw: string | null;
  nomusItemStatusNormalized: string | null;
  itemStatus: string | null;
  nomusIsCanceled: boolean;
  nomusIsCut: boolean;
  nomusIsStale: boolean;
  nomusQuantityFulfilled: number | null;
  nomusQuantityPending: number | null;
  matchConfidence: string | null;
  proposalItemId: string | null;
  /** ------------------------------------------------------------------ */
  /**  Derivados da aba Itens do Pedido (auditoria)                        */
  /** ------------------------------------------------------------------ */
  /** Quantidade que continua ativa (não cancelada / não stale). */
  activeQuantity: number | null;
  /** Quantidade cancelada oficialmente pelo Nomus. */
  canceledQuantity: number | null;
  /** Saldo cortado (item atendido com corte) — `quantity - nomusQuantityFulfilled` quando `isCut`. */
  cutQuantity: number | null;
  /** Saldo pendente ativo por linha. */
  activePendingQuantity: number | null;
  /** Valor da linha correspondente à parte ativa (sem cancelado/cortado). */
  activeValue: number | null;
  /** Valor da linha cancelado — 0 se linha ativa. */
  canceledValue: number | null;
  /** Valor da linha correspondente ao saldo cortado. */
  cutValue: number | null;
  /** Data de entrega esperada (SalesOrder.expectedDeliveryDate; item específico não existe no schema). */
  expectedDeliveryDate: string | null;
  /** Campos extras do Nomus (payload cru), quando disponíveis. */
  productionQuantity: number | null;
  invoicedQuantity: number | null;
  saldoAFaturar: number | null;
  saldoPronto: number | null;
  movementType: string | null;
  cfop: string | null;
  /** IDs externos deduplicados dos documentos de saída ligados a esta linha. */
  linkedStockDocumentExternalIds: number[];
  /** IDs externos deduplicados de NF-e ligadas a esta linha. */
  linkedNfeExternalIds: number[];
  /** IDs externos deduplicados de Contas a Receber ligados a esta linha. */
  linkedReceivableExternalIds: number[];
  /** Alertas por linha (subset dos códigos de `alerts`). */
  alerts: string[];
};

export type OrderFullAuditReceivable = {
  receivableExternalId: number;
  /** ID interno do CR no IndusCost (`NomusAccountsReceivable.id`). */
  receivableId: string | null;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  /** Data de emissão / criação do CR no Nomus. */
  issueDate: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  scheduleDate: string | null;
  settlementDate: string | null;
  amountReceivable: number | null;
  amountScheduled: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  /** Parcela / total de parcelas (extraído da descrição/rawPayload quando disponível). */
  installmentNumber: number | null;
  totalInstallments: number | null;
  paymentTermsText: string | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  comments: string | null;
  status:
    | "RECEIVED"
    | "PARTIALLY_RECEIVED"
    | "OVERDUE"
    | "OPEN"
    | "UNKNOWN";
  /** Dias em atraso (negativo = faltam dias; positivo = já venceu). */
  daysOverdue: number | null;
  linkedNfeExternalIds: number[];
  /** Status financeiro oficial do CR (não confundir com status fiscal da NF). */
  receivableIsReceived: boolean;
  /** Número da NF vinculada (quando conhecido). */
  linkedNfeNumber: string | null;
  /** Status fiscal normalizado da NF vinculada (label humano). */
  linkedNfeStatusLabel: string | null;
  /** NF vinculada cancelada (status fiscal). */
  linkedNfeIsCanceled: boolean;
  hasCanceledNfeLink: boolean;
  origin: "NFE" | "SOURCE_INVOICE" | "INFERRED" | "UNKNOWN";
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SOURCE_INVOICE"
    | "INFERRED"
    | "UNKNOWN";
  alerts: string[];
  /** Referência oficial usada para "Abrir no Contas a Receber" (search=<ref>). */
  searchReference: string;
};

export type OrderFullAuditNfe = {
  nfeExternalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  dataProcessamento: string | null;
  dataEmissao: string | null;
  status: number | null;
  /** Status bruto (código Nomus ou texto) para auditoria. */
  statusRaw: string | null;
  statusNormalized: NormalizedNfeStatus;
  isCanceled: boolean;
  /** NF autorizada/não cancelada — única que compõe faturamento válido. */
  isValidForBilling: boolean;
  statusLabel: string;
  cancellationDate: string | null;
  cancellationReason: string | null;
  tipoOperacao: number | null;
  /** Produtos líquidos (valorLiquido / vProd−vDesc). */
  valorLiquido: number | null;
  /**
   * Total da NF em base comparável ao pedido (preferência xmlVNF / vNF).
   * Usado em faturamento válido e cards.
   */
  valorTotal: number | null;
  /** Impostos/encargos destacados no total (= max(0, valorTotal − valorLiquido)) quando ambos existem. */
  highlightedTaxesValue: number | null;
  /**
   * Valor atribuído válido ao pedido.
   * NF cancelada: sempre 0 (histórico permanece em `valorTotal` / `nfeCanceledValue`).
   */
  allocatedValueToOrder: number;
  /** Alocação bruta antes de zerar canceladas (auditoria / regressão). */
  allocatedValueToOrderRaw: number;
  /** Valor dos itens da NF que pertencem ao pedido (linkedSalesOrderItemId != null). */
  insideOrderItemsValue: number;
  /** Valor dos itens da NF que NÃO pertencem ao pedido (fora do pedido). */
  outsideOrderItemsValue: number;
  headerGreaterThanOrder: boolean;
  hasReceivable: boolean;
  hasExtraItems: boolean;
  customerName: string | null;
  companyName: string | null;
  linkedStockDocumentExternalIds: number[];
  linkedReceivableExternalIds: number[];
  /** Origem oficial do vínculo com o pedido. */
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SALES_ORDER_NFE_LINK"
    | "UNKNOWN";
  alerts: string[];
};

function emptyNfeStatusFields(): Pick<
  OrderFullAuditNfe,
  | "statusRaw"
  | "statusNormalized"
  | "isCanceled"
  | "isValidForBilling"
  | "statusLabel"
  | "cancellationDate"
  | "cancellationReason"
> {
  return {
    statusRaw: null,
    statusNormalized: "UNKNOWN",
    isCanceled: false,
    isValidForBilling: false,
    statusLabel: "Status desconhecido",
    cancellationDate: null,
    cancellationReason: null,
  };
}

function applyNormalizedNfeStatus(
  entry: OrderFullAuditNfe,
  extras?: {
    xmlCancelamento?: string | null;
    justificativaCancelamento?: string | null;
    rawPayload?: unknown;
  }
): void {
  const normalized = normalizeNfeStatus({
    status: entry.status,
    rawPayload: extras?.rawPayload,
    xmlCancelamento: extras?.xmlCancelamento,
    justificativaCancelamento: extras?.justificativaCancelamento,
  });
  const cancelMeta = extractNfeCancellationMeta({
    justificativaCancelamento: extras?.justificativaCancelamento,
    xmlCancelamento: extras?.xmlCancelamento,
    rawPayload: extras?.rawPayload,
  });
  entry.statusRaw = normalized.statusRaw;
  entry.statusNormalized = normalized.statusNormalized;
  entry.isCanceled = normalized.isCanceled;
  entry.isValidForBilling = normalized.isValidForBilling;
  entry.statusLabel = normalized.label;
  entry.cancellationDate = cancelMeta.cancellationDate;
  entry.cancellationReason = cancelMeta.cancellationReason;
}

export type OrderFullAuditNfeItem = {
  nfeExternalId: number;
  nfeNumber: string | null;
  /** id local dentro da NF (n° do item ou índice). */
  nfeItemIndex: number | null;
  productSku: string | null;
  productName: string | null;
  productExternalId: number | null;
  unit: string | null;
  cfop: string | null;
  quantityNfe: number | null;
  unitValueNfe: number | null;
  totalValueNfe: number | null;
  /** Impostos totais da linha, se disponíveis via xml/rawPayload. */
  taxes: number | null;
  linkedSalesOrderItemId: string | null;
  linkedOrderItemSequence: string | null;
  linkedStockDocumentExternalId: number | null;
  linkedStockDocumentItemId: string | null;
  orderUnitPrice: number | null;
  documentUnitPrice: number | null;
  /** Δ preço NF × pedido (positivo = NF mais cara). */
  priceDiffNfeVsOrderAbsolute: number | null;
  priceDiffNfeVsOrderPercent: number | null;
  /** Δ preço NF × documento (deveria ser 0). */
  priceDiffNfeVsDocumentAbsolute: number | null;
  priceDiffNfeVsDocumentPercent: number | null;
  alerts: string[];
};

export type OrderFullAuditStockDocument = {
  stockDocumentExternalId: number;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  dataMovimentacao: string | null;
  customerName: string | null;
  companyName: string | null;
  idNfe: number | null;
  totalValue: number;
  allocatedValue: number;
  outsideOrderValue: number;
  quantityDocument: number;
  quantityUsedForOrder: number;
  excessQuantity: number;
  outsideOrderQuantity: number;
  hasExcess: boolean;
  hasOutside: boolean;
  productLines: number;
  status: string | null;
  /** Origem oficial do vínculo com o pedido: link explícito (FactRecord.salesOrderItemId) × só cabeçalho. */
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SALES_ORDER_NFE_LINK"
    | "UNKNOWN";
  alerts: string[];
};

export type OrderFullAuditStockDocumentItem = {
  stockDocumentExternalId: number;
  stockDocumentItemId: string;
  externalItemId: number | null;
  productSku: string | null;
  productName: string | null;
  productExternalId: number | null;
  unit: string | null;
  quantityDocument: number | null;
  quantityUsedForOrder: number | null;
  excessQuantity: number | null;
  unitValue: number | null;
  totalValue: number | null;
  /** salesOrderId oficial do IndusCost casado pelo fact ou pela evidência. */
  linkedSalesOrderId: string | null;
  linkedOrderCode: string | null;
  linkedSalesOrderItemId: string | null;
  linkedOrderItemSequence: string | null;
  orderUnitPrice: number | null;
  /** Δ preço unitário: doc − pedido. Positivo = doc mais caro que o pedido. */
  priceDiffAbsolute: number | null;
  priceDiffPercent: number | null;
  /** Impacto financeiro = Δ unitário × qtd usada no pedido. */
  financialImpact: number | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  receivableExternalId: number | null;
  lineType: string | null;
  alerts: string[];
};

export type OrderFullAuditTimelinePoint = {
  key:
    | "PROPOSAL"
    | "ORDER_ISSUED"
    | "STOCK_DOCUMENT"
    | "NFE"
    | "RECEIVABLE"
    | "DUE_DATE"
    | "PAYMENT";
  label: string;
  date: string | null;
  detail: string | null;
  active: boolean;
  amount?: number | null;
  alert?: string | null;
};

export type OrderFullAuditAlertCategory =
  | "COMMERCIAL"
  | "ORDER"
  | "ORDER_ITEM"
  | "STOCK_DOCUMENT"
  | "NFE"
  | "RECEIVABLE"
  | "RECEIPT"
  | "DELIVERY"
  | "FREIGHT"
  | "MARGIN_PRICING"
  | "COMMISSION"
  | "INTEGRATION_NOMUS"
  | "REGISTRATION";

export type OrderFullAuditAlertSeverity =
  | "critical"
  | "high"
  | "medium"
  | "info"
  | "warning";

export type OrderFullAuditAlert = {
  code: string;
  severity: OrderFullAuditAlertSeverity;
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
  /** Categoria oficial para agrupar / filtrar na aba Divergências. */
  category: OrderFullAuditAlertCategory;
  /** Tipo da entidade afetada (SalesOrder / SalesOrderItem / NomusNfe / …). */
  entityType: string | null;
  /** ID da entidade (uuid interno ou externalId Nomus). */
  entityId: string | null;
  /** Referência humana (número da NF, código do pedido, `salesOrderItemId`, `stockDocumentExternalId`, …). */
  reference: string | null;
  /** Quantidade afetada, quando aplicável. */
  quantityImpact: number | null;
  /** Data associada à divergência (ex.: vencimento do CR, entrega prevista). */
  alertDate: string | null;
  /** Status da divergência: OPEN | ACK | RESOLVED. Hoje sempre OPEN (auditoria live). */
  status: "OPEN" | "ACK" | "RESOLVED";
  /** Aba da Auditoria 360º relacionada (para o atalho na UI). */
  linkedTab:
    | "summary"
    | "proposal"
    | "salesOrder"
    | "items"
    | "documents"
    | "nfes"
    | "financial"
    | "delivery"
    | "marginPricing"
    | "commissions"
    | "divergences"
    | "technicalAudit"
    | null;
};

/* ---------------------------------------------------------------------- */
/*  Novos blocos (stubs tipados para as 12 abas — sem lógica pesada ainda) */
/* ---------------------------------------------------------------------- */

export type OrderFullAuditProposalItem = {
  proposalItemId: string;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  unit: string | null;
  quantity: number | null;
  unitCost: number | null;
  suggestedPrice: number | null;
  negotiatedPrice: number | null;
  discountPerc: number | null;
  discountValue: number | null;
  totalNetValue: number | null;
  marginValue: number | null;
  marginPerc: number | null;
  taxesPerc: number | null;
  taxesValue: number | null;
  commissionPerc: number | null;
  commissionValue: number | null;
  freightValue: number | null;
  externalItemStatus: string | null;
  priceTableCode: string | null;
  /**
   * Vínculo linha a linha com o pedido (via `SalesOrderItem.proposalItemId`).
   * `null` quando o item da proposta ainda não virou item de pedido.
   */
  convertedToSalesOrderItem: {
    salesOrderItemId: string;
    quantity: number | null;
    negotiatedPrice: number | null;
    totalNetValue: number | null;
    quantityDiff: number;
    negotiatedPriceDiff: number;
    totalNetValueDiff: number;
  } | null;
  alerts: string[];
};

export type OrderFullAuditProposalBlock = {
  present: boolean;
  /** Empty state semântico — só marcado quando a rota foi consultada mas nada foi encontrado. */
  emptyReason:
    | "NO_PROPOSAL_LINK"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_LOAD_ERROR"
    | null;
  proposalId: string | null;
  proposalNumber: string | null;
  title: string | null;
  externalProposalId: number | null;
  externalProposalCode: string | null;
  externalSellerId: number | null;
  status: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  expectedCloseDate: string | null;
  validityDays: number | null;
  validUntil: string | null;
  responsible: string | null;
  companyIssuer: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  priceTableId: string | null;
  priceTableVersionId: string | null;
  priceTableCode: string | null;
  priceSource: string | null;
  totals: {
    totalItems: number | null;
    totalGrossValue: number | null;
    totalDiscount: number | null;
    totalNetValue: number | null;
    totalCost: number | null;
    totalMarginValue: number | null;
    totalMarginPerc: number | null;
    totalTaxes: number | null;
    totalCommission: number | null;
    totalFreight: number | null;
  };
  /**
   * Valores derivados oficiais — apenas leitura. Não substituem os totais do pedido.
   */
  derivedValues: {
    proposalTotalValue: number | null;
    approvedTotalValue: number | null;
    convertedToOrderValue: number | null;
    proposalVsOrderDiff: number | null;
  };
  items: OrderFullAuditProposalItem[];
  deltasVsSalesOrder: {
    quantityDiff: number;
    negotiatedPriceDiff: number;
    totalNetValueDiff: number;
    marginPercDiff: number | null;
  } | null;
};

export type OrderFullAuditProposalOrderComparison = {
  paymentTerms: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  paymentMethod: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  freightCondition: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  totalNetValue: {
    proposal: number | null;
    salesOrder: number | null;
    diff: number | null;
    matches: boolean;
  };
  itemsMapping: {
    proposalItemCount: number;
    salesOrderItemCount: number;
    convertedCount: number;
    proposalItemsNotConverted: number;
    salesOrderItemsWithoutProposalItem: number;
    priceMismatches: number;
  };
};

export type OrderFullAuditSalesOrderBlock = {
  orderCode: string | null;
  status: string | null;
  sourceSystem: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  sentToNomusAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Última data em que qualquer item foi visto pelo sync Nomus (ou `updatedAt`). */
  lastSyncedAt: string | null;
  identifiers: {
    id: string;
    externalSalesOrderId: number | null;
    externalSalesOrderCode: string | null;
    externalCustomerId: number | null;
    externalCompanyId: number | null;
  };
  customer: {
    id: string | null;
    name: string | null;
    document: string | null;
  };
  companyName: string | null;
  /** Tipo do pedido (`Pedido de Venda`, `Pedido de Locação`, etc.), quando informado no payload Nomus. */
  orderType: string | null;
  /** Tipo de movimentação (`Venda`, `Bonificação`, `Amostra`, …). Extraído do payload Nomus quando disponível. */
  movementType: string | null;
  /** Setor operacional (SalesOrder.responsible). Nunca é o Responsável Comercial. */
  operationalSector: string | null;
  /** Nome do responsável operacional se resolvível — hoje é o mesmo campo `responsible`. */
  operationalResponsibleName: string | null;
  /** Vem do CRM/carteira do cliente (CrmCustomerCommercialOwner). Único responsável comercial oficial. */
  commercialResponsibleName: string | null;
  commercialResponsible: ResolvedCommercialResponsibleDisplay;
  /** Vendedor do Pedido resolvido (canônico) — nunca ID cru como label. */
  orderSellerName: string | null;
  orderSellerExternalId: number | null;
  orderSeller: ReturnType<typeof toOrderSellerDto>;
  paymentTerms: string | null;
  /** Texto humano da condição de pagamento (quando o Nomus expõe além do código). */
  paymentTermsText: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  /** Modalidade de transporte (`Rodoviário`, `Aéreo`, …) quando o Nomus informa. */
  freightMode: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  internalNotes: string | null;
  totals: {
    grossValue: number | null;
    discount: number | null;
    netValue: number | null;
    cost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    taxes: number | null;
    freight: number | null;
    /** Seguro total, se informado no payload Nomus. */
    insurance: number | null;
    /** Outras despesas, se informado no payload Nomus. */
    otherExpenses: number | null;
    /** Total conferido a partir da soma dos itens (para o alerta ORDER_HEADER_ITEMS_TOTAL_MISMATCH). */
    itemsSummedNetValue: number | null;
    /** Diferença absoluta entre cabeçalho e soma dos itens. */
    headerVsItemsDiff: number | null;
  };
  itemCounts: {
    total: number;
    active: number;
    canceled: number;
    cut: number;
    stale: number;
    fulfilled: number;
    pendingActive: number;
    fulfillmentPercentActive: number;
  };
  nomusRawResponsePresent: boolean;
};

export type OrderFullAuditReceipt = {
  receivableExternalId: number;
  /** Data em que a baixa foi lançada (settlementDate do CR). */
  settlementDate: string | null;
  /** Data de recebimento efetivo, se diferente da baixa. */
  paymentDate: string | null;
  amountReceived: number;
  /** Juros aplicados, se disponíveis no rawPayload. */
  interest: number | null;
  /** Desconto concedido, se disponível. */
  discount: number | null;
  /** Multa aplicada, se disponível. */
  lateFee: number | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  /** Histórico do lançamento (comments/description). */
  history: string | null;
  /** ID externo do lançamento de baixa quando disponível no rawPayload. */
  externalReceiptId: number | null;
  /** Usuário ou sistema que registrou a baixa. */
  userOrSystem: string | null;
};

/**
 * Recebível **planejado** do Pedido de Venda — surge quando o pedido ainda não
 * tem NF/CR real, mas a condição de pagamento define parcelas previstas.
 *
 * CR real sempre prevalece: quando `replacedByRealCr === true`, a linha é
 * exibida na aba Auditoria Técnica / oculta na tabela oficial de planejados.
 */
export type OrderFullAuditPlannedReceivable = {
  key: string;
  orderCode: string;
  salesOrderId: string;
  installmentNumber: number;
  totalInstallments: number;
  reference: string;
  dueDate: string | null;
  expectedAmount: number;
  openAmount: number;
  statusLabel: "A vencer" | "Vence hoje" | "Vencido" | "Não informado";
  paymentConditionLabel: string;
  paymentMethodLabel: string | null;
  origin: string;
  note: string;
  replacedByRealCr: boolean;
  replacedByReceivableExternalId: number | null;
};

export type OrderFullAuditPlannedReceivablesTotal = {
  totalCount: number;
  totalExpected: number;
  /** Planejado ainda aplicável (= totalExpected − replacedAmount). */
  applicableExpected: number;
  openExpected: number;
  overdueExpected: number;
  overdueCount: number;
  dueTodayExpected: number;
  dueTodayCount: number;
  upcomingCount: number;
  nextDueDate: string | null;
  replacedCount: number;
  replacedAmount: number;
  netPlannedOpen: number;
};

export type OrderFullAuditFreightBlock = {
  freightCondition: string | null;
  freightAmount: number | null;
  carrierName: string | null;
  carrierExternalId: number | null;
  transportMode: string | null;
  responsibleForFreight: string | null;
  deliveryLocation: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  internalNotes: string | null;
};

export type OrderFullAuditDeliveryBlock = {
  /** Data de entrega padrão do cabeçalho do pedido. */
  expectedDeliveryDate: string | null;
  /** Data de emissão do pedido — base para lead time prometido. */
  orderIssueDate: string | null;
  /** Data do documento de saída mais recente. */
  lastStockDocumentDate: string | null;
  /** Data da NF mais recente. */
  lastNfeDate: string | null;
  /** Última baixa/recebimento. */
  lastReceivableSettlement: string | null;
  /** Condições comerciais que impactam a entrega. */
  freightCondition: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  /** Lead time prometido em dias (issueDate → expectedDeliveryDate). */
  leadTimePromisedDays: number | null;
  /** Lead time real em dias (issueDate → última NF/doc). */
  leadTimeRealDays: number | null;
  /** Atraso vs entrega prometida (positivo = atrasado). */
  delayDays: number | null;
  /** Previsão futura de entrega (max entre lastStockDocumentDate e proposta). */
  forecastNextDeliveryDate: string | null;
  /** Status operacional consolidado (do summary). */
  operationalStatus: string | null;
  /** Contagem de itens em cada estado operacional. */
  itemCounts: {
    total: number;
    active: number;
    fulfilled: number;
    pendingActive: number;
    canceled: number;
    cut: number;
    overdue: number;
    readyNotInvoiced: number;
  };
  /** Totais quantitativos consolidados. */
  totals: {
    quantityOrdered: number;
    quantityProduced: number;
    quantityInvoiced: number;
    saldoAFaturar: number;
    saldoPronto: number;
  };
};

export type OrderFullAuditMarginPricingItem = {
  salesOrderItemId: string;
  productCode: string | null;
  productName: string | null;
  itemSequence: string | null;
  itemStatus: string;
  isActive: boolean;
  isCanceled: boolean;
  isCut: boolean;
  isStale: boolean;
  activeQuantity: number | null;
  orderUnitPrice: number | null;
  officialTableUnitPrice: number | null;
  documentUnitPrice: number | null;
  nfeUnitPrice: number | null;
  priceDiffOrderVsTableAbs: number | null;
  priceDiffOrderVsTablePercent: number | null;
  priceDiffOrderVsDocumentAbs: number | null;
  priceDiffOrderVsDocumentPercent: number | null;
  priceDiffDocumentVsNfeAbs: number | null;
  priceDiffDocumentVsNfePercent: number | null;
  unitCost: number | null;
  totalCost: number | null;
  netRevenue: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  fiscalRule: string | null;
  priceTableCode: string | null;
  priceTableVersion: string | null;
  priceTableEffectiveDate: string | null;
  costEffectiveDate: string | null;
  commissionEstimated: number | null;
  marginStatus: string;
  marginStatusLabel: string;
  reason: string | null;
  alerts: string[];
};

export type OrderFullAuditMarginPricingBlock = {
  /** Totais consolidados apenas dos itens ativos (não conta cancelado/cut/stale). */
  totals: {
    /** Receita ativa (Σ activeValue). */
    totalNetRevenue: number | null;
    totalCost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    coverage: number | null;
    /** Valor cancelado / cortado / stale (para os cards). */
    canceledValue: number;
    cutValue: number;
    staleValue: number;
    /** Σ receita dos itens ativos sem margem válida. */
    noMarginValue: number;
    /** Σ Δ preço pedido × tabela (somente ativos, absolute). */
    priceOrderVsTableDelta: number;
    /** Σ Δ preço pedido × documento (somente ativos). */
    priceOrderVsDocumentDelta: number;
  };
  counts: {
    activeItems: number;
    canceledItems: number;
    cutItems: number;
    staleItems: number;
    noMarginItems: number;
    priceMismatchItems: number;
    negativeMarginItems: number;
    missingCostItems: number;
    missingTableItems: number;
  };
  items: OrderFullAuditMarginPricingItem[];
  /** Compat legado (não removido para não quebrar consumidores) */
  itemMargins: Array<{
    salesOrderItemId: string;
    status: string;
    netRevenue: number | null;
    totalCost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    costSource: string | null;
    costConfidence: string | null;
  }>;
  officialPriceReferences: Array<{
    salesOrderItemId: string;
    priceTableCode: string | null;
    priceTableVersion: string | null;
    officialSalePrice: number | null;
    negotiatedPrice: number | null;
    deltaPercent: number | null;
  }>;
  source: "SNAPSHOT_SALES_ORDER_ITEM" | "MARGIN_SERVICE_RECOMPUTED" | "NONE";
  todo: string;
};

export type OrderFullAuditCommissionItem = {
  salesOrderItemId: string;
  productCode: string | null;
  productName: string | null;
  itemSequence: string | null;
  itemStatus: string;
  isActive: boolean;
  isCanceled: boolean;
  isCut: boolean;
  isStale: boolean;
  /** Quantidade da linha no pedido (`SalesOrderItem.quantity`). */
  quantity: number | null;
  /** Preço unitário negociado da linha (`SalesOrderItem.negotiatedPrice`). */
  unitPrice: number | null;
  activeQuantity: number | null;
  /** Base de comissão oficial (`CommissionOrderItemSnapshot.soldAmount`). */
  commissionBase: number | null;
  marginPercent: number | null;
  commissionRatePercent: number | null;
  finalCommissionAmount: number | null;
  grossCommissionAmount: number | null;
  ruleId: string | null;
  ruleName: string | null;
  ruleBaseType: string | null;
  ruleReleaseRule: string | null;
  status: string | null;
  exclusionReason: string | null;
  alerts: string[];
};

export type OrderFullAuditCommissionScheduleEntry = {
  receivableExternalId: number | null;
  receivableCode: string | null;
  installmentNumber: number | null;
  /** Vencimento oficial da parcela CR (`NomusAccountsReceivable.dueDate`) — YYYY-MM-DD. */
  receivableDueDate: string | null;
  /** Mesmo vencimento formatado YYYY/MM/DD para a UI. */
  receivableDueDateFormatted: string | null;
  receivableNominalAmount: number | null;
  receivableSharePercent: number | null;
  scheduledCommissionAmount: number | null;
  /** @deprecated Preferir `receivableDueDate`. Mantido por compatibilidade. */
  scheduleDate: string | null;
  status: string | null;
};

export type OrderFullAuditCommissionReceipt = {
  ledgerLineKey: string;
  receivableExternalId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  receivedAmount: number | null;
  releasedCommissionAmount: number | null;
  paidCommissionAmount: number | null;
  blockedCommissionAmount: number | null;
  status: string | null;
  paymentDate: string | null;
  paymentStatus: string | null;
  canonicalSellerName: string | null;
  rawSellerName: string | null;
};

export type OrderFullAuditCommissionCustomerException = {
  id: string;
  reason: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  productCode: string | null;
  commissionPersonName: string | null;
};

export type OrderFullAuditCommissionBlock = {
  present: boolean;
  readOnly: true;
  snapshotId: string | null;
  snapshotStatus: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  /** Responsável comercial (CRM) — apenas para exibição; NUNCA usado como vendedor comissionável. */
  commercialResponsibleName: string | null;
  totals: {
    /** Comissão prevista consolidada (Σ items.finalCommissionAmount). */
    totalSoldAmount: number | null;
    totalGrossCommissionAmount: number | null;
    totalFinalCommissionAmount: number | null;
    /** Confirmada = itens ACTIVE que não foram excluídos por exceção/cancelamento. */
    totalConfirmedAmount: number | null;
    /** Liberada = via CommissionReceiptLedgerLine.releasedCommissionAmount. */
    totalReleasedAmount: number | null;
    /** Paga = ledger lines com paymentDate/paymentStatus PAID. */
    totalPaidAmount: number | null;
    /** Bloqueada = ledger lines com blockedCommissionAmount > 0. */
    totalBlockedAmount: number | null;
    /** Base comissionável = Σ soldAmount dos itens ativos que geraram comissão. */
    commissionableBase: number | null;
    /** Base ignorada = Σ receita dos itens cancelados/cut/stale. */
    ignoredBase: number | null;
  };
  counts: {
    totalItems: number;
    itemsWithCommission: number;
    itemsExcluded: number;
    canceledItems: number;
    cutItems: number;
    staleItems: number;
  };
  items: OrderFullAuditCommissionItem[];
  receivableSchedule: OrderFullAuditCommissionScheduleEntry[];
  receipts: OrderFullAuditCommissionReceipt[];
  customerExceptions: OrderFullAuditCommissionCustomerException[];
  todo?: string;
};

export type OrderFullAuditDivergenceBlock = {
  hasAny: boolean;
  counts: {
    critical: number;
    high: number;
    medium: number;
    warning: number;
    info: number;
  };
  metrics: {
    financialImpactTotal: number;
    affectedItems: number;
    affectedTitles: number;
    affectedDocuments: number;
    affectedNfes: number;
  };
  byCategory: Record<OrderFullAuditAlertCategory, number>;
  alerts: OrderFullAuditAlert[];
};

export type OrderFullAuditTechnicalSource = {
  /** Nome oficial da fonte (`SalesOrder`, `NomusNfe`, …). */
  name: string;
  /** Rótulo humano em PT-BR. */
  label: string;
  /** Categoria da fonte (para agrupamento na UI). */
  category:
    | "SALES_ORDER"
    | "PROPOSAL"
    | "NOMUS_STOCK_DOCUMENT"
    | "NOMUS_NFE"
    | "NOMUS_RECEIVABLE"
    | "AUDIT_FACT"
    | "COMMISSION"
    | "PRICING"
    | "CRM";
  /** Quantidade de registros efetivamente carregados. */
  recordCount: number;
  /** Status oficial de carga. */
  status: "loaded" | "not_found" | "not_applicable" | "error";
  /** Observação opcional para explicar não-carga / erro / regra aplicada. */
  note: string | null;
};

export type OrderFullAuditTechnicalIdentifiers = {
  salesOrderId: string;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  orderCode: string | null;
  proposalId: string | null;
  externalProposalId: number | null;
  customerId: string | null;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  externalCompanyId: number | null;
  stockDocumentExternalIds: number[];
  nfeExternalIds: number[];
  receivableExternalIds: number[];
  commissionSnapshotId: string | null;
  commissionLedgerLineKeys: string[];
  runId: string | null;
  runFinishedAt: string | null;
  runSource: string;
};

export type OrderFullAuditTechnicalRule = {
  code: string;
  label: string;
  description: string;
  category:
    | "ORDER_ITEM"
    | "DOCUMENT_ALLOCATION"
    | "NFE"
    | "RECEIVABLE"
    | "COMMISSION"
    | "MARGIN"
    | "COMMERCIAL";
};

export type OrderFullAuditTechnicalHistory = {
  lastNomusSalesOrderSync: string | null;
  lastNomusNfeSync: string | null;
  lastNomusStockDocumentSync: string | null;
  lastNomusReceivableSync: string | null;
  lastOrderToCashRebuild: string | null;
  lastPortfolioReconciliationRun: string | null;
  lastCommissionRebuild: string | null;
  auditRunUser: string | null;
  auditRunProcess: string | null;
  auditRunCommit: string | null;
  alertsCreated: number;
  alertsResolved: number;
};

export type OrderFullAuditTechnicalRawPayloads = {
  /** SalesOrder.nomusRawResponse. */
  nomusRawResponse: unknown | null;
  /** SalesOrderItem.nomusRawItem (chave = salesOrderItemId). */
  nomusRawItems: Record<string, unknown>;
  /** NomusStockDocument.rawJson (chave = externalId como string). */
  stockDocumentPayloads: Record<string, unknown>;
  /** NomusNfe.rawPayload (chave = externalId como string). */
  nfePayloads: Record<string, unknown>;
  /** NomusAccountsReceivable.rawPayload (chave = externalId como string). */
  receivablePayloads: Record<string, unknown>;
  /** Facts brutos do OrderToCashAuditFact (limitado por page). */
  factsSample: unknown[];
};

export type OrderFullAuditTechnicalRawStatus = {
  /** true = raw expandido e disponível para inspeção. */
  included: boolean;
  /** Motivo padrão quando `included=false`. */
  reason: string;
  /** Nível de acesso mínimo esperado (exibido só para transparência auditável). */
  requiredPermission: string;
};

export type OrderFullAuditTechnicalAuditBlock = {
  orderToCashRunId: string | null;
  orderToCashFinishedAt: string | null;
  syncedAt: {
    salesOrder: string | null;
    lastNfeSyncedAt: string | null;
    lastReceivableSyncedAt: string | null;
    lastStockDocumentSyncedAt: string | null;
  };
  /** Tabelas efetivamente consultadas neste ciclo (auditoria). */
  sourceTables: string[];
  /** Detalhamento oficial das 14 fontes possíveis, com counts + status. */
  sources: OrderFullAuditTechnicalSource[];
  /** IDs técnicos consolidados (referências rápidas). */
  identifiers: OrderFullAuditTechnicalIdentifiers;
  /** Regras oficiais aplicadas neste payload (para auditoria/documentação). */
  rulesApplied: OrderFullAuditTechnicalRule[];
  /** Histórico de sync/rebuild/run (todas as datas oficiais). */
  history: OrderFullAuditTechnicalHistory;
  matchConfidenceSummary: Record<string, number>;
  /** Contagem de facts lidos (grão evidência). */
  factCount: number;
  /** Gaps identificados durante a composição (informativo). */
  gaps: string[];
  /**
   * Status oficial da inclusão de raw payloads (não expõe payload em si).
   * `included=false` sinaliza que raw foi propositalmente omitido.
   */
  rawStatus: OrderFullAuditTechnicalRawStatus;
  /**
   * Só populado quando `includeRaw = true`. Vem do payload Nomus persistido.
   * Não expor por padrão para não vazar JSON cru na UI principal.
   */
  rawPayloads?: OrderFullAuditTechnicalRawPayloads;
};

export type OrderFullAuditPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string | null;
  runId: string | null;
  /** Metadados da run/materialização — todos os blocos são read-only. */
  runMeta: {
    runId: string | null;
    orderToCashFinishedAt: string | null;
  };
  /** ✅ Bloco 1 — Resumo Executivo (implementado). */
  summary: {
    orderCode: string | null;
    customerName: string | null;
    externalCustomerId: number | null;
    customerDocument: string | null;
    companyName: string | null;
    orderIssueDate: string | null;
    orderExpectedDeliveryDate: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    freightCondition: string | null;
    commercialResponsibleName: string | null;
    commercialResponsible: ResolvedCommercialResponsibleDisplay;
    orderSellerName: string | null;
    orderSellerExternalId: number | null;
    orderSeller: ReturnType<typeof toOrderSellerDto>;
    operationalResponsibleArea: string | null;
    originalOrderValue: number;
    canceledOrderValue: number;
    cutOrderValue: number;
    activeOrderValue: number;
    allocatedOrderValue: number;
    pendingActiveOrderValue: number;
    fulfillmentPercentActive: number;
    receivableTotalValue: number;
    receivableOpenValue: number;
    receivableReceivedValue: number;
    /** Valor total dos títulos com status `OVERDUE` (saldo em aberto vencido). */
    receivableOverdueValue: number;
    /** Soma bruta dos documentos de saída vinculados (dedup por documento). */
    stockDocumentsTotalValue: number;
    /** Parcela dos documentos efetivamente alocada ao pedido (dedup). */
    stockDocumentsAllocatedValue: number;
    /**
     * Valor total histórico do cabeçalho das NFs vinculadas (inclui canceladas).
     * Dedup por `nfeExternalId`.
     */
    nfeTotalValue: number;
    /** Alias explícito do total histórico (todas as NFs, inclusive canceladas). */
    nfeTotalValueAll: number;
    /** Soma dos cabeçalhos com `isValidForBilling` (faturamento válido). */
    nfeValidValue: number;
    /** Soma dos cabeçalhos cancelados. */
    nfeCanceledValue: number;
    validNfeCount: number;
    canceledNfeCount: number;
    /**
     * Parcela das NFs alocada ao pedido — apenas NF válida para faturamento.
     * Canceladas não entram neste total.
     */
    nfeAllocatedValue: number;
    /** Alocação histórica (inclui canceladas) — só auditoria. */
    nfeAllocatedValueAll: number;
    /**
     * Comparativos oficiais — sempre `activo - <fonte>`. Positivo = pedido maior;
     * negativo = fonte externa maior. Zero = alinhado dentro da tolerância.
     */
    diffs: {
      orderVsStockDocument: number;
      orderVsNfe: number;
      orderVsReceivable: number;
      activeVsReceivable: number;
      allocatedVsReceivable: number;
    };
    /** Alias derivado de `operationalStage` — nome amigável usado no header do modal. */
    operationalStatus: string | null;
    /** Alias derivado de `financialStage`. */
    financialStatus: string | null;
    operationalStage: string | null;
    financialStage: string | null;
    orderToCashStage: string | null;
    temperature: string | null;
    consolidatedStatus: string | null;
    /** Contagem total de alertas (`divergences.alerts.length`). */
    alertCount: number;
  };
  timeline: OrderFullAuditTimelinePoint[];
  items: OrderFullAuditItem[];
  itemFacts: OrderToCashAuditFactRecord[];
  receivables: OrderFullAuditReceivable[];
  receivablesTotal: {
    totalAmount: number;
    openAmount: number;
    receivedAmount: number;
    overdueCount: number;
    nextDueDate: string | null;
    maxAmount: number;
    totalCount: number;
  };
  /** Recebíveis planejados pela condição de pagamento (fallback quando não há CR real). */
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  plannedReceivablesTotal: OrderFullAuditPlannedReceivablesTotal;
  stockDocuments: OrderFullAuditStockDocument[];
  stockDocumentItems: OrderFullAuditStockDocumentItem[];
  nfes: OrderFullAuditNfe[];
  nfeItems: OrderFullAuditNfeItem[];
  delivery: OrderFullAuditDeliveryBlock;
  alerts: OrderFullAuditAlert[];
  /* ------------------------------------------------------------------ */
  /*  Blocos previstos p/ Auditoria 360º (stubs — sem lógica ainda)      */
  /* ------------------------------------------------------------------ */
  /** ✅ Bloco 2 — Proposta / Origem Comercial (implementado). */
  proposal: OrderFullAuditProposalBlock;
  /** ✅ Bloco 2b — Comparativos oficiais Proposta × Pedido. */
  proposalVsOrderComparisons: OrderFullAuditProposalOrderComparison | null;
  /** ⚠️ Bloco 3 — Pedido de Venda (cabeçalho isolado — implementado). */
  salesOrder: OrderFullAuditSalesOrderBlock;
  /** ⚠️ Bloco 8 — Recebimentos/baixas explícitas (derivadas do CR). */
  receipts: OrderFullAuditReceipt[];
  /** ⚠️ Bloco 8b — Frete detalhado. Complementa `delivery`. */
  freight: OrderFullAuditFreightBlock;
  /** ⚠️ Bloco 9 — Margem, Preço e Custo (stub). */
  marginPricing: OrderFullAuditMarginPricingBlock;
  /** ⚠️ Bloco 10 — Comissões (stub). */
  commissions: OrderFullAuditCommissionBlock;
  /** ⚠️ Bloco 11 — Divergências e alertas consolidados. */
  divergences: OrderFullAuditDivergenceBlock;
  /** ⚠️ Bloco 12 — Auditoria Técnica (raw só quando `includeRaw=true`). */
  technicalAudit: OrderFullAuditTechnicalAuditBlock;
};

/* ---------------------------------------------------------------------- */
/*  Service                                                                */
/* ---------------------------------------------------------------------- */

export type LoadOrderFullAuditInput = {
  salesOrderId: string;
  runId?: string | null;
  /** Aceito por compat com `?orderCode=` (auditoria fallback quando id não bate). */
  orderCode?: string | null;
  /** Quando true, `technicalAudit.rawPayloads` é retornado (accordion técnico). */
  includeRaw?: boolean;
};

export async function loadOrderFullAudit(
  input: LoadOrderFullAuditInput
): Promise<OrderFullAuditPayload | { ok: false; error: string; status: number }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    return { ok: false, status: 400, error: "salesOrderId é obrigatório." };
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      Customer: {
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
      },
      nfeLinks: true,
    },
  });
  if (!order) {
    return { ok: false, status: 404, error: "Pedido não encontrado." };
  }

  // Localiza a run mais recente que contenha esse pedido — se runId veio fixo, respeita.
  let resolvedRunId: string | null = input.runId?.trim() || null;
  if (!resolvedRunId) {
    const latest = await prisma.orderToCashAuditFact.findFirst({
      where: { salesOrderId },
      orderBy: [{ createdAt: "desc" }],
      select: { runId: true },
    });
    resolvedRunId = latest?.runId ?? null;
  }

  let facts: OrderToCashAuditFactRecord[] = [];
  try {
    const rawFacts = await prisma.orderToCashAuditFact.findMany({
      where: resolvedRunId
        ? { salesOrderId, runId: resolvedRunId }
        : { salesOrderId },
      orderBy: [{ orderItemSequence: "asc" }, { id: "asc" }],
    });
    facts = rawFacts.map((r) => normalizeFact(r as unknown as Record<string, unknown>));
    facts = (await enrichFactsWithOrderItemStatus(
      facts as unknown as Parameters<typeof enrichFactsWithOrderItemStatus>[0]
    )) as OrderToCashAuditFactRecord[];
  } catch (error) {
    console.warn(
      "[orderFullAuditService] falha ao carregar OrderToCashAuditFact — seguindo com dados básicos.",
      error
    );
  }

  const runId = facts[0]?.runId ?? resolvedRunId;

  const items: OrderFullAuditItem[] = order.items.map((item, index) => {
    const qty = decimalToNumber(item.quantity);
    const unitPrice = decimalToNumber(item.negotiatedPrice);
    const totalNet = decimalToNumber(item.totalNetValue);
    const fulfilled = decimalToNumber(item.nomusQuantityFulfilled);
    const pending = decimalToNumber(item.nomusQuantityPending);
    const isCanceled = item.nomusIsCanceled === true;
    const isCut = item.nomusIsCut === true;
    const isStale = item.nomusIsStale === true;
    const canceledQty = isCanceled || isStale ? (qty ?? 0) : 0;
    const cutQty =
      isCut && qty != null && fulfilled != null
        ? Math.max(0, qty - fulfilled)
        : 0;
    const activeQty =
      qty != null ? Math.max(0, qty - canceledQty - cutQty) : null;
    const activePending =
      isCanceled || isStale
        ? 0
        : isCut
          ? 0
          : pending != null
            ? Math.max(0, pending)
            : activeQty != null && fulfilled != null
              ? Math.max(0, activeQty - fulfilled)
              : activeQty;
    const canceledValue =
      qty && unitPrice != null && canceledQty > 0
        ? round2(canceledQty * unitPrice)
        : 0;
    const cutValue =
      qty && unitPrice != null && cutQty > 0
        ? round2(cutQty * unitPrice)
        : 0;
    const activeValue = round2(Math.max(0, (totalNet ?? 0) - canceledValue - cutValue));

    const rawItem = item.nomusRawItem;
    const productionQuantity = readNomusRawNumber(rawItem, [
      "qtdeProduzida",
      "quantidadeProduzida",
      "producedQuantity",
    ]);
    const invoicedQuantity = readNomusRawNumber(rawItem, [
      "qtdeFaturada",
      "quantidadeFaturada",
      "invoicedQuantity",
    ]);
    const saldoAFaturar = readNomusRawNumber(rawItem, [
      "saldoFaturar",
      "saldoAFaturar",
      "remainingToInvoice",
    ]);
    const saldoPronto = readNomusRawNumber(rawItem, [
      "saldoPronto",
      "saldoDisponivel",
      "readyBalance",
    ]);
    const movementType = readNomusRawString(rawItem, [
      "tipoMovimentacao",
      "movementType",
      "descricaoMovimentacao",
    ]);
    const cfop = readNomusRawString(rawItem, ["cfop", "codigoCfop", "cfopCode"]);

    return {
      salesOrderItemId: item.id,
      externalSalesOrderItemId: item.nomusItemExternalId ?? null,
      itemSequence: item.nomusItemSequence ?? String(index + 1),
      productCode: item.skuSnapshot,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      productExternalId: item.externalProductId ?? null,
      unit: item.unit ?? null,
      quantity: qty,
      unitPrice,
      totalNetValue: totalNet,
      nomusItemStatusRaw: item.nomusItemStatusRaw ?? null,
      nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
      itemStatus: item.nomusItemStatusNormalized ?? null,
      nomusIsCanceled: isCanceled,
      nomusIsCut: isCut,
      nomusIsStale: isStale,
      nomusQuantityFulfilled: fulfilled,
      nomusQuantityPending: pending,
      matchConfidence: item.nomusMatchConfidence ?? null,
      proposalItemId: item.proposalItemId ?? null,
      activeQuantity: activeQty,
      canceledQuantity: canceledQty > 0 ? canceledQty : 0,
      cutQuantity: cutQty > 0 ? cutQty : 0,
      activePendingQuantity: activePending,
      activeValue,
      canceledValue,
      cutValue,
      expectedDeliveryDate: toIso(order.expectedDeliveryDate),
      productionQuantity,
      invoicedQuantity,
      saldoAFaturar,
      saldoPronto,
      movementType,
      cfop,
      linkedStockDocumentExternalIds: [],
      linkedNfeExternalIds: [],
      linkedReceivableExternalIds: [],
      alerts: [],
    };
  });

  // Dedup NFes e stockDocs a partir dos facts + nfeLinks.
  const nfeMap = new Map<number, OrderFullAuditNfe>();
  const stockMap = new Map<number, OrderFullAuditStockDocument>();

  for (const link of order.nfeLinks) {
    if (link.nfeExternalId == null) continue;
    if (!nfeMap.has(link.nfeExternalId)) {
      nfeMap.set(link.nfeExternalId, {
        nfeExternalId: link.nfeExternalId,
        numero: link.nfeNumber ?? null,
        serie: link.nfeSerie ?? null,
        chave: link.nfeKey ?? null,
        dataProcessamento: toIso(link.dataProcessamento),
        dataEmissao: null,
        status: link.nfeStatus ?? null,
        ...emptyNfeStatusFields(),
        tipoOperacao: link.tipoOperacao ?? null,
        valorLiquido: null,
        valorTotal: null,
        highlightedTaxesValue: null,
        allocatedValueToOrder: 0,
        allocatedValueToOrderRaw: 0,
        insideOrderItemsValue: 0,
        outsideOrderItemsValue: 0,
        headerGreaterThanOrder: false,
        hasReceivable: false,
        hasExtraItems: false,
        customerName: null,
        companyName: null,
        linkedStockDocumentExternalIds: [],
        linkedReceivableExternalIds: [],
        linkOrigin: "SALES_ORDER_NFE_LINK" as const,
        alerts: [] as string[],
      });
    }
  }

  for (const fact of facts) {
    if (fact.nfeNumber || fact.nfeHeaderValue != null) {
      // O fact traz nfeExternalId (na dsl) via join implícito — usar stockDocumentId como fallback.
    }
    if (fact.stockDocumentExternalId != null) {
      const cur = stockMap.get(fact.stockDocumentExternalId) ?? {
        stockDocumentExternalId: fact.stockDocumentExternalId,
        tipoDocumentoEstoque: null,
        dataDocumento: toIso(fact.stockDocumentDate),
        dataMovimentacao: toIso(fact.stockDocumentDate),
        customerName: fact.customerName ?? null,
        companyName: null,
        idNfe: null,
        totalValue: 0,
        allocatedValue: 0,
        outsideOrderValue: 0,
        quantityDocument: 0,
        quantityUsedForOrder: 0,
        excessQuantity: 0,
        outsideOrderQuantity: 0,
        hasExcess: false,
        hasOutside: false,
        productLines: 0,
        status: null,
        linkOrigin: "ITEM_EVIDENCE" as const,
        alerts: [] as string[],
      };
      cur.quantityDocument += fact.stockDocumentItemQuantity ?? 0;
      cur.quantityUsedForOrder += fact.quantityUsedForOrder ?? 0;
      cur.excessQuantity += fact.excessQuantity ?? 0;
      cur.outsideOrderQuantity += fact.outsideOrderQuantity ?? 0;
      cur.totalValue += fact.stockDocumentItemTotalValue ?? 0;
      cur.allocatedValue += fact.allocatedValueByDocumentPrice ?? 0;
      cur.outsideOrderValue +=
        (fact.outsideOrderQuantity ?? 0) *
        (fact.stockDocumentItemUnitValue ?? 0);
      cur.hasExcess = cur.hasExcess || (fact.excessQuantity ?? 0) > MONEY_TOLERANCE;
      cur.hasOutside = cur.hasOutside || (fact.outsideOrderQuantity ?? 0) > MONEY_TOLERANCE;
      cur.productLines += 1;
      stockMap.set(fact.stockDocumentExternalId, cur);
    }
  }

  // Aggregate NFe header per fact.
  for (const fact of facts) {
    const nfeNumber = fact.nfeNumber?.trim();
    if (!nfeNumber && fact.nfeHeaderValue == null) continue;
    // Try to locate by number in existing nfeMap
    let nfeEntry: OrderFullAuditNfe | undefined;
    if (nfeNumber) {
      for (const v of nfeMap.values()) {
        if (v.numero?.trim() === nfeNumber) {
          nfeEntry = v;
          break;
        }
      }
    }
    if (!nfeEntry && nfeNumber) {
      // Cria placeholder — sem externalId conhecido, usa hash negativo.
      const surrogate = -(nfeMap.size + 1);
      nfeEntry = {
        nfeExternalId: surrogate,
        numero: nfeNumber,
        serie: null,
        chave: null,
        dataProcessamento: null,
        dataEmissao: toIso(fact.nfeIssueDate),
        status: null,
        ...emptyNfeStatusFields(),
        tipoOperacao: null,
        valorLiquido: fact.nfeHeaderValue ?? null,
        valorTotal: fact.nfeHeaderValue ?? null,
        highlightedTaxesValue: null,
        allocatedValueToOrder: 0,
        allocatedValueToOrderRaw: 0,
        insideOrderItemsValue: 0,
        outsideOrderItemsValue: 0,
        headerGreaterThanOrder: false,
        hasReceivable: false,
        hasExtraItems: false,
        customerName: fact.customerName ?? null,
        companyName: null,
        linkedStockDocumentExternalIds: [],
        linkedReceivableExternalIds: [],
        linkOrigin: "ITEM_EVIDENCE" as const,
        alerts: [] as string[],
      };
      nfeMap.set(surrogate, nfeEntry);
    }
    if (nfeEntry) {
      nfeEntry.valorLiquido =
        nfeEntry.valorLiquido == null
          ? fact.nfeHeaderValue ?? null
          : Math.max(nfeEntry.valorLiquido, fact.nfeHeaderValue ?? 0);
      // Sem xmlVNF no fact: valorTotal segue o cabeçalho materializado.
      nfeEntry.valorTotal =
        nfeEntry.valorTotal == null
          ? fact.nfeHeaderValue ?? nfeEntry.valorLiquido
          : Math.max(nfeEntry.valorTotal, fact.nfeHeaderValue ?? 0);
      nfeEntry.dataEmissao =
        nfeEntry.dataEmissao ?? toIso(fact.nfeIssueDate) ?? null;
      nfeEntry.allocatedValueToOrder +=
        fact.allocatedValueByOrderPrice ?? 0;
      if (fact.stockDocumentExternalId != null) {
        if (!nfeEntry.linkedStockDocumentExternalIds.includes(fact.stockDocumentExternalId)) {
          nfeEntry.linkedStockDocumentExternalIds.push(fact.stockDocumentExternalId);
        }
      }
      if (fact.hasNfeHeaderGreaterThanOrder) nfeEntry.headerGreaterThanOrder = true;
      if ((fact.receivableTotalValue ?? 0) > MONEY_TOLERANCE) nfeEntry.hasReceivable = true;
    }
  }

  // Complementa NF com dados oficiais (`NomusNfe`) e stock document (`NomusStockDocument`).
  const realNfeIds = [...nfeMap.keys()].filter((id) => id > 0);
  const stockIds = [...stockMap.keys()].filter((id) => id > 0);
  const [nfeRows, stockRows] = await Promise.all([
    realNfeIds.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: realNfeIds } },
          select: {
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            tipoOperacao: true,
            dataProcessamento: true,
            xmlDhEmi: true,
            valorLiquido: true,
            xmlVNF: true,
            xmlVProd: true,
            xmlVDesc: true,
            xmlCancelamento: true,
            justificativaCancelamento: true,
            rawPayload: true,
          },
        })
      : Promise.resolve([]),
    stockIds.length > 0
      ? prisma.nomusStockDocument.findMany({
          where: { externalId: { in: stockIds } },
          select: {
            externalId: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
            idNfe: true,
            rawJson: true,
            items: {
              select: {
                id: true,
                externalItemId: true,
                externalProductId: true,
                quantity: true,
                unitValue: true,
                estimatedTotalValue: true,
                rawJson: true,
              },
              orderBy: { externalItemId: "asc" },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const nfeRawByExternalId = new Map<number, unknown>();
  for (const n of nfeRows) {
    const entry = nfeMap.get(n.externalId);
    if (!entry) continue;
    entry.numero = entry.numero ?? n.numero ?? null;
    entry.serie = entry.serie ?? n.serie ?? null;
    entry.chave = entry.chave ?? n.chave ?? null;
    // Status oficial do NomusNfe prevalece sobre o espelho do link.
    entry.status = n.status ?? entry.status ?? null;
    entry.tipoOperacao = entry.tipoOperacao ?? n.tipoOperacao ?? null;
    entry.dataProcessamento = entry.dataProcessamento ?? toIso(n.dataProcessamento);
    entry.dataEmissao = entry.dataEmissao ?? toIso(n.xmlDhEmi);
    const fiscal = buildLinkedNfeFiscalAmounts({
      valorLiquido: n.valorLiquido,
      xmlVNF: n.xmlVNF,
      xmlVProd: n.xmlVProd,
      xmlVDesc: n.xmlVDesc,
    });
    if (fiscal.productsValue != null) {
      entry.valorLiquido = fiscal.productsValue;
    }
    if (fiscal.comparableBillingValue > 0 || fiscal.totalNfValue != null) {
      entry.valorTotal = fiscal.comparableBillingValue;
    }
    entry.highlightedTaxesValue = fiscal.highlightedTaxesValue;
    // Metadados adicionais vindos do rawPayload (best-effort).
    entry.customerName =
      entry.customerName ??
      readNomusRawString(n.rawPayload, [
        "nomeCliente",
        "cliente",
        "razaoSocialCliente",
        "customerName",
        "destinatario",
      ]);
    entry.companyName =
      entry.companyName ??
      readNomusRawString(n.rawPayload, [
        "empresa",
        "razaoSocialEmpresa",
        "companyName",
        "emitente",
      ]);
    nfeRawByExternalId.set(n.externalId, n.rawPayload);
    applyNormalizedNfeStatus(entry, {
      xmlCancelamento: n.xmlCancelamento,
      justificativaCancelamento: n.justificativaCancelamento,
      rawPayload: n.rawPayload,
    });
  }
  // Links sem linha NomusNfe ainda precisam de status normalizado (link.nfeStatus).
  for (const entry of nfeMap.values()) {
    if (entry.statusNormalized === "UNKNOWN" && entry.statusRaw == null) {
      applyNormalizedNfeStatus(entry, {
        rawPayload: nfeRawByExternalId.get(entry.nfeExternalId),
      });
    }
  }
  for (const doc of stockRows) {
    const entry = stockMap.get(doc.externalId);
    if (!entry) continue;
    entry.tipoDocumentoEstoque = doc.tipoDocumentoEstoque ?? null;
    entry.dataDocumento = entry.dataDocumento ?? toIso(doc.dataDocumento);
    entry.idNfe = doc.idNfe ?? null;
    // Metadados adicionais vindos do rawJson (best-effort).
    entry.customerName =
      entry.customerName ??
      readNomusRawString(doc.rawJson, [
        "nomeCliente",
        "cliente",
        "razaoSocialCliente",
        "customerName",
      ]);
    entry.companyName =
      entry.companyName ??
      readNomusRawString(doc.rawJson, [
        "empresa",
        "razaoSocialEmpresa",
        "companyName",
      ]);
    entry.dataMovimentacao =
      readNomusRawString(doc.rawJson, [
        "dataMovimentacao",
        "dataMov",
        "movementDate",
      ]) ?? entry.dataMovimentacao;
    entry.status =
      readNomusRawString(doc.rawJson, ["status", "situacao", "statusDocumento"]) ??
      entry.status;
  }

  // Recebíveis: por NF vinculada (sourceInvoiceId) — deduplicado por externalId.
  const nfeIdsForReceivables = [...nfeMap.keys()].filter((id) => id > 0);
  const receivables: OrderFullAuditReceivable[] = [];
  const receivableRawByExternalId = new Map<number, unknown>();
  if (nfeIdsForReceivables.length > 0) {
    const arRows = await prisma.nomusAccountsReceivable.findMany({
      where: { sourceInvoiceId: { in: nfeIdsForReceivables } },
      select: {
        id: true,
        externalId: true,
        companyName: true,
        personName: true,
        personCnpj: true,
        description: true,
        comments: true,
        sourceInvoiceId: true,
        sourceInvoiceNumber: true,
        createdAtNomus: true,
        dueDate: true,
        competenceDate: true,
        scheduleDate: true,
        settlementDate: true,
        amountReceivable: true,
        amountScheduled: true,
        amountReceived: true,
        balanceReceivable: true,
        paymentMethodName: true,
        bankAccountName: true,
        rawPayload: true,
      },
    });
    const referenceDate = new Date();
    const referenceMs = referenceDate.getTime();
    // Guarda o rawPayload de cada CR para uso posterior na montagem das baixas.
    for (const r of arRows) {
      receivableRawByExternalId.set(r.externalId, r.rawPayload);
    }
    const parseInstallment = (
      desc: string | null | undefined
    ): { current: number | null; total: number | null } => {
      if (!desc) return { current: null, total: null };
      // padrões comuns: "1/3", "Parcela 2/4", "Parc 1 de 3".
      const match =
        /(\d{1,3})\s*(?:\/|\s+de\s+)\s*(\d{1,3})/i.exec(desc) ?? null;
      if (!match) return { current: null, total: null };
      const cur = Number(match[1]);
      const tot = Number(match[2]);
      if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot < cur) {
        return { current: null, total: null };
      }
      return { current: cur, total: tot };
    };
    for (const r of arRows) {
      const amountReceivable = decimalToNumber(r.amountReceivable) ?? 0;
      const amountScheduled = decimalToNumber(r.amountScheduled);
      const amountReceived = decimalToNumber(r.amountReceived) ?? 0;
      const balance =
        decimalToNumber(r.balanceReceivable) ??
        Math.max(0, amountReceivable - amountReceived);
      const isReceived =
        balance <= MONEY_TOLERANCE && amountReceived > MONEY_TOLERANCE;
      const isPartial =
        amountReceived > MONEY_TOLERANCE && balance > MONEY_TOLERANCE;
      const isOverdue =
        !isReceived &&
        balance > MONEY_TOLERANCE &&
        r.dueDate != null &&
        r.dueDate.getTime() < referenceMs;
      const daysOverdue =
        r.dueDate != null && !isReceived
          ? Math.floor(
              (referenceMs - r.dueDate.getTime()) / (1000 * 60 * 60 * 24)
            )
          : null;
      const installment = parseInstallment(
        r.description ?? r.comments ?? null
      );
      // Referência oficial para "Abrir no Contas a Receber". Prioriza número da NF
      // (o filtro `search` do CR aceita string livre); fallback: externalId do CR.
      const searchRef =
        r.sourceInvoiceNumber?.trim() ||
        (r.sourceInvoiceId != null ? String(r.sourceInvoiceId) : "") ||
        String(r.externalId);

      const linkedNfe =
        r.sourceInvoiceId != null ? nfeMap.get(r.sourceInvoiceId) : undefined;
      const linkedNfeIsCanceled = linkedNfe?.isCanceled === true;
      const status: OrderFullAuditReceivable["status"] = isReceived
        ? "RECEIVED"
        : isPartial
          ? "PARTIALLY_RECEIVED"
          : isOverdue
            ? "OVERDUE"
            : balance > MONEY_TOLERANCE
              ? "OPEN"
              : "UNKNOWN";

      const alertsForLine: string[] = [];
      if (!isReceived && balance > MONEY_TOLERANCE) {
        alertsForLine.push("RECEIVABLE_OPEN");
      }
      if (isOverdue) alertsForLine.push("RECEIVABLE_OVERDUE");
      if (r.sourceInvoiceId == null) alertsForLine.push("RECEIVABLE_WITHOUT_NFE");
      if (r.dueDate == null) alertsForLine.push("RECEIVABLE_WITHOUT_DUE_DATE");
      // Recebido > previsto (baixa maior que o CR).
      if (amountReceived - amountReceivable > MONEY_TOLERANCE) {
        alertsForLine.push("RECEIPT_GREATER_THAN_RECEIVABLE");
      }
      // Saldo inconsistente em baixa parcial: |amountReceivable - amountReceived - balance| > tolerância.
      if (
        isPartial &&
        Math.abs(amountReceivable - amountReceived - balance) > MONEY_TOLERANCE
      ) {
        alertsForLine.push("PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE");
      }
      // Status financeiro ≠ status fiscal: CR oficial permanece; alerta se NF cancelada.
      if (linkedNfeIsCanceled) {
        alertsForLine.push("CANCELED_NFE_WITH_RECEIVABLE");
        if (status === "RECEIVED" || status === "PARTIALLY_RECEIVED") {
          alertsForLine.push("RECEIVED_CR_LINKED_TO_CANCELED_NFE");
        }
      }

      receivables.push({
        receivableExternalId: r.externalId,
        receivableId: r.id ?? null,
        companyName: r.companyName ?? null,
        personName: r.personName ?? null,
        personCnpj: r.personCnpj ?? null,
        description: r.description ?? null,
        sourceInvoiceId: r.sourceInvoiceId ?? null,
        sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
        issueDate: toIso(r.createdAtNomus),
        dueDate: toIso(r.dueDate),
        competenceDate: toIso(r.competenceDate),
        scheduleDate: toIso(r.scheduleDate),
        settlementDate: toIso(r.settlementDate),
        amountReceivable,
        amountScheduled,
        amountReceived,
        balanceReceivable: balance,
        installmentNumber: installment.current,
        totalInstallments: installment.total,
        paymentTermsText: readNomusRawString(r.rawPayload, [
          "condicaoPagamento",
          "descricaoCondicaoPagamento",
          "paymentTerms",
          "textoCondicaoPagamento",
        ]),
        paymentMethodName: r.paymentMethodName ?? null,
        bankAccountName: r.bankAccountName ?? null,
        comments: r.comments ?? null,
        status,
        receivableIsReceived: status === "RECEIVED",
        daysOverdue,
        linkedNfeExternalIds:
          r.sourceInvoiceId != null ? [r.sourceInvoiceId] : [],
        linkedNfeNumber:
          linkedNfe?.numero ?? r.sourceInvoiceNumber ?? null,
        linkedNfeStatusLabel: linkedNfe?.statusLabel ?? null,
        linkedNfeIsCanceled,
        hasCanceledNfeLink: linkedNfeIsCanceled,
        origin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
        linkOrigin:
          r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
        alerts: alertsForLine,
        searchReference: searchRef,
      });
    }
  }

  // Deduplica receivables por externalId (findMany já garante mas mantemos defesa).
  const dedupReceivables = [
    ...new Map(receivables.map((r) => [r.receivableExternalId, r])).values(),
  ];

  // Vincula CRs às NFs correspondentes por sourceInvoiceId ↔ nfeExternalId.
  for (const r of dedupReceivables) {
    if (r.sourceInvoiceId == null) continue;
    const entry = nfeMap.get(r.sourceInvoiceId);
    if (!entry) continue;
    if (!entry.linkedReceivableExternalIds.includes(r.receivableExternalId)) {
      entry.linkedReceivableExternalIds.push(r.receivableExternalId);
    }
    if (r.amountReceivable > MONEY_TOLERANCE) entry.hasReceivable = true;
  }

  /* -------------------------------------------------------------------- */
  /*  Cross-reference item × documento × NF × CR + alertas por linha       */
  /* -------------------------------------------------------------------- */
  const itemByStorageId = new Map<string, OrderFullAuditItem>();
  for (const it of items) itemByStorageId.set(it.salesOrderItemId, it);

  // Facts trazem `salesOrderItemId` explícito quando disponível.
  for (const fact of facts) {
    const soiId = fact.salesOrderItemId;
    if (!soiId) continue;
    const item = itemByStorageId.get(soiId);
    if (!item) continue;
    if (
      fact.stockDocumentExternalId != null &&
      !item.linkedStockDocumentExternalIds.includes(fact.stockDocumentExternalId)
    ) {
      item.linkedStockDocumentExternalIds.push(fact.stockDocumentExternalId);
    }
    if (
      fact.nfeExternalId != null &&
      !item.linkedNfeExternalIds.includes(fact.nfeExternalId)
    ) {
      item.linkedNfeExternalIds.push(fact.nfeExternalId);
    }
    if (
      fact.receivableExternalId != null &&
      !item.linkedReceivableExternalIds.includes(fact.receivableExternalId)
    ) {
      item.linkedReceivableExternalIds.push(fact.receivableExternalId);
    }
  }

  // SKU repetido com status diferente — status é por linha, não por SKU.
  const statusesBySku = new Map<string, Set<string>>();
  for (const it of items) {
    const sku = (it.productCode ?? "").trim();
    if (!sku) continue;
    const s = (it.nomusItemStatusNormalized ?? "UNKNOWN").toUpperCase();
    let set = statusesBySku.get(sku);
    if (!set) {
      set = new Set<string>();
      statusesBySku.set(sku, set);
    }
    set.add(s);
  }
  const skusWithDifferentStatus = new Set<string>();
  for (const [sku, statuses] of statusesBySku) {
    if (statuses.size > 1) skusWithDifferentStatus.add(sku);
  }

  // Alerta por linha (subset de códigos por item).
  const today = new Date();
  for (const it of items) {
    const alerts: string[] = [];
    if (it.nomusIsCanceled) alerts.push("ORDER_ITEM_CANCELED");
    if (it.nomusIsCut) alerts.push("ORDER_ITEM_CUT");
    if (it.nomusIsStale) alerts.push("ORDER_ITEM_STALE");
    const statusUpper = (it.nomusItemStatusNormalized ?? "").toUpperCase();
    if (!statusUpper || statusUpper === "UNKNOWN") {
      alerts.push("ORDER_ITEM_STATUS_UNKNOWN");
    }
    if ((it.matchConfidence ?? "").toUpperCase() === "AMBIGUOUS") {
      alerts.push("ITEM_STATUS_MATCH_AMBIGUOUS");
    }
    if (it.productCode && skusWithDifferentStatus.has(it.productCode.trim())) {
      alerts.push("REPEATED_SKU_WITH_DIFFERENT_STATUS");
    }
    if (
      !it.nomusIsCanceled &&
      !it.nomusIsCut &&
      !it.nomusIsStale &&
      (it.activePendingQuantity ?? 0) > 0.0001
    ) {
      alerts.push("ORDER_ITEM_ACTIVE_PENDING");
      // Entrega vencida por linha (usa o mesmo prazo do pedido).
      if (it.expectedDeliveryDate) {
        const expected = new Date(it.expectedDeliveryDate);
        if (
          !Number.isNaN(expected.getTime()) &&
          expected.getTime() < today.getTime()
        ) {
          alerts.push("DELIVERY_DATE_OVERDUE");
        }
      }
    }
    if (
      it.quantity != null &&
      it.nomusQuantityFulfilled != null &&
      it.nomusQuantityFulfilled - it.quantity > 0.0001 &&
      !it.nomusIsCut
    ) {
      alerts.push("ORDER_ITEM_OVER_FULFILLED");
    }
    it.alerts = alerts;
  }

  /* -------------------------------------------------------------------- */
  /*  Aba Documentos de Saída — itens ricos com comparação de preço        */
  /* -------------------------------------------------------------------- */
  const stockDocumentItems: OrderFullAuditStockDocumentItem[] = [];
  const factsByDocKey = new Map<string, OrderToCashAuditFactRecord[]>();
  const factsByDocExternalId = new Map<
    number,
    OrderToCashAuditFactRecord[]
  >();
  for (const fact of facts) {
    if (fact.stockDocumentId) {
      const arr = factsByDocKey.get(fact.stockDocumentId) ?? [];
      arr.push(fact);
      factsByDocKey.set(fact.stockDocumentId, arr);
    }
    if (fact.stockDocumentExternalId != null) {
      const arr =
        factsByDocExternalId.get(fact.stockDocumentExternalId) ?? [];
      arr.push(fact);
      factsByDocExternalId.set(fact.stockDocumentExternalId, arr);
    }
  }

  const itemsByExternalProductId = new Map<number, OrderFullAuditItem[]>();
  for (const it of items) {
    if (it.productExternalId == null) continue;
    const arr = itemsByExternalProductId.get(it.productExternalId) ?? [];
    arr.push(it);
    itemsByExternalProductId.set(it.productExternalId, arr);
  }

  for (const doc of stockRows) {
    const docEntry = stockMap.get(doc.externalId);
    if (!docEntry) continue;
    const factsForDoc = factsByDocExternalId.get(doc.externalId) ?? [];
    for (const stockItem of doc.items) {
      const docQty = decimalToNumber(stockItem.quantity);
      const docUnit = decimalToNumber(stockItem.unitValue);
      const docTotal =
        decimalToNumber(stockItem.estimatedTotalValue) ??
        (docQty != null && docUnit != null ? round2(docQty * docUnit) : null);

      // Casamento oficial: fact que tenha `stockDocumentExternalId` + mesmo produto
      // externo (evidência por linha). Facts trazem `productCode` snapshot;
      // usamos `externalProductId` do stock item + `sku` do fact via items internos.
      const matchingFact =
        factsForDoc.find(
          (f) =>
            f.salesOrderItemId != null &&
            stockItem.externalProductId != null &&
            (itemByStorageId.get(f.salesOrderItemId!)?.productExternalId ??
              null) === stockItem.externalProductId
        ) ?? null;

      const matchingItem =
        matchingFact?.salesOrderItemId
          ? itemByStorageId.get(matchingFact.salesOrderItemId) ?? null
          : (() => {
              const candidates =
                stockItem.externalProductId != null
                  ? itemsByExternalProductId.get(stockItem.externalProductId) ??
                    []
                  : [];
              return candidates.length === 1 ? candidates[0]! : null;
            })();

      const usedQty =
        (matchingFact?.quantityUsedForOrder ?? null) != null
          ? decimalToNumber(matchingFact!.quantityUsedForOrder)
          : matchingItem != null && docQty != null
            ? docQty
            : null;
      const excessQty =
        (matchingFact?.excessQuantity ?? null) != null
          ? decimalToNumber(matchingFact!.excessQuantity)
          : docQty != null && usedQty != null
            ? Math.max(0, docQty - usedQty)
            : null;

      const orderUnitPrice = matchingItem?.unitPrice ?? null;
      const priceDiffAbs =
        orderUnitPrice != null && docUnit != null
          ? round2(docUnit - orderUnitPrice)
          : null;
      const priceDiffPerc =
        orderUnitPrice != null && orderUnitPrice > 0 && priceDiffAbs != null
          ? Math.round((priceDiffAbs / orderUnitPrice) * 10000) / 100
          : null;
      const financialImpact =
        priceDiffAbs != null && usedQty != null
          ? round2(priceDiffAbs * usedQty)
          : null;

      const alertsForLine: string[] = [];
      if (
        docQty != null &&
        usedQty != null &&
        docQty - usedQty > 0.0001 &&
        matchingItem != null
      ) {
        alertsForLine.push("DOCUMENT_WITH_EXCESS");
      }
      if (!matchingItem) {
        alertsForLine.push("DOCUMENT_EXTRA_ITEM");
      }
      if (matchingItem && matchingFact == null) {
        alertsForLine.push("DOCUMENT_ALLOCATED_BY_HEADER_ONLY");
      }
      if (
        matchingItem &&
        (matchingItem.nomusIsCanceled || matchingItem.nomusIsStale)
      ) {
        alertsForLine.push("DOCUMENT_ALLOCATED_TO_CANCELED_ITEM");
      }
      if (priceDiffAbs != null && Math.abs(priceDiffAbs) > 0.005) {
        alertsForLine.push("DOCUMENT_PRICE_MISMATCH");
      }
      if (
        matchingItem != null &&
        matchingItem.quantity != null &&
        docQty != null &&
        Math.abs(docQty - matchingItem.quantity) > 0.0001
      ) {
        alertsForLine.push("DOCUMENT_QUANTITY_MISMATCH");
      }
      if (docEntry.idNfe == null) {
        alertsForLine.push("DOCUMENT_WITHOUT_NFE");
      }

      // Propaga alertas resumidos para o cabeçalho do documento.
      for (const c of alertsForLine) {
        if (!docEntry.alerts.includes(c)) docEntry.alerts.push(c);
      }

      stockDocumentItems.push({
        stockDocumentExternalId: doc.externalId,
        stockDocumentItemId: stockItem.id,
        externalItemId: stockItem.externalItemId ?? null,
        productSku: readNomusRawString(stockItem.rawJson, [
          "codigoProduto",
          "sku",
          "codigo",
          "productSku",
        ]),
        productName: readNomusRawString(stockItem.rawJson, [
          "descricaoProduto",
          "descricao",
          "productName",
          "nomeProduto",
        ]),
        productExternalId: stockItem.externalProductId ?? null,
        unit: readNomusRawString(stockItem.rawJson, [
          "unidade",
          "un",
          "unit",
        ]),
        quantityDocument: docQty,
        quantityUsedForOrder: usedQty,
        excessQuantity: excessQty,
        unitValue: docUnit,
        totalValue: docTotal,
        linkedSalesOrderId: matchingFact?.salesOrderId ?? null,
        linkedOrderCode: order.orderCode ?? null,
        linkedSalesOrderItemId:
          matchingItem?.salesOrderItemId ??
          matchingFact?.salesOrderItemId ??
          null,
        linkedOrderItemSequence: matchingItem?.itemSequence ?? null,
        orderUnitPrice,
        priceDiffAbsolute: priceDiffAbs,
        priceDiffPercent: priceDiffPerc,
        financialImpact,
        nfeExternalId: docEntry.idNfe,
        nfeNumber: matchingFact?.nfeNumber ?? null,
        receivableExternalId: null,
        lineType: matchingFact?.lineType ?? null,
        alerts: alertsForLine,
      });
    }

    // Ajusta linkOrigin do cabeçalho com base nos facts encontrados.
    if (factsForDoc.length === 0) {
      docEntry.linkOrigin =
        order.nfeLinks.some((l) => l.nfeExternalId === docEntry.idNfe && l.nfeExternalId != null)
          ? "SALES_ORDER_NFE_LINK"
          : "HEADER_ONLY";
      if (!docEntry.alerts.includes("DOCUMENT_ALLOCATED_BY_HEADER_ONLY")) {
        docEntry.alerts.push("DOCUMENT_ALLOCATED_BY_HEADER_ONLY");
      }
    } else if (factsForDoc.every((f) => f.salesOrderItemId != null)) {
      docEntry.linkOrigin = "ITEM_EVIDENCE";
    } else {
      docEntry.linkOrigin = "HEADER_ONLY";
    }
    if (docEntry.idNfe == null && !docEntry.alerts.includes("DOCUMENT_WITHOUT_NFE")) {
      docEntry.alerts.push("DOCUMENT_WITHOUT_NFE");
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Aba NF-e — itens da NF com casamento a pedido/documento              */
  /* -------------------------------------------------------------------- */
  const nfeItems: OrderFullAuditNfeItem[] = [];
  const docItemsByProductForDoc = new Map<
    string,
    OrderFullAuditStockDocumentItem
  >();
  for (const di of stockDocumentItems) {
    // chave = docExternalId + productExternalId (auxilia join preço NF × documento).
    if (di.productExternalId != null) {
      docItemsByProductForDoc.set(
        `${di.stockDocumentExternalId}:${di.productExternalId}`,
        di
      );
    }
  }

  const factsByNfeNumber = new Map<string, OrderToCashAuditFactRecord[]>();
  const factsByNfeExternalId = new Map<
    number,
    OrderToCashAuditFactRecord[]
  >();
  for (const fact of facts) {
    const num = fact.nfeNumber?.trim();
    if (num) {
      const arr = factsByNfeNumber.get(num) ?? [];
      arr.push(fact);
      factsByNfeNumber.set(num, arr);
    }
    if (fact.stockDocumentExternalId != null) {
      // Localiza NF real via stock document → doc.idNfe.
      const doc = stockMap.get(fact.stockDocumentExternalId);
      if (doc?.idNfe != null) {
        const arr =
          factsByNfeExternalId.get(doc.idNfe) ?? [];
        arr.push(fact);
        factsByNfeExternalId.set(doc.idNfe, arr);
      }
    }
  }

  /**
   * Retorna array de "itens" a partir de um rawPayload da NF Nomus.
   * Suporta chaves alternativas frequentes. Sem parse XML — só JSON.
   */
  function extractNomusNfeItems(raw: unknown): Array<Record<string, unknown>> {
    if (!raw || typeof raw !== "object") return [];
    const rec = raw as Record<string, unknown>;
    for (const key of ["itens", "items", "produtos", "itensNfe", "xmlItens"]) {
      const v = rec[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
    return [];
  }

  for (const nfe of nfeMap.values()) {
    const raw = nfeRawByExternalId.get(nfe.nfeExternalId);
    const rawItems = extractNomusNfeItems(raw);
    const factsForThisNfe =
      (nfe.numero ? factsByNfeNumber.get(nfe.numero.trim()) : undefined) ??
      factsByNfeExternalId.get(nfe.nfeExternalId) ??
      [];

    // Índice fact por productExternalId — quando disponível — para join preço NF × pedido.
    const factByProduct = new Map<number, OrderToCashAuditFactRecord>();
    for (const f of factsForThisNfe) {
      if (f.salesOrderItemId != null) {
        const soi = itemByStorageId.get(f.salesOrderItemId);
        if (soi?.productExternalId != null && !factByProduct.has(soi.productExternalId)) {
          factByProduct.set(soi.productExternalId, f);
        }
      }
    }

    let idx = 0;
    // Fonte primária: rawPayload.itens (sempre que existir).
    if (rawItems.length > 0) {
      for (const it of rawItems) {
        idx += 1;
        const productExternalId =
          typeof it["idProduto"] === "number"
            ? (it["idProduto"] as number)
            : typeof it["externalProductId"] === "number"
              ? (it["externalProductId"] as number)
              : null;
        const productSku = readNomusRawString(it, [
          "codigoProduto",
          "sku",
          "codigo",
          "productSku",
        ]);
        const productName = readNomusRawString(it, [
          "descricaoProduto",
          "descricao",
          "productName",
          "nomeProduto",
        ]);
        const unit = readNomusRawString(it, ["unidade", "un", "unit"]);
        const cfop = readNomusRawString(it, ["cfop", "codigoCfop", "cfopCode"]);
        const qty = readNomusRawNumber(it, [
          "quantidade",
          "qtde",
          "qty",
          "quantity",
        ]);
        const unitValue = readNomusRawNumber(it, [
          "valorUnitario",
          "unitario",
          "unitValue",
          "vUnCom",
        ]);
        const totalValue =
          readNomusRawNumber(it, [
            "valorTotal",
            "total",
            "totalValue",
            "vProd",
          ]) ??
          (qty != null && unitValue != null ? round2(qty * unitValue) : null);
        const taxes = readNomusRawNumber(it, [
          "totalImpostos",
          "impostos",
          "vTotTrib",
          "taxes",
        ]);

        // Casamento fact → SOI pelo produto externo.
        const matchedFact =
          productExternalId != null
            ? factByProduct.get(productExternalId) ?? null
            : null;
        const matchedItem = matchedFact?.salesOrderItemId
          ? itemByStorageId.get(matchedFact.salesOrderItemId) ?? null
          : productExternalId != null
            ? (() => {
                const list =
                  itemsByExternalProductId.get(productExternalId) ?? [];
                return list.length === 1 ? list[0]! : null;
              })()
            : null;
        const matchedStockDocId =
          matchedFact?.stockDocumentExternalId ?? null;
        const matchedDocItem =
          matchedStockDocId != null && productExternalId != null
            ? docItemsByProductForDoc.get(
                `${matchedStockDocId}:${productExternalId}`
              ) ?? null
            : null;

        const orderUnitPrice = matchedItem?.unitPrice ?? null;
        const documentUnitPrice = matchedDocItem?.unitValue ?? null;
        const priceDiffOrder =
          orderUnitPrice != null && unitValue != null
            ? round2(unitValue - orderUnitPrice)
            : null;
        const priceDiffOrderPerc =
          orderUnitPrice != null && orderUnitPrice > 0 && priceDiffOrder != null
            ? Math.round((priceDiffOrder / orderUnitPrice) * 10000) / 100
            : null;
        const priceDiffDoc =
          documentUnitPrice != null && unitValue != null
            ? round2(unitValue - documentUnitPrice)
            : null;
        const priceDiffDocPerc =
          documentUnitPrice != null &&
          documentUnitPrice > 0 &&
          priceDiffDoc != null
            ? Math.round((priceDiffDoc / documentUnitPrice) * 10000) / 100
            : null;

        const lineValue = totalValue ?? 0;
        const alertsForLine: string[] = [];
        if (!matchedItem) alertsForLine.push("NFE_EXTRA_ITEM");
        if (priceDiffOrder != null && Math.abs(priceDiffOrder) > 0.005) {
          alertsForLine.push("NFE_PRICE_MISMATCH");
        }
        if (matchedItem) {
          nfe.insideOrderItemsValue += lineValue;
        } else {
          nfe.outsideOrderItemsValue += lineValue;
          nfe.hasExtraItems = true;
        }
        for (const c of alertsForLine) {
          if (!nfe.alerts.includes(c)) nfe.alerts.push(c);
        }

        nfeItems.push({
          nfeExternalId: nfe.nfeExternalId,
          nfeNumber: nfe.numero,
          nfeItemIndex: idx,
          productSku,
          productName,
          productExternalId,
          unit,
          cfop,
          quantityNfe: qty,
          unitValueNfe: unitValue,
          totalValueNfe: totalValue,
          taxes,
          linkedSalesOrderItemId: matchedItem?.salesOrderItemId ?? null,
          linkedOrderItemSequence: matchedItem?.itemSequence ?? null,
          linkedStockDocumentExternalId: matchedStockDocId,
          linkedStockDocumentItemId:
            matchedDocItem?.stockDocumentItemId ?? null,
          orderUnitPrice,
          documentUnitPrice,
          priceDiffNfeVsOrderAbsolute: priceDiffOrder,
          priceDiffNfeVsOrderPercent: priceDiffOrderPerc,
          priceDiffNfeVsDocumentAbsolute: priceDiffDoc,
          priceDiffNfeVsDocumentPercent: priceDiffDocPerc,
          alerts: alertsForLine,
        });
      }
    } else if (factsForThisNfe.length > 0) {
      // Fallback: rawPayload sem itens — deriva linhas dos facts (só itens do pedido).
      for (const f of factsForThisNfe) {
        if (!f.salesOrderItemId) continue;
        const matchedItem = itemByStorageId.get(f.salesOrderItemId);
        if (!matchedItem) continue;
        idx += 1;
        const qty = decimalToNumber(f.nfeItemQuantity);
        const unitValue = decimalToNumber(f.nfeItemUnitValue);
        const totalValue =
          decimalToNumber(f.nfeItemTotalValue) ??
          (qty != null && unitValue != null ? round2(qty * unitValue) : null);
        const orderUnitPrice = matchedItem.unitPrice;
        const priceDiffOrder =
          orderUnitPrice != null && unitValue != null
            ? round2(unitValue - orderUnitPrice)
            : null;
        const priceDiffOrderPerc =
          orderUnitPrice != null && orderUnitPrice > 0 && priceDiffOrder != null
            ? Math.round((priceDiffOrder / orderUnitPrice) * 10000) / 100
            : null;
        const matchedDocItem =
          f.stockDocumentExternalId != null && matchedItem.productExternalId != null
            ? docItemsByProductForDoc.get(
                `${f.stockDocumentExternalId}:${matchedItem.productExternalId}`
              ) ?? null
            : null;
        const documentUnitPrice = matchedDocItem?.unitValue ?? null;
        const priceDiffDoc =
          documentUnitPrice != null && unitValue != null
            ? round2(unitValue - documentUnitPrice)
            : null;
        const priceDiffDocPerc =
          documentUnitPrice != null &&
          documentUnitPrice > 0 &&
          priceDiffDoc != null
            ? Math.round((priceDiffDoc / documentUnitPrice) * 10000) / 100
            : null;
        const alertsForLine: string[] = [];
        if (priceDiffOrder != null && Math.abs(priceDiffOrder) > 0.005) {
          alertsForLine.push("NFE_PRICE_MISMATCH");
        }
        nfe.insideOrderItemsValue += totalValue ?? 0;
        for (const c of alertsForLine) {
          if (!nfe.alerts.includes(c)) nfe.alerts.push(c);
        }
        nfeItems.push({
          nfeExternalId: nfe.nfeExternalId,
          nfeNumber: nfe.numero,
          nfeItemIndex: idx,
          productSku: matchedItem.productCode,
          productName: matchedItem.productName,
          productExternalId: matchedItem.productExternalId,
          unit: matchedItem.unit,
          cfop: null,
          quantityNfe: qty,
          unitValueNfe: unitValue,
          totalValueNfe: totalValue,
          taxes: null,
          linkedSalesOrderItemId: matchedItem.salesOrderItemId,
          linkedOrderItemSequence: matchedItem.itemSequence,
          linkedStockDocumentExternalId: f.stockDocumentExternalId ?? null,
          linkedStockDocumentItemId: matchedDocItem?.stockDocumentItemId ?? null,
          orderUnitPrice,
          documentUnitPrice,
          priceDiffNfeVsOrderAbsolute: priceDiffOrder,
          priceDiffNfeVsOrderPercent: priceDiffOrderPerc,
          priceDiffNfeVsDocumentAbsolute: priceDiffDoc,
          priceDiffNfeVsDocumentPercent: priceDiffDocPerc,
          alerts: alertsForLine,
        });
      }
    }

    // Round nos totais agregados.
    nfe.insideOrderItemsValue = round2(nfe.insideOrderItemsValue);
    nfe.outsideOrderItemsValue = round2(nfe.outsideOrderItemsValue);

    // linkOrigin oficial da NF: se houver evidência item × NF (fact.salesOrderItemId != null)
    // marcamos ITEM_EVIDENCE; senão, se veio via SalesOrderNfeLink, mantemos; senão HEADER_ONLY.
    const hasItemEvidence = factsForThisNfe.some(
      (f) => f.salesOrderItemId != null && f.nfeNumber
    );
    if (hasItemEvidence) {
      nfe.linkOrigin = "ITEM_EVIDENCE";
    } else if (
      order.nfeLinks.some((l) => l.nfeExternalId === nfe.nfeExternalId)
    ) {
      nfe.linkOrigin = "SALES_ORDER_NFE_LINK";
      if (!nfe.alerts.includes("NFE_ALLOCATED_BY_HEADER_ONLY")) {
        nfe.alerts.push("NFE_ALLOCATED_BY_HEADER_ONLY");
      }
    } else {
      nfe.linkOrigin = "HEADER_ONLY";
      if (!nfe.alerts.includes("NFE_ALLOCATED_BY_HEADER_ONLY")) {
        nfe.alerts.push("NFE_ALLOCATED_BY_HEADER_ONLY");
      }
    }

    // Preserva alocação bruta; NF cancelada não compõe atribuição válida.
    nfe.allocatedValueToOrderRaw = round2(nfe.allocatedValueToOrder);

    if (nfe.isCanceled) {
      if (!nfe.alerts.includes("NFE_CANCELED_LINKED_TO_ORDER")) {
        nfe.alerts.push("NFE_CANCELED_LINKED_TO_ORDER");
      }
      if (nfe.hasReceivable && !nfe.alerts.includes("CANCELED_NFE_WITH_RECEIVABLE")) {
        nfe.alerts.push("CANCELED_NFE_WITH_RECEIVABLE");
      }
      if (
        nfe.linkedStockDocumentExternalIds.length > 0 &&
        !nfe.alerts.includes("DOCUMENT_LINKED_TO_CANCELED_NFE")
      ) {
        nfe.alerts.push("DOCUMENT_LINKED_TO_CANCELED_NFE");
      }
      if (
        nfe.allocatedValueToOrderRaw > MONEY_TOLERANCE &&
        !nfe.alerts.includes("CANCELED_NFE_INCLUDED_IN_BILLING_VALUE")
      ) {
        nfe.alerts.push("CANCELED_NFE_INCLUDED_IN_BILLING_VALUE");
      }
      nfe.allocatedValueToOrder = 0;
      // Cancelada: não gera ruído de "sem doc/CR" — permanece só como evidência.
    } else {
      if (nfe.statusNormalized === "UNKNOWN") {
        if (!nfe.alerts.includes("NFE_STATUS_UNKNOWN")) {
          nfe.alerts.push("NFE_STATUS_UNKNOWN");
        }
      }
      if (nfe.linkedStockDocumentExternalIds.length === 0) {
        if (!nfe.alerts.includes("NFE_WITHOUT_DOCUMENT")) {
          nfe.alerts.push("NFE_WITHOUT_DOCUMENT");
        }
      }
      if (!nfe.hasReceivable) {
        if (!nfe.alerts.includes("NFE_WITHOUT_CR")) {
          nfe.alerts.push("NFE_WITHOUT_CR");
        }
      }
      if (nfe.headerGreaterThanOrder) {
        if (!nfe.alerts.includes("NFE_HEADER_GREATER_THAN_ORDER")) {
          nfe.alerts.push("NFE_HEADER_GREATER_THAN_ORDER");
        }
      }
    }
  }

  // Documento de saída apontando para NF cancelada.
  const canceledNfeExternalIds = new Set(
    [...nfeMap.values()].filter((n) => n.isCanceled).map((n) => n.nfeExternalId)
  );
  for (const doc of stockMap.values()) {
    if (doc.idNfe != null && canceledNfeExternalIds.has(doc.idNfe)) {
      if (!doc.alerts.includes("DOCUMENT_LINKED_TO_CANCELED_NFE")) {
        doc.alerts.push("DOCUMENT_LINKED_TO_CANCELED_NFE");
      }
    }
  }

  // Responsável comercial do CRM (mesmo helper do grid Status Pedidos).
  // Nunca promove "Vendedor ID N" a label de carteira.
  let commercialResponsible = resolveCommercialResponsibleDisplay({});
  let commercialResponsibleName: string | null = null;
  if (order.customerId) {
    try {
      const ownerMap = await loadManualCommercialOwnersForCustomers([order.customerId]);
      const owner = ownerMap.get(order.customerId);
      commercialResponsible = resolveCommercialResponsibleDisplay({
        ownerId: null,
        canonicalName: owner?.sellerCanonicalName,
        responsibleName: owner?.sellerResponsibleName,
        source: owner?.source ?? null,
      });
      commercialResponsibleName =
        commercialResponsible.source === "NONE"
          ? null
          : commercialResponsible.name;
    } catch (error) {
      console.warn(
        "[orderFullAuditService] falha ao carregar CrmCustomerCommercialOwner.",
        error
      );
    }
  }

  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  let orderSellerResolved: ResolvedOrderSellerIdentity = resolveOrderSellerIdentity(
    {
      salesOrder: {
        externalSellerId: order.externalSellerId,
        nomusSellerName: order.nomusSellerName,
        issueDate: order.issueDate,
        nomusRawResponse: order.nomusRawResponse,
      },
    },
    sellerIdentityCtx
  );

  // Metadados da run (finishedAt) para header do modal / auditoria.
  let orderToCashFinishedAt: string | null = null;
  if (runId) {
    try {
      const run = await prisma.orderToCashAuditRun.findUnique({
        where: { id: runId },
        select: { finishedAt: true },
      });
      orderToCashFinishedAt = toIso(run?.finishedAt ?? null);
    } catch {
      /* metadata acessória — silencioso. */
    }
  }

  // Última data de sync das NFs / CRs / documentos (auditoria técnica).
  let lastNfeSyncedAt: string | null = null;
  let lastReceivableSyncedAt: string | null = null;
  let lastStockDocumentSyncedAt: string | null = null;
  const realNfeIdsForSync = [...nfeMap.keys()].filter((id) => id > 0);
  if (realNfeIdsForSync.length > 0) {
    try {
      const nfeSync = await prisma.nomusNfe.aggregate({
        where: { externalId: { in: realNfeIdsForSync } },
        _max: { syncedAt: true },
      });
      lastNfeSyncedAt = toIso(nfeSync._max.syncedAt);
    } catch {
      /* opcional */
    }
  }
  const stockIdsForSync = [...stockMap.keys()].filter((id) => id > 0);
  if (stockIdsForSync.length > 0) {
    try {
      const stockSync = await prisma.nomusStockDocument.aggregate({
        where: { externalId: { in: stockIdsForSync } },
        _max: { syncedAt: true },
      });
      lastStockDocumentSyncedAt = toIso(stockSync._max.syncedAt);
    } catch {
      /* opcional */
    }
  }
  const arIdsForSync = dedupReceivables.map((r) => r.receivableExternalId);
  if (arIdsForSync.length > 0) {
    try {
      const arSync = await prisma.nomusAccountsReceivable.aggregate({
        where: { externalId: { in: arIdsForSync } },
        _max: { syncedAt: true },
      });
      lastReceivableSyncedAt = toIso(arSync._max.syncedAt);
    } catch {
      /* opcional */
    }
  }

  // Proposta / origem comercial — carrega quando FK existe.
  const proposal = order.proposalId
    ? await loadProposalBlock(order.proposalId, items)
    : emptyProposalBlock(null);

  const timeline = buildTimeline({
    orderIssueDate: order.issueDate,
    proposal,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
    receivables: dedupReceivables,
  });

  const receivablesTotal = summarizeReceivables(dedupReceivables);

  /* -------------------------------------------------------------------- */
  /*  Bloco 8b — Recebíveis planejados (forecast pela condição de pagto)  */
  /*  Regra oficial: CR real prevalece; forecast só complementa/apoia.     */
  /* -------------------------------------------------------------------- */
  const realReceivablesForForecast: SalesOrderListReceivableInput[] =
    dedupReceivables.map((r) => ({
      externalId: r.receivableExternalId,
      sourceInvoiceId: r.sourceInvoiceId,
      sourceInvoiceNumber: r.sourceInvoiceNumber,
      dueDate: r.dueDate ? new Date(r.dueDate) : null,
      amountReceivable: r.amountReceivable ?? 0,
      amountReceived: r.amountReceived ?? 0,
      balanceReceivable: r.balanceReceivable ?? 0,
      settlementDate: r.settlementDate ? new Date(r.settlementDate) : null,
    }));

  const plannedForecast = buildSalesOrderPlannedReceivables({
    salesOrderId,
    orderCode: order.orderCode ?? "SO",
    issueDate: order.issueDate,
    totalActiveValue:
      decimalToNumber(order.totalNetValue) ?? decimalToNumber(order.totalGrossValue) ?? 0,
    paymentTerms: order.paymentTerms,
    paymentMethod: order.paymentMethod,
    nomusRawResponse: order.nomusRawResponse,
    realReceivables: realReceivablesForForecast,
    nfeDocuments: [...nfeMap.values()]
      .map((nfe) => nfe.numero)
      .filter((num): num is string => Boolean(num?.trim())),
  });
  const plannedReceivables = plannedForecast.planned;
  const plannedReceivablesTotal = plannedForecast.totals;

  // Summary base (alertCount preenchido logo abaixo após buildAlerts).
  const summary = buildSummary({
    order,
    customer: order.Customer,
    items,
    facts,
    receivables: dedupReceivables,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
    commercialResponsibleName,
    commercialResponsible,
    orderSeller: orderSellerResolved,
    alertCount: 0,
  });

  // Comparativos Proposta × Pedido — só existem quando há proposta carregada.
  const proposalVsOrderComparisons = buildProposalOrderComparison(
    proposal,
    order,
    items
  );

  // Bloco 8b — frete: header + campos best-effort do rawResponse.
  const freight: OrderFullAuditFreightBlock = {
    freightCondition: order.freightCondition ?? null,
    freightAmount: decimalToNumber(order.totalFreight),
    carrierName: readNomusRawString(order.nomusRawResponse, [
      "transportadora",
      "nomeTransportadora",
      "razaoSocialTransportadora",
      "carrierName",
    ]),
    carrierExternalId: readNomusRawNumber(order.nomusRawResponse, [
      "idTransportadora",
      "externalCarrierId",
      "transportadoraId",
    ]),
    transportMode: readNomusRawString(order.nomusRawResponse, [
      "modalidadeFrete",
      "tipoFrete",
      "descricaoFrete",
      "freightMode",
    ]),
    responsibleForFreight: readNomusRawString(order.nomusRawResponse, [
      "responsavelFrete",
      "responsavelPeloFrete",
      "freightResponsible",
    ]),
    deliveryLocation: order.deliveryLocation ?? null,
    deliveryAddress: readNomusRawString(order.nomusRawResponse, [
      "enderecoEntrega",
      "deliveryAddress",
      "logradouroEntrega",
    ]),
    deliveryNotes: order.notes ?? null,
    internalNotes: order.internalNotes ?? null,
  };

  // Bloco 8c — entrega / produção / frete consolidados.
  const deliveryBlock = buildDeliveryBlock({
    order,
    items,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
    receivables: dedupReceivables,
    operationalStatus: summary.operationalStatus,
  });

  // Bloco 9 — Margem, Preço e Custo (via salesOrderMarginService oficial).
  const marginPricingBlock = await buildMarginPricingBlock({
    order,
    items,
    stockDocumentItems,
    nfeItems,
    proposal,
  });

  // Bloco 10 — Comissões (read-only, apenas leitura do snapshot oficial).
  const commissionsBlock = await loadCommissionBlock({
    order,
    items,
    receivables: dedupReceivables,
    commercialResponsibleName,
  });

  // Re-resolve com snapshot ACTIVE — mesma língua da aba Comissões (PD 02523).
  orderSellerResolved = resolveOrderSellerIdentity(
    {
      salesOrder: {
        externalSellerId: order.externalSellerId,
        nomusSellerName: order.nomusSellerName,
        issueDate: order.issueDate,
        nomusRawResponse: order.nomusRawResponse,
      },
      commissionSnapshot: commissionsBlock.present
        ? {
            rawSellerId: commissionsBlock.rawSellerId,
            rawSellerName: commissionsBlock.rawSellerName,
            canonicalSellerId: commissionsBlock.canonicalSellerId,
            canonicalSellerName: commissionsBlock.canonicalSellerName,
          }
        : null,
    },
    sellerIdentityCtx
  );
  summary.orderSellerName = orderSellerResolved.isMapped
    ? orderSellerResolved.canonicalName
    : orderSellerResolved.isInformed
      ? orderSellerResolved.displayName
      : null;
  summary.orderSellerExternalId = orderSellerResolved.rawExternalId;
  summary.orderSeller = toOrderSellerDto(orderSellerResolved);

  const alerts = buildAlerts({
    order,
    items,
    facts,
    summary,
    orderSeller: orderSellerResolved,
    receivables: dedupReceivables,
    plannedReceivables,
    stockDocuments: [...stockMap.values()],
    stockDocumentItems,
    nfes: [...nfeMap.values()],
    nfeItems,
    proposal,
    proposalVsOrderComparisons,
    delivery: deliveryBlock,
    freight,
    marginPricing: marginPricingBlock,
    commissions: commissionsBlock,
  });
  summary.alertCount = alerts.length;

  // Bloco 3 — Pedido de Venda (cabeçalho + counts oficiais).
  const salesOrderBlock = buildSalesOrderBlock({
    order,
    customer: order.Customer,
    items,
    commercialResponsibleName,
    commercialResponsible,
    orderSeller: orderSellerResolved,
  });

  // Bloco 8 — recebimentos derivados diretamente dos CRs baixados.
  const receipts: OrderFullAuditReceipt[] = dedupReceivables
    .filter((r) => r.settlementDate && r.amountReceived > 0.009)
    .map((r) => {
      const raw = receivableRawByExternalId.get(r.receivableExternalId);
      return {
        receivableExternalId: r.receivableExternalId,
        settlementDate: r.settlementDate,
        paymentDate: readNomusRawString(raw, [
          "dataRecebimento",
          "dataPagamento",
          "paymentDate",
          "settlementDate",
        ]),
        amountReceived: round2(r.amountReceived),
        interest: readNomusRawNumber(raw, [
          "juros",
          "valorJuros",
          "interest",
        ]),
        discount: readNomusRawNumber(raw, [
          "desconto",
          "valorDesconto",
          "discount",
        ]),
        lateFee: readNomusRawNumber(raw, [
          "multa",
          "valorMulta",
          "lateFee",
        ]),
        paymentMethodName: r.paymentMethodName ?? null,
        bankAccountName: r.bankAccountName ?? null,
        sourceInvoiceId: r.sourceInvoiceId ?? null,
        sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
        history: r.comments ?? r.description ?? null,
        externalReceiptId:
          readNomusRawNumber(raw, [
            "idRecebimento",
            "idBaixa",
            "externalReceiptId",
          ]) ?? null,
        userOrSystem: readNomusRawString(raw, [
          "usuario",
          "usuarioBaixa",
          "userName",
          "systemUser",
        ]),
      };
    });

  // Bloco 11 — divergências consolidadas a partir do array `alerts` existente.
  const divergences: OrderFullAuditDivergenceBlock = buildDivergencesBlock(
    alerts,
    items,
    [...stockMap.values()],
    [...nfeMap.values()],
    dedupReceivables
  );

  // Bloco 12 — auditoria técnica (raw só quando pedido explicitamente).
  const matchConfidenceSummary: Record<string, number> = {};
  for (const it of items) {
    const key = (it.matchConfidence ?? "NONE").toUpperCase();
    matchConfidenceSummary[key] = (matchConfidenceSummary[key] ?? 0) + 1;
  }
  const gaps: string[] = [];
  if (!facts.length) gaps.push("OrderToCashAuditFact ausente para o pedido");
  if (order.proposalId && !proposal.present) {
    gaps.push("Proposal existe mas não foi carregada");
  }
  if (!commercialResponsibleName) {
    gaps.push("CrmCustomerCommercialOwner ausente para o cliente");
  }
  const sourceTables = [
    "SalesOrder",
    "SalesOrderItem",
    "SalesOrderNfeLink",
    ...(order.proposalId ? ["Proposal", "ProposalItem"] : []),
    ...(facts.length > 0 ? ["OrderToCashAuditFact"] : []),
    ...(stockMap.size > 0 ? ["NomusStockDocument"] : []),
    ...(nfeMap.size > 0 ? ["NomusNfe"] : []),
    ...(dedupReceivables.length > 0 ? ["NomusAccountsReceivable"] : []),
    ...(commercialResponsibleName ? ["CrmCustomerCommercialOwner"] : []),
  ];

  const technicalAudit: OrderFullAuditTechnicalAuditBlock = buildTechnicalAuditBlock({
    order,
    orderCode: order.orderCode ?? null,
    proposal,
    salesOrderItems: items,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
    receivables: dedupReceivables,
    receipts,
    commissions: commissionsBlock,
    marginPricing: marginPricingBlock,
    commercialResponsibleName,
    runId,
    orderToCashFinishedAt,
    syncedAt: {
      salesOrder: toIso(order.updatedAt),
      lastNfeSyncedAt,
      lastReceivableSyncedAt,
      lastStockDocumentSyncedAt,
    },
    sourceTables,
    matchConfidenceSummary,
    factCount: facts.length,
    gaps,
    factsSample: facts.slice(0, 20) as unknown[],
    includeRaw: Boolean(input.includeRaw),
    alertsCreated: alerts.length,
    alertsResolved: 0,
  });

  return {
    ok: true,
    salesOrderId,
    orderCode: order.orderCode ?? null,
    runId,
    runMeta: {
      runId,
      orderToCashFinishedAt,
    },
    summary,
    timeline,
    items,
    itemFacts: facts,
    receivables: dedupReceivables,
    receivablesTotal,
    plannedReceivables,
    plannedReceivablesTotal,
    stockDocuments: [...stockMap.values()].sort(
      (a, b) =>
        (a.dataDocumento ?? "").localeCompare(b.dataDocumento ?? "") ||
        a.stockDocumentExternalId - b.stockDocumentExternalId
    ),
    stockDocumentItems,
    nfes: [...nfeMap.values()].sort(
      (a, b) =>
        (a.dataEmissao ?? a.dataProcessamento ?? "").localeCompare(
          b.dataEmissao ?? b.dataProcessamento ?? ""
        ) || a.nfeExternalId - b.nfeExternalId
    ),
    nfeItems,
    delivery: deliveryBlock,
    alerts,
    // Blocos previstos (progressivamente saindo dos stubs).
    proposal,
    proposalVsOrderComparisons,
    salesOrder: salesOrderBlock,
    receipts,
    freight,
    marginPricing: marginPricingBlock,
    commissions: commissionsBlock,
    divergences,
    technicalAudit,
  };
}

/* ---------------------------------------------------------------------- */
/*  Stubs dos blocos que serão preenchidos em prompts seguintes            */
/* ---------------------------------------------------------------------- */

const PRICE_TOLERANCE = 0.0001;
const APPROVED_PROPOSAL_STATUSES = new Set([
  "APPROVED",
  "ACCEPTED",
  "SIGNED",
  "WON",
  "CONVERTED",
  "ORDER_CREATED",
]);

async function loadProposalBlock(
  proposalId: string,
  salesOrderItems: OrderFullAuditItem[]
): Promise<OrderFullAuditProposalBlock> {
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        items: {
          include: {
            Product: {
              select: { skuCode: true, name: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!proposal) return emptyProposalBlock(proposalId, "PROPOSAL_NOT_FOUND");

    // Mapa proposalItemId → SalesOrderItem (via FK oficial).
    const salesOrderItemByProposalItemId = new Map<string, OrderFullAuditItem>();
    for (const it of salesOrderItems) {
      if (it.proposalItemId) {
        salesOrderItemByProposalItemId.set(it.proposalItemId, it);
      }
    }

    const items: OrderFullAuditProposalItem[] = proposal.items.map((pi) => {
      const so = salesOrderItemByProposalItemId.get(pi.id);
      const proposalQty = decimalToNumber(pi.quantity);
      const proposalPrice = decimalToNumber(pi.negotiatedPrice);
      const proposalDiscount = decimalToNumber(pi.discountValue) ?? 0;
      const proposalTotal = round2(
        (proposalQty ?? 0) * (proposalPrice ?? 0) - proposalDiscount
      );

      const alerts: string[] = [];
      let converted: OrderFullAuditProposalItem["convertedToSalesOrderItem"] = null;
      if (so) {
        const soQty = so.quantity ?? 0;
        const soPrice = so.unitPrice ?? 0;
        const soTotal = so.totalNetValue ?? 0;
        const quantityDiff = round2(soQty - (proposalQty ?? 0));
        const priceDiff = round2(soPrice - (proposalPrice ?? 0));
        const totalDiff = round2(soTotal - proposalTotal);
        converted = {
          salesOrderItemId: so.salesOrderItemId,
          quantity: so.quantity,
          negotiatedPrice: so.unitPrice,
          totalNetValue: so.totalNetValue,
          quantityDiff,
          negotiatedPriceDiff: priceDiff,
          totalNetValueDiff: totalDiff,
        };
        if (Math.abs(priceDiff) > PRICE_TOLERANCE) alerts.push("PROPOSAL_PRICE_MISMATCH");
        if (Math.abs(quantityDiff) > 0.0001) alerts.push("PROPOSAL_QUANTITY_MISMATCH");
      } else {
        alerts.push("PROPOSAL_ITEM_NOT_CONVERTED");
      }

      return {
        proposalItemId: pi.id,
        productId: pi.productId,
        productSku: pi.Product?.skuCode ?? null,
        productName: pi.Product?.name ?? null,
        unit: pi.unit ?? null,
        quantity: proposalQty,
        unitCost: decimalToNumber(pi.unitCost),
        suggestedPrice: decimalToNumber(pi.suggestedPrice),
        negotiatedPrice: proposalPrice,
        discountPerc: decimalToNumber(pi.discountPerc),
        discountValue: decimalToNumber(pi.discountValue),
        totalNetValue: proposalTotal,
        marginValue: decimalToNumber(pi.marginValue),
        marginPerc: decimalToNumber(pi.marginPerc),
        taxesPerc: decimalToNumber(pi.taxesPerc),
        taxesValue: decimalToNumber(pi.taxesValue),
        commissionPerc: decimalToNumber(pi.commissionPerc),
        commissionValue: decimalToNumber(pi.commissionValue),
        freightValue: decimalToNumber(pi.freightValue),
        externalItemStatus: pi.externalItemStatus ?? null,
        priceTableCode: pi.priceTableCode ?? null,
        convertedToSalesOrderItem: converted,
        alerts,
      };
    });

    const status = proposal.status ?? null;
    const isApproved = status
      ? APPROVED_PROPOSAL_STATUSES.has(status.toUpperCase())
      : false;
    const proposalTotal = decimalToNumber(proposal.totalNetValue);
    const convertedToOrderValue = round2(
      items
        .filter((i) => i.convertedToSalesOrderItem != null)
        .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
    );

    // Deltas agregados (para header e para o card "Diferença Proposta × Pedido").
    const orderQty = salesOrderItems.reduce((s, i) => s + (i.quantity ?? 0), 0);
    const proposalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
    const orderTotal = salesOrderItems.reduce(
      (s, i) => s + (i.totalNetValue ?? 0),
      0
    );
    const proposalPriceSum = items.reduce(
      (s, i) => s + (i.negotiatedPrice ?? 0),
      0
    );
    const orderPriceSum = salesOrderItems.reduce(
      (s, i) => s + (i.unitPrice ?? 0),
      0
    );
    const proposalMarginPerc = decimalToNumber(proposal.totalMarginPerc);

    return {
      present: true,
      emptyReason: null,
      proposalId: proposal.id,
      proposalNumber: proposal.number != null ? String(proposal.number) : null,
      title: proposal.title ?? null,
      externalProposalId: proposal.externalProposalId ?? null,
      externalProposalCode: proposal.externalProposalCode ?? null,
      externalSellerId: proposal.externalSellerId ?? null,
      status,
      createdAt: toIso(proposal.createdAt),
      approvedAt: isApproved ? toIso(proposal.updatedAt) : null,
      expectedCloseDate: toIso(proposal.expectedCloseDate ?? null),
      validityDays: proposal.validityDays ?? null,
      validUntil: (() => {
        if (!proposal.createdAt || !proposal.validityDays) return null;
        const base = new Date(proposal.createdAt);
        base.setDate(base.getDate() + proposal.validityDays);
        return toIso(base);
      })(),
      responsible: proposal.responsible ?? null,
      companyIssuer: proposal.companyIssuer ?? null,
      paymentTerms: proposal.paymentTerms ?? null,
      paymentMethod: proposal.paymentMethod ?? null,
      freightCondition: proposal.freightCondition ?? null,
      priceTableId: proposal.priceTableId ?? null,
      priceTableVersionId: proposal.priceTableVersionId ?? null,
      priceTableCode: proposal.priceTableCode ?? null,
      priceSource: proposal.priceSource ?? null,
      totals: {
        totalItems: proposal.totalItems ?? null,
        totalGrossValue: decimalToNumber(proposal.totalGrossValue),
        totalDiscount: decimalToNumber(proposal.totalDiscount),
        totalNetValue: proposalTotal,
        totalCost: decimalToNumber(proposal.totalCost),
        totalMarginValue: decimalToNumber(proposal.totalMarginValue),
        totalMarginPerc: proposalMarginPerc,
        totalTaxes: decimalToNumber(proposal.totalTaxes),
        totalCommission: decimalToNumber(proposal.totalCommission),
        totalFreight: decimalToNumber(proposal.totalFreight),
      },
      derivedValues: {
        proposalTotalValue: proposalTotal,
        approvedTotalValue: isApproved ? proposalTotal : null,
        convertedToOrderValue,
        proposalVsOrderDiff:
          proposalTotal != null
            ? round2(proposalTotal - orderTotal)
            : null,
      },
      items,
      deltasVsSalesOrder: {
        quantityDiff: round2(orderQty - proposalQty),
        negotiatedPriceDiff: round2(orderPriceSum - proposalPriceSum),
        totalNetValueDiff:
          proposalTotal != null
            ? round2(orderTotal - proposalTotal)
            : round2(orderTotal),
        marginPercDiff: proposalMarginPerc,
      },
    };
  } catch (error) {
    console.warn("[orderFullAuditService] falha ao carregar Proposal.", error);
    return emptyProposalBlock(proposalId, "PROPOSAL_LOAD_ERROR");
  }
}

function buildProposalOrderComparison(
  proposal: OrderFullAuditProposalBlock,
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>,
  salesOrderItems: OrderFullAuditItem[]
): OrderFullAuditProposalOrderComparison | null {
  if (!proposal.present) return null;

  const orderTotal = decimalToNumber(order.totalNetValue);
  const proposalTotal = proposal.totals.totalNetValue;

  const paymentTermsMatches = normalizeCompareString(
    proposal.paymentTerms
  ) === normalizeCompareString(order.paymentTerms);
  const paymentMethodMatches = normalizeCompareString(
    proposal.paymentMethod
  ) === normalizeCompareString(order.paymentMethod);
  const freightMatches = normalizeCompareString(
    proposal.freightCondition
  ) === normalizeCompareString(order.freightCondition);

  const totalDiff =
    proposalTotal != null && orderTotal != null
      ? round2(orderTotal - proposalTotal)
      : null;

  const proposalItemCount = proposal.items.length;
  const salesOrderItemCount = salesOrderItems.length;
  const converted = proposal.items.filter(
    (i) => i.convertedToSalesOrderItem != null
  );
  const priceMismatches = proposal.items.filter((i) =>
    i.alerts.includes("PROPOSAL_PRICE_MISMATCH")
  ).length;
  const proposalItemsNotConverted = proposalItemCount - converted.length;
  const salesOrderItemsWithoutProposalItem = salesOrderItems.filter(
    (i) => i.proposalItemId == null
  ).length;

  return {
    paymentTerms: {
      proposal: proposal.paymentTerms,
      salesOrder: order.paymentTerms ?? null,
      matches: paymentTermsMatches,
    },
    paymentMethod: {
      proposal: proposal.paymentMethod,
      salesOrder: order.paymentMethod ?? null,
      matches: paymentMethodMatches,
    },
    freightCondition: {
      proposal: proposal.freightCondition,
      salesOrder: order.freightCondition ?? null,
      matches: freightMatches,
    },
    totalNetValue: {
      proposal: proposalTotal,
      salesOrder: orderTotal,
      diff: totalDiff,
      matches:
        totalDiff != null && Math.abs(totalDiff) <= MONEY_TOLERANCE,
    },
    itemsMapping: {
      proposalItemCount,
      salesOrderItemCount,
      convertedCount: converted.length,
      proposalItemsNotConverted,
      salesOrderItemsWithoutProposalItem,
      priceMismatches,
    },
  };
}

function normalizeCompareString(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Alias público. `userContext` é opcional — a autorização já vem da rota
 * (`orderStatusPedidosGuard`); mantido só para permitir extensões futuras.
 */
export async function getOrderFullAudit(input: {
  salesOrderId: string;
  runId?: string | null;
  orderCode?: string | null;
  includeRaw?: boolean;
  userContext?: { userId?: string | null; permissions?: readonly string[] } | null;
}): Promise<
  OrderFullAuditPayload | { ok: false; status: number; error: string }
> {
  const loaded = await loadOrderFullAudit({
    salesOrderId: input.salesOrderId,
    runId: input.runId ?? null,
    orderCode: input.orderCode ?? null,
    includeRaw: Boolean(input.includeRaw),
  });
  if (!("ok" in loaded) || loaded.ok !== true) {
    return loaded;
  }

  const allowFiscal = canViewSalesOrderFiscalTaxesFromPermissions(
    input.userContext?.permissions ?? null
  );
  if (!allowFiscal) {
    return { ...loaded, fiscalTaxes: null };
  }

  try {
    const fiscalTaxes = await buildSalesOrderFiscalTaxesPayload(prisma, loaded);
    return { ...loaded, fiscalTaxes };
  } catch (err) {
    console.error("getOrderFullAudit fiscalTaxes", err);
    return { ...loaded, fiscalTaxes: null };
  }
}

function emptyProposalBlock(
  proposalId: string | null,
  emptyReason:
    | "NO_PROPOSAL_LINK"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_LOAD_ERROR" = "NO_PROPOSAL_LINK"
): OrderFullAuditProposalBlock {
  // `present=false` sinaliza empty state para a UI. `emptyReason` explicita a causa.
  return {
    present: false,
    emptyReason,
    proposalId,
    proposalNumber: null,
    title: null,
    externalProposalId: null,
    externalProposalCode: null,
    externalSellerId: null,
    status: null,
    createdAt: null,
    approvedAt: null,
    expectedCloseDate: null,
    validityDays: null,
    validUntil: null,
    responsible: null,
    companyIssuer: null,
    paymentTerms: null,
    paymentMethod: null,
    freightCondition: null,
    priceTableId: null,
    priceTableVersionId: null,
    priceTableCode: null,
    priceSource: null,
    totals: {
      totalItems: null,
      totalGrossValue: null,
      totalDiscount: null,
      totalNetValue: null,
      totalCost: null,
      totalMarginValue: null,
      totalMarginPerc: null,
      totalTaxes: null,
      totalCommission: null,
      totalFreight: null,
    },
    derivedValues: {
      proposalTotalValue: null,
      approvedTotalValue: null,
      convertedToOrderValue: null,
      proposalVsOrderDiff: null,
    },
    items: [],
    deltasVsSalesOrder: null,
  };
}

/**
 * Nomes de setor que já apareceram indevidamente como "Responsável Comercial"
 * em drilldowns antigos. Se `SalesOrder.responsible` estiver em uma dessas
 * palavras, emitir `OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE`.
 */
const OPERATIONAL_SECTOR_KEYWORDS = [
  "FATURAMENTO",
  "FINANCEIRO",
  "EXPEDICAO",
  "EXPEDIÇÃO",
  "PRODUCAO",
  "PRODUÇÃO",
  "COMPRAS",
  "PCP",
  "ALMOXARIFADO",
  "LOGISTICA",
  "LOGÍSTICA",
];

function isOperationalSectorName(value: string | null | undefined): boolean {
  if (!value) return false;
  const upper = value.trim().toUpperCase();
  return OPERATIONAL_SECTOR_KEYWORDS.some((k) => upper === k || upper.startsWith(k));
}

/**
 * Extrai um campo string do `nomusRawResponse` sem quebrar quando o payload
 * mudar de forma. Aceita chaves alternativas em ordem de precedência.
 */
function readNomusRawString(
  raw: unknown,
  keys: readonly string[]
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}
function readNomusRawNumber(raw: unknown, keys: readonly string[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function buildSalesOrderBlock(input: {
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>;
  customer: { id: string; companyName: string; tradeName: string | null; taxId: string | null } | null;
  items: OrderFullAuditItem[];
  commercialResponsibleName: string | null;
  commercialResponsible: ResolvedCommercialResponsibleDisplay;
  orderSeller: ResolvedOrderSellerIdentity;
}): OrderFullAuditSalesOrderBlock {
  const order = input.order;
  const raw = order.nomusRawResponse;

  const orderType = readNomusRawString(raw, [
    "tipoPedido",
    "tipo",
    "orderType",
    "descricaoTipoPedido",
  ]);
  const movementType = readNomusRawString(raw, [
    "tipoMovimentacao",
    "descricaoMovimentacao",
    "movimentacao",
    "operationType",
  ]);
  const paymentTermsText = readNomusRawString(raw, [
    "descricaoCondicaoPagamento",
    "condicaoPagamentoDescricao",
    "textoCondicaoPagamento",
    "paymentTermsDescription",
  ]);
  const freightMode = readNomusRawString(raw, [
    "modalidadeFrete",
    "tipoFrete",
    "descricaoFrete",
    "freightMode",
  ]);
  const insurance = readNomusRawNumber(raw, [
    "valorSeguro",
    "totalSeguro",
    "seguro",
    "insurance",
  ]);
  const otherExpenses = readNomusRawNumber(raw, [
    "outrasDespesas",
    "totalOutrasDespesas",
    "otherExpenses",
    "outrasDespesasAcessorias",
  ]);

  const itemsSum = round2(
    input.items.reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const headerNet = decimalToNumber(order.totalNetValue);
  const headerVsItemsDiff =
    headerNet != null ? round2(headerNet - itemsSum) : null;

  const totalItems = input.items.length;
  const canceled = input.items.filter((i) =>
    isInactiveSalesOrderItemNomusFlags({
      nomusIsCanceled: i.nomusIsCanceled,
      nomusIsStale: i.nomusIsStale,
      nomusItemStatusNormalized: i.nomusItemStatusNormalized,
    })
  ).length;
  const stale = input.items.filter((i) => i.nomusIsStale).length;
  const cut = input.items.filter((i) =>
    isFulfilledWithCutSalesOrderItem({
      nomusIsCut: i.nomusIsCut,
      nomusItemStatusNormalized: i.nomusItemStatusNormalized,
    })
  ).length;
  const active = totalItems - canceled;
  const fulfilled = input.items.filter(
    (i) =>
      (i.nomusItemStatusNormalized ?? "").toUpperCase() === "FULFILLED" ||
      (i.nomusItemStatusNormalized ?? "").toUpperCase() ===
        "FULFILLED_WITH_CUT"
  ).length;
  const pendingActive = Math.max(0, active - fulfilled);
  const activeValueTotal = round2(
    input.items
      .filter(
        (i) =>
          !isInactiveSalesOrderItemNomusFlags({
            nomusIsCanceled: i.nomusIsCanceled,
            nomusIsStale: i.nomusIsStale,
            nomusItemStatusNormalized: i.nomusItemStatusNormalized,
          })
      )
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const fulfilledActiveValue = round2(
    input.items
      .filter(
        (i) =>
          !isInactiveSalesOrderItemNomusFlags({
            nomusIsCanceled: i.nomusIsCanceled,
            nomusIsStale: i.nomusIsStale,
            nomusItemStatusNormalized: i.nomusItemStatusNormalized,
          }) &&
          (i.nomusItemStatusNormalized ?? "").toUpperCase().startsWith("FULFILLED")
      )
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const fulfillmentPercentActive =
    activeValueTotal > MONEY_TOLERANCE
      ? Math.round((fulfilledActiveValue / activeValueTotal) * 10000) / 100
      : fulfilled >= active && active > 0
        ? 100
        : 0;

  const lastNomusSeen = latestIso(
    input.items
      .map((i) => (i.matchConfidence ? null : null))
      .concat([toIso(order.updatedAt)])
  );

  const customerName =
    input.customer?.tradeName ?? input.customer?.companyName ?? null;

  return {
    orderCode: order.orderCode ?? null,
    status: order.status ?? null,
    sourceSystem: order.sourceSystem ?? null,
    issueDate: toIso(order.issueDate),
    expectedDeliveryDate: toIso(order.expectedDeliveryDate),
    sentToNomusAt: toIso(order.sentToNomusAt),
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
    lastSyncedAt: lastNomusSeen ?? toIso(order.updatedAt),
    identifiers: {
      id: order.id,
      externalSalesOrderId: order.externalSalesOrderId ?? null,
      externalSalesOrderCode: order.externalSalesOrderCode ?? null,
      externalCustomerId: order.externalCustomerId ?? null,
      externalCompanyId: order.externalCompanyId ?? null,
    },
    customer: {
      id: input.customer?.id ?? null,
      name: customerName,
      document: input.customer?.taxId ?? null,
    },
    companyName: order.companyIssuer ?? null,
    orderType,
    movementType,
    operationalSector: order.responsible ?? null,
    operationalResponsibleName: order.responsible ?? null,
    commercialResponsibleName: input.commercialResponsibleName,
    commercialResponsible: input.commercialResponsible,
    orderSellerName: input.orderSeller.isMapped
      ? input.orderSeller.canonicalName
      : input.orderSeller.isInformed
        ? input.orderSeller.displayName
        : null,
    orderSellerExternalId: input.orderSeller.rawExternalId,
    orderSeller: toOrderSellerDto(input.orderSeller),
    paymentTerms: order.paymentTerms ?? null,
    paymentTermsText,
    paymentMethod: order.paymentMethod ?? null,
    freightCondition: order.freightCondition ?? null,
    freightMode,
    deliveryLocation: order.deliveryLocation ?? null,
    notes: order.notes ?? null,
    internalNotes: order.internalNotes ?? null,
    totals: {
      grossValue: decimalToNumber(order.totalGrossValue),
      discount: decimalToNumber(order.totalDiscount),
      netValue: headerNet,
      cost: decimalToNumber(order.totalCost),
      marginValue: decimalToNumber(order.totalMarginValue),
      marginPerc: decimalToNumber(order.totalMarginPerc),
      taxes: decimalToNumber(order.totalTaxes),
      freight: decimalToNumber(order.totalFreight),
      insurance,
      otherExpenses,
      itemsSummedNetValue: itemsSum,
      headerVsItemsDiff,
    },
    itemCounts: {
      total: totalItems,
      active,
      canceled,
      cut,
      stale,
      fulfilled,
      pendingActive,
      fulfillmentPercentActive,
    },
    nomusRawResponsePresent: order.nomusRawResponse != null,
  };
}

function buildDeliveryBlock(input: {
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>;
  items: OrderFullAuditItem[];
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  receivables: OrderFullAuditReceivable[];
  operationalStatus: string | null;
}): OrderFullAuditDeliveryBlock {
  const order = input.order;
  const lastStock = latestIso(input.stockDocuments.map((d) => d.dataDocumento));
  const lastNfe = latestIso(
    input.nfes.map((n) => n.dataEmissao ?? n.dataProcessamento)
  );
  const lastReceipt = latestIso(input.receivables.map((r) => r.settlementDate));

  const issueIso = toIso(order.issueDate);
  const expectedIso = toIso(order.expectedDeliveryDate);

  const daysBetween = (aIso: string | null, bIso: string | null): number | null => {
    if (!aIso || !bIso) return null;
    const a = new Date(aIso);
    const b = new Date(bIso);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.round(
      (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)
    );
  };

  const leadTimePromisedDays = daysBetween(issueIso, expectedIso);
  const leadTimeRealSource = lastNfe ?? lastStock;
  const leadTimeRealDays = daysBetween(issueIso, leadTimeRealSource);
  const delayDays =
    expectedIso && leadTimeRealSource
      ? daysBetween(expectedIso, leadTimeRealSource)
      : expectedIso
        ? daysBetween(expectedIso, new Date().toISOString())
        : null;

  const nowIso = new Date().toISOString();
  const overdueItems = input.items.filter((it) => {
    if (it.nomusIsCanceled || it.nomusIsStale) return false; // cancelado nunca é atraso
    if (it.nomusIsCut) return false; // corte encerra pendência
    if ((it.activePendingQuantity ?? 0) <= 0) return false;
    if (!it.expectedDeliveryDate) return false;
    return it.expectedDeliveryDate < nowIso;
  });

  const readyNotInvoicedItems = input.items.filter(
    (it) =>
      it.saldoPronto != null &&
      it.saldoPronto > 0.0001 &&
      (it.invoicedQuantity ?? 0) <
        (it.quantity ?? 0) - MONEY_TOLERANCE &&
      !it.nomusIsCanceled &&
      !it.nomusIsStale
  );

  const active = input.items.filter(
    (i) => !i.nomusIsCanceled && !i.nomusIsStale
  );
  const canceled = input.items.filter(
    (i) => i.nomusIsCanceled || i.nomusIsStale
  );
  const cut = input.items.filter((i) => i.nomusIsCut);
  const fulfilled = input.items.filter((i) =>
    (i.nomusItemStatusNormalized ?? "").toUpperCase().startsWith("FULFILLED")
  );
  const pendingActive = active.filter(
    (i) => (i.activePendingQuantity ?? 0) > 0.0001 && !i.nomusIsCut
  );

  const sumOrProduce = (
    fn: (i: OrderFullAuditItem) => number | null | undefined
  ): number =>
    round2(
      input.items.reduce((s, i) => {
        const v = fn(i);
        return s + (v ?? 0);
      }, 0)
    );

  return {
    expectedDeliveryDate: expectedIso,
    orderIssueDate: issueIso,
    lastStockDocumentDate: lastStock,
    lastNfeDate: lastNfe,
    lastReceivableSettlement: lastReceipt,
    freightCondition: order.freightCondition ?? null,
    paymentTerms: order.paymentTerms ?? null,
    paymentMethod: order.paymentMethod ?? null,
    leadTimePromisedDays,
    leadTimeRealDays,
    delayDays,
    forecastNextDeliveryDate: leadTimeRealSource ?? expectedIso,
    operationalStatus: input.operationalStatus,
    itemCounts: {
      total: input.items.length,
      active: active.length,
      fulfilled: fulfilled.length,
      pendingActive: pendingActive.length,
      canceled: canceled.length,
      cut: cut.length,
      overdue: overdueItems.length,
      readyNotInvoiced: readyNotInvoicedItems.length,
    },
    totals: {
      quantityOrdered: sumOrProduce((i) => i.quantity),
      quantityProduced: sumOrProduce((i) => i.productionQuantity),
      quantityInvoiced: sumOrProduce((i) => i.invoicedQuantity),
      saldoAFaturar: sumOrProduce((i) => i.saldoAFaturar),
      saldoPronto: sumOrProduce((i) => i.saldoPronto),
    },
  };
}

function buildTechnicalAuditBlock(input: {
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>;
  orderCode: string | null;
  proposal: OrderFullAuditProposalBlock;
  salesOrderItems: OrderFullAuditItem[];
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  receivables: OrderFullAuditReceivable[];
  receipts: OrderFullAuditReceipt[];
  commissions: OrderFullAuditCommissionBlock;
  marginPricing: OrderFullAuditMarginPricingBlock;
  commercialResponsibleName: string | null;
  runId: string | null;
  orderToCashFinishedAt: string | null;
  syncedAt: {
    salesOrder: string | null;
    lastNfeSyncedAt: string | null;
    lastReceivableSyncedAt: string | null;
    lastStockDocumentSyncedAt: string | null;
  };
  sourceTables: string[];
  matchConfidenceSummary: Record<string, number>;
  factCount: number;
  gaps: string[];
  factsSample: unknown[];
  includeRaw: boolean;
  alertsCreated: number;
  alertsResolved: number;
}): OrderFullAuditTechnicalAuditBlock {
  const {
    order,
    proposal,
    salesOrderItems,
    stockDocuments,
    nfes,
    receivables,
    receipts,
    commissions,
    marginPricing,
    commercialResponsibleName,
    runId,
    orderToCashFinishedAt,
    syncedAt,
    sourceTables,
    matchConfidenceSummary,
    factCount,
    gaps,
    factsSample,
    includeRaw,
  } = input;

  const source = (
    name: string,
    label: string,
    category: OrderFullAuditTechnicalSource["category"],
    recordCount: number,
    note: string | null = null
  ): OrderFullAuditTechnicalSource => ({
    name,
    label,
    category,
    recordCount,
    status: recordCount > 0 ? "loaded" : "not_found",
    note,
  });

  const sources: OrderFullAuditTechnicalSource[] = [
    source(
      "SalesOrder",
      "Pedido de venda",
      "SALES_ORDER",
      order ? 1 : 0,
      order?.nomusRawResponse ? "com rawResponse" : "sem rawResponse"
    ),
    source(
      "SalesOrderItem",
      "Itens do pedido",
      "SALES_ORDER",
      salesOrderItems.length
    ),
    source(
      "Proposal",
      "Proposta",
      "PROPOSAL",
      proposal.present ? 1 : 0,
      proposal.emptyReason
    ),
    source(
      "ProposalItem",
      "Itens da proposta",
      "PROPOSAL",
      proposal.present ? proposal.items.length : 0
    ),
    source(
      "NomusStockDocument",
      "Documentos de saída",
      "NOMUS_STOCK_DOCUMENT",
      stockDocuments.length
    ),
    source(
      "NomusStockDocumentItem",
      "Itens dos documentos",
      "NOMUS_STOCK_DOCUMENT",
      stockDocuments.reduce((s, d) => s + (d.productLines ?? 0), 0)
    ),
    source("NomusNfe", "NF-e", "NOMUS_NFE", nfes.length),
    source(
      "NomusAccountsReceivable",
      "Contas a Receber",
      "NOMUS_RECEIVABLE",
      receivables.length
    ),
    source(
      "Receipts/Baixas",
      "Baixas registradas",
      "NOMUS_RECEIVABLE",
      receipts.length
    ),
    source(
      "OrderToCashAuditFact",
      "Facts item × doc × NF × CR",
      "AUDIT_FACT",
      factCount,
      runId ? `runId=${runId}` : "sem run vinculada"
    ),
    // PortfolioReconciliationFact — não usado pelo audit-full (informativo).
    {
      name: "PortfolioReconciliationFact",
      label: "Facts de conciliação de carteira",
      category: "AUDIT_FACT",
      recordCount: 0,
      status: "not_applicable",
      note: "não consumido pelo audit-full (usado apenas pelo dashboard Status Pedidos)",
    },
    source(
      "CommissionOrderSnapshot",
      "Snapshot oficial de comissão",
      "COMMISSION",
      commissions.present ? 1 : 0
    ),
    source(
      "CommissionReceiptLedgerLine",
      "Ledger de baixas de comissão",
      "COMMISSION",
      commissions.receipts.length
    ),
    // PriceTable / margin service — indireto via calculateSalesOrderMarginsForOrders.
    {
      name: "PriceTable / PriceTableItem",
      label: "Tabela de preço oficial",
      category: "PRICING",
      recordCount: marginPricing.officialPriceReferences.length,
      status:
        marginPricing.officialPriceReferences.length > 0
          ? "loaded"
          : "not_found",
      note:
        marginPricing.source === "MARGIN_SERVICE_RECOMPUTED"
          ? "calculado via calculateSalesOrderMarginsForOrders"
          : "sem tabela vigente encontrada",
    },
    {
      name: "Customer / CrmCustomerCommercialOwner",
      label: "Cliente + CRM",
      category: "CRM",
      recordCount: 1,
      status: commercialResponsibleName ? "loaded" : "not_found",
      note: commercialResponsibleName
        ? "responsável comercial resolvido"
        : "sem responsável comercial cadastrado",
    },
  ];

  const identifiers: OrderFullAuditTechnicalIdentifiers = {
    salesOrderId: order.id,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    externalSalesOrderCode: order.externalSalesOrderCode ?? null,
    orderCode: order.orderCode ?? null,
    proposalId: proposal.present ? proposal.proposalId : order.proposalId,
    externalProposalId: proposal.present ? proposal.externalProposalId : null,
    customerId: order.customerId,
    externalCustomerId: order.externalCustomerId ?? null,
    externalSellerId: order.externalSellerId ?? null,
    externalCompanyId: order.externalCompanyId ?? null,
    stockDocumentExternalIds: stockDocuments
      .map((d) => d.stockDocumentExternalId)
      .filter((x) => x > 0),
    nfeExternalIds: nfes.map((n) => n.nfeExternalId).filter((x) => x > 0),
    receivableExternalIds: receivables.map((r) => r.receivableExternalId),
    commissionSnapshotId: commissions.snapshotId,
    commissionLedgerLineKeys: commissions.receipts.map(
      (r) => r.ledgerLineKey
    ),
    runId,
    runFinishedAt: orderToCashFinishedAt,
    runSource: "OrderToCashAuditFact",
  };

  const rulesApplied: OrderFullAuditTechnicalRule[] = [
    {
      code: "ITEM_STATUS_PER_LINE",
      label: "Status do item por linha do pedido",
      description:
        "Cada `SalesOrderItem.id` mantém status independente. SKU repetido não herda status entre linhas.",
      category: "ORDER_ITEM",
    },
    {
      code: "CANCELED_ITEM_IGNORED",
      label: "Item cancelado ignorado em pendência",
      description:
        "`nomusIsCanceled=true` ou `nomusIsStale=true` não conta como pendente, não gera comissão, não busca margem/tabela.",
      category: "ORDER_ITEM",
    },
    {
      code: "CUT_ITEM_ACTIVE_ONLY",
      label: "Item com corte considera só parte ativa/atendida",
      description:
        "`nomusIsCut=true` encerra pendência do saldo cortado; parte atendida entra em margem/comissão.",
      category: "ORDER_ITEM",
    },
    {
      code: "STALE_ITEM_HISTORY_ONLY",
      label: "Item stale mantido apenas para histórico",
      description:
        "Item que sumiu do payload Nomus não entra como ativo em nenhum cálculo.",
      category: "ORDER_ITEM",
    },
    {
      code: "DOCUMENT_ALLOCATION_BY_ITEM",
      label: "Alocação documento → pedido por linha",
      description:
        "Casamento via `OrderToCashAuditFact.salesOrderItemId` prioritário; fallback só quando SKU é único no pedido.",
      category: "DOCUMENT_ALLOCATION",
    },
    {
      code: "NFE_HEADER_NEVER_INFLATES",
      label: "Cabeçalho NF não infla carteira",
      description:
        "Valor total da NF é exibido em coluna separada. `allocatedValueToOrder` nunca excede `activeOrderValue`.",
      category: "NFE",
    },
    {
      code: "NFE_CANCELED_NOT_VALID_BILLING",
      label: "NF cancelada não compõe faturamento válido",
      description:
        "`NomusNfe.status === 7` (cancelada) aparece na auditoria com badge Cancelada, gera alerta NFE_CANCELED_LINKED_TO_ORDER e é excluída de `nfeValidValue` / `nfeAllocatedValue`.",
      category: "NFE",
    },
    {
      code: "OFFICIAL_RECEIVABLE_PREVAILS",
      label: "CR real prevalece sobre forecast",
      description:
        "Recebíveis vêm exclusivamente de `NomusAccountsReceivable` (via `sourceInvoiceId`). Auditoria não gera CR forecasted.",
      category: "RECEIVABLE",
    },
    {
      code: "COMMISSION_READ_ONLY",
      label: "Comissão read-only",
      description:
        "Snapshot oficial (`CommissionOrderSnapshot.ACTIVE`) é a única fonte. Baixas via `CommissionReceiptLedgerLine`. Comissão paga NUNCA é alterada aqui.",
      category: "COMMISSION",
    },
    {
      code: "MARGIN_ACTIVE_ONLY",
      label: "Margem só para itens ativos",
      description:
        "`calculateSalesOrderMarginsForOrders` chamado com todos os itens; UI filtra cancelados/cut/stale das totais.",
      category: "MARGIN",
    },
    {
      code: "SELLER_FROM_ORDER_ONLY",
      label: "Vendedor pedido ≠ Responsável Comercial",
      description:
        "Vendedor comissionável vem de `SalesOrder.nomusSellerName`. Responsável Comercial vem de `CrmCustomerCommercialOwner`. Nunca confundidos.",
      category: "COMMERCIAL",
    },
  ];

  const history: OrderFullAuditTechnicalHistory = {
    lastNomusSalesOrderSync: syncedAt.salesOrder,
    lastNomusNfeSync: syncedAt.lastNfeSyncedAt,
    lastNomusStockDocumentSync: syncedAt.lastStockDocumentSyncedAt,
    lastNomusReceivableSync: syncedAt.lastReceivableSyncedAt,
    lastOrderToCashRebuild: orderToCashFinishedAt,
    lastPortfolioReconciliationRun: null,
    lastCommissionRebuild: null,
    auditRunUser: null,
    auditRunProcess: "orderFullAuditService.loadOrderFullAudit",
    auditRunCommit: process.env.APP_COMMIT_SHA ?? null,
    alertsCreated: input.alertsCreated,
    alertsResolved: input.alertsResolved,
  };

  const rawStatus: OrderFullAuditTechnicalRawStatus = {
    included: includeRaw,
    reason: includeRaw
      ? "Raw expandido a pedido explícito (includeRaw=true)."
      : "Raw técnico oculto. Use includeRaw=true ou permissão técnica para visualizar.",
    requiredPermission: "audit.raw.read",
  };

  const rawPayloads: OrderFullAuditTechnicalRawPayloads | undefined = includeRaw
    ? {
        nomusRawResponse: order.nomusRawResponse ?? null,
        nomusRawItems: Object.fromEntries(
          order.items.map((i) => [i.id, i.nomusRawItem ?? null])
        ),
        stockDocumentPayloads: {},
        nfePayloads: {},
        receivablePayloads: {},
        factsSample,
      }
    : undefined;

  return {
    orderToCashRunId: runId,
    orderToCashFinishedAt,
    syncedAt,
    sourceTables,
    sources,
    identifiers,
    rulesApplied,
    history,
    matchConfidenceSummary,
    factCount,
    gaps,
    rawStatus,
    ...(rawPayloads ? { rawPayloads } : {}),
  };
}

function buildDivergencesBlock(
  alerts: OrderFullAuditAlert[],
  items: OrderFullAuditItem[],
  stockDocuments: OrderFullAuditStockDocument[],
  nfes: OrderFullAuditNfe[],
  receivables: OrderFullAuditReceivable[]
): OrderFullAuditDivergenceBlock {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    warning: 0,
    info: 0,
  };
  const byCategory: Record<OrderFullAuditAlertCategory, number> = {
    COMMERCIAL: 0,
    ORDER: 0,
    ORDER_ITEM: 0,
    STOCK_DOCUMENT: 0,
    NFE: 0,
    RECEIVABLE: 0,
    RECEIPT: 0,
    DELIVERY: 0,
    FREIGHT: 0,
    MARGIN_PRICING: 0,
    COMMISSION: 0,
    INTEGRATION_NOMUS: 0,
    REGISTRATION: 0,
  };
  let financialImpactTotal = 0;
  for (const a of alerts) {
    counts[a.severity] = (counts[a.severity] ?? 0) + 1;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    if (a.financialImpact != null && Number.isFinite(a.financialImpact)) {
      financialImpactTotal += Math.abs(a.financialImpact);
    }
  }

  // Contagem de entidades únicas afetadas (não repete).
  const affectedItemIds = new Set<string>();
  const affectedTitles = new Set<string>();
  const affectedDocuments = new Set<string>();
  const affectedNfes = new Set<string>();
  for (const a of alerts) {
    if (!a.reference) continue;
    switch (a.category) {
      case "ORDER_ITEM":
      case "MARGIN_PRICING":
      case "DELIVERY":
      case "COMMISSION":
      case "COMMERCIAL":
        affectedItemIds.add(a.reference);
        break;
      case "RECEIVABLE":
      case "RECEIPT":
        affectedTitles.add(a.reference);
        break;
      case "STOCK_DOCUMENT":
        affectedDocuments.add(a.reference);
        break;
      case "NFE":
        affectedNfes.add(a.reference);
        break;
    }
  }

  // Se as contagens de reference estiverem vazias, cai para as agregações do payload.
  const affectedItems =
    affectedItemIds.size > 0
      ? affectedItemIds.size
      : items.filter(
          (i) => (i.alerts?.length ?? 0) > 0 || i.nomusIsCanceled || i.nomusIsCut
        ).length;
  const affectedTitlesCount =
    affectedTitles.size > 0
      ? affectedTitles.size
      : receivables.filter((r) => r.alerts.length > 0).length;
  const affectedDocumentsCount =
    affectedDocuments.size > 0
      ? affectedDocuments.size
      : stockDocuments.filter((d) => d.alerts.length > 0).length;
  const affectedNfesCount =
    affectedNfes.size > 0
      ? affectedNfes.size
      : nfes.filter((n) => n.alerts.length > 0).length;

  return {
    hasAny: alerts.length > 0,
    counts,
    metrics: {
      financialImpactTotal: round2(financialImpactTotal),
      affectedItems,
      affectedTitles: affectedTitlesCount,
      affectedDocuments: affectedDocumentsCount,
      affectedNfes: affectedNfesCount,
    },
    byCategory,
    alerts,
  };
}

function emptyMarginPricingBlockShape(): OrderFullAuditMarginPricingBlock {
  return {
    totals: {
      totalNetRevenue: null,
      totalCost: null,
      marginValue: null,
      marginPerc: null,
      coverage: null,
      canceledValue: 0,
      cutValue: 0,
      staleValue: 0,
      noMarginValue: 0,
      priceOrderVsTableDelta: 0,
      priceOrderVsDocumentDelta: 0,
    },
    counts: {
      activeItems: 0,
      canceledItems: 0,
      cutItems: 0,
      staleItems: 0,
      noMarginItems: 0,
      priceMismatchItems: 0,
      negativeMarginItems: 0,
      missingCostItems: 0,
      missingTableItems: 0,
    },
    items: [],
    itemMargins: [],
    officialPriceReferences: [],
    source: "NONE",
    todo: "",
  };
}

async function buildMarginPricingBlock(input: {
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>;
  items: OrderFullAuditItem[];
  stockDocumentItems: OrderFullAuditStockDocumentItem[];
  nfeItems: OrderFullAuditNfeItem[];
  proposal: OrderFullAuditProposalBlock;
}): Promise<OrderFullAuditMarginPricingBlock> {
  const shape = emptyMarginPricingBlockShape();

  // Preços de documento e NF por salesOrderItemId (evidência por linha).
  const documentPriceBySoi = new Map<string, number>();
  for (const di of input.stockDocumentItems) {
    if (di.linkedSalesOrderItemId && di.unitValue != null) {
      if (!documentPriceBySoi.has(di.linkedSalesOrderItemId)) {
        documentPriceBySoi.set(di.linkedSalesOrderItemId, di.unitValue);
      }
    }
  }
  const nfePriceBySoi = new Map<string, number>();
  for (const ni of input.nfeItems) {
    if (ni.linkedSalesOrderItemId && ni.unitValueNfe != null) {
      if (!nfePriceBySoi.has(ni.linkedSalesOrderItemId)) {
        nfePriceBySoi.set(ni.linkedSalesOrderItemId, ni.unitValueNfe);
      }
    }
  }

  // Chama o serviço oficial de margem (recompute com comparação de tabela).
  let marginResult: Awaited<
    ReturnType<typeof calculateSalesOrderMarginsForOrders>
  > | null = null;
  try {
    marginResult = await calculateSalesOrderMarginsForOrders(prisma, [
      {
        id: input.order.id,
        proposalId: input.order.proposalId ?? null,
        issueDate: input.order.issueDate,
        nomusRawResponse: input.order.nomusRawResponse,
        items: input.order.items,
      },
    ]);
  } catch (e) {
    console.warn(
      "[orderFullAuditService] falha ao calcular margem oficial.",
      e
    );
  }

  const orderResult = marginResult?.get(input.order.id) ?? null;
  const itemMarginById = orderResult?.itemMargins ?? new Map();

  const items: OrderFullAuditMarginPricingItem[] = input.items.map((it) => {
    const marginItem = itemMarginById.get(it.salesOrderItemId);
    const isCanceled = it.nomusIsCanceled;
    const isCut = it.nomusIsCut;
    const isStale = it.nomusIsStale;
    const isActive = !isCanceled && !isCut && !isStale;

    const orderUnit = it.unitPrice;
    const docUnit = documentPriceBySoi.get(it.salesOrderItemId) ?? null;
    const nfeUnit = nfePriceBySoi.get(it.salesOrderItemId) ?? null;
    const officialTableUnit =
      marginItem?.commercialReference?.officialUnitPrice ?? null;

    const diffOrderTable =
      orderUnit != null && officialTableUnit != null
        ? round2(orderUnit - officialTableUnit)
        : null;
    const diffOrderTablePerc =
      officialTableUnit != null && officialTableUnit > 0 && diffOrderTable != null
        ? Math.round((diffOrderTable / officialTableUnit) * 10000) / 100
        : null;

    const diffOrderDoc =
      orderUnit != null && docUnit != null ? round2(docUnit - orderUnit) : null;
    const diffOrderDocPerc =
      orderUnit != null && orderUnit > 0 && diffOrderDoc != null
        ? Math.round((diffOrderDoc / orderUnit) * 10000) / 100
        : null;

    const diffDocNfe =
      docUnit != null && nfeUnit != null ? round2(nfeUnit - docUnit) : null;
    const diffDocNfePerc =
      docUnit != null && docUnit > 0 && diffDocNfe != null
        ? Math.round((diffDocNfe / docUnit) * 10000) / 100
        : null;

    const alerts: string[] = [];
    // Regras oficiais — só ativos entram nas verificações de tabela/preço/margem.
    if (isActive) {
      if (marginItem?.commercialReference?.referenceStatus === "SEM_PRECO_TABELA") {
        alerts.push("PRICE_TABLE_NOT_FOUND");
      }
      if (
        marginItem?.status === "SEM_CUSTO" ||
        marginItem?.status === "CUSTO_ZERO"
      ) {
        alerts.push("COST_NOT_FOUND");
      }
      if (marginItem?.status === "SEM_PRODUTO_VINCULADO") {
        alerts.push("NO_MARGIN");
      }
      if (
        marginItem?.marginValue != null &&
        marginItem.marginValue < -0.01
      ) {
        alerts.push("NEGATIVE_MARGIN");
      }
      if (
        orderUnit != null &&
        officialTableUnit != null &&
        orderUnit < officialTableUnit - 0.005
      ) {
        alerts.push("ORDER_PRICE_BELOW_TABLE");
      }
      if (diffOrderDoc != null && Math.abs(diffOrderDoc) > 0.005) {
        alerts.push("ORDER_PRICE_DIFFERS_FROM_DOCUMENT");
      }
      if (diffDocNfe != null && Math.abs(diffDocNfe) > 0.005) {
        alerts.push("DOCUMENT_PRICE_DIFFERS_FROM_NFE");
      }
      // NO_MARGIN oficial: item ativo sem margem calculada.
      if (marginItem?.marginValue == null && marginItem?.status !== "OK") {
        if (!alerts.includes("NO_MARGIN")) alerts.push("NO_MARGIN");
      }
    } else {
      // Invariantes: item cancelado/stale NÃO deve gerar NO_MARGIN.
      if (marginItem?.marginValue == null && marginItem != null) {
        if (isCanceled || isStale) {
          alerts.push(
            isCanceled
              ? "CANCELED_ITEM_GENERATING_NO_MARGIN"
              : "STALE_ITEM_GENERATING_MARGIN"
          );
        }
      }
    }

    return {
      salesOrderItemId: it.salesOrderItemId,
      productCode: it.productCode,
      productName: it.productName,
      itemSequence: it.itemSequence,
      itemStatus: isCanceled
        ? "CANCELED"
        : isCut
          ? "CUT"
          : isStale
            ? "STALE"
            : it.nomusItemStatusNormalized ?? "ACTIVE",
      isActive,
      isCanceled,
      isCut,
      isStale,
      activeQuantity: it.activeQuantity,
      orderUnitPrice: orderUnit,
      officialTableUnitPrice: officialTableUnit,
      documentUnitPrice: docUnit,
      nfeUnitPrice: nfeUnit,
      priceDiffOrderVsTableAbs: diffOrderTable,
      priceDiffOrderVsTablePercent: diffOrderTablePerc,
      priceDiffOrderVsDocumentAbs: diffOrderDoc,
      priceDiffOrderVsDocumentPercent: diffOrderDocPerc,
      priceDiffDocumentVsNfeAbs: diffDocNfe,
      priceDiffDocumentVsNfePercent: diffDocNfePerc,
      unitCost: marginItem?.unitCost ?? null,
      totalCost: marginItem?.totalCost ?? null,
      netRevenue: marginItem?.netRevenue ?? (isActive ? it.activeValue : 0),
      marginValue: marginItem?.marginValue ?? null,
      marginPercent: marginItem?.marginPercent ?? null,
      fiscalRule:
        marginItem?.commercialReference?.productType ?? null,
      priceTableCode:
        marginItem?.commercialReference?.officialPrice?.priceTableCode ??
        (input.proposal.present ? input.proposal.priceTableCode : null),
      priceTableVersion:
        marginItem?.commercialReference?.officialPrice?.versionNumber != null
          ? String(marginItem.commercialReference.officialPrice.versionNumber)
          : null,
      priceTableEffectiveDate:
        marginItem?.commercialReference?.officialPrice?.effectiveFrom ??
        null,
      costEffectiveDate:
        marginItem?.productionCost?.effectiveDate ?? null,
      commissionEstimated: null, // preenchido na aba Comissões
      marginStatus: marginItem?.status ?? "SEM_DADOS",
      marginStatusLabel: marginItem?.statusLabel ?? "Sem dados",
      reason:
        (marginItem?.notes && marginItem.notes.length > 0
          ? marginItem.notes.join(" · ")
          : null) ??
        (isCanceled
          ? "Item cancelado — margem ignorada"
          : isStale
            ? "Item stale — margem ignorada"
            : isCut
              ? "Item com corte — considera apenas parte ativa/atendida"
              : null),
      alerts,
    };
  });

  // Agregados dos itens ativos.
  const active = items.filter((i) => i.isActive);
  const totalNetRevenue = active.reduce(
    (s, i) => s + (i.netRevenue ?? 0),
    0
  );
  const totalCost = active.reduce((s, i) => s + (i.totalCost ?? 0), 0);
  const marginValue = totalNetRevenue - totalCost;
  const marginPerc =
    totalNetRevenue > 0
      ? Math.round((marginValue / totalNetRevenue) * 10000) / 100
      : null;
  const canceledValue = items
    .filter((i) => i.isCanceled)
    .reduce((s, i) => s + Math.abs(i.netRevenue ?? 0), 0);
  const cutValue = items
    .filter((i) => i.isCut)
    .reduce((s, i) => s + Math.abs(i.netRevenue ?? 0), 0);
  const staleValue = items
    .filter((i) => i.isStale)
    .reduce((s, i) => s + Math.abs(i.netRevenue ?? 0), 0);
  const noMarginItems = active.filter((i) => i.alerts.includes("NO_MARGIN"));
  const noMarginValue = noMarginItems.reduce(
    (s, i) => s + (i.netRevenue ?? 0),
    0
  );
  const priceOrderVsTableDelta = active.reduce(
    (s, i) => s + Math.abs(i.priceDiffOrderVsTableAbs ?? 0),
    0
  );
  const priceOrderVsDocumentDelta = active.reduce(
    (s, i) => s + Math.abs(i.priceDiffOrderVsDocumentAbs ?? 0),
    0
  );

  return {
    totals: {
      totalNetRevenue: round2(totalNetRevenue),
      totalCost: round2(totalCost),
      marginValue: round2(marginValue),
      marginPerc,
      coverage:
        orderResult?.marginSummary?.marginCoveragePercent ?? null,
      canceledValue: round2(canceledValue),
      cutValue: round2(cutValue),
      staleValue: round2(staleValue),
      noMarginValue: round2(noMarginValue),
      priceOrderVsTableDelta: round2(priceOrderVsTableDelta),
      priceOrderVsDocumentDelta: round2(priceOrderVsDocumentDelta),
    },
    counts: {
      activeItems: active.length,
      canceledItems: items.filter((i) => i.isCanceled).length,
      cutItems: items.filter((i) => i.isCut).length,
      staleItems: items.filter((i) => i.isStale).length,
      noMarginItems: noMarginItems.length,
      priceMismatchItems: active.filter((i) =>
        i.alerts.includes("ORDER_PRICE_DIFFERS_FROM_DOCUMENT") ||
        i.alerts.includes("ORDER_PRICE_BELOW_TABLE") ||
        i.alerts.includes("DOCUMENT_PRICE_DIFFERS_FROM_NFE")
      ).length,
      negativeMarginItems: active.filter((i) => i.alerts.includes("NEGATIVE_MARGIN"))
        .length,
      missingCostItems: active.filter((i) => i.alerts.includes("COST_NOT_FOUND"))
        .length,
      missingTableItems: active.filter((i) =>
        i.alerts.includes("PRICE_TABLE_NOT_FOUND")
      ).length,
    },
    items,
    itemMargins: items.map((i) => ({
      salesOrderItemId: i.salesOrderItemId,
      status: i.marginStatus,
      netRevenue: i.netRevenue,
      totalCost: i.totalCost,
      marginValue: i.marginValue,
      marginPerc: i.marginPercent,
      costSource: null,
      costConfidence: null,
    })),
    officialPriceReferences: items
      .filter((i) => i.officialTableUnitPrice != null)
      .map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        priceTableCode: i.priceTableCode,
        priceTableVersion: i.priceTableVersion,
        officialSalePrice: i.officialTableUnitPrice,
        negotiatedPrice: i.orderUnitPrice,
        deltaPercent: i.priceDiffOrderVsTablePercent,
      })),
    source: orderResult ? "MARGIN_SERVICE_RECOMPUTED" : "SNAPSHOT_SALES_ORDER_ITEM",
    todo: "",
  };
}

function emptyMarginPricingBlock(
  items: OrderFullAuditItem[]
): OrderFullAuditMarginPricingBlock {
  void items;
  return emptyMarginPricingBlockShape();
}

async function loadCommissionBlock(input: {
  order: NonNullable<Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>>;
  items: OrderFullAuditItem[];
  receivables: OrderFullAuditReceivable[];
  commercialResponsibleName: string | null;
}): Promise<OrderFullAuditCommissionBlock> {
  const empty = emptyCommissionBlockShape();
  empty.commercialResponsibleName = input.commercialResponsibleName;

  try {
    // Snapshot ACTIVE do pedido — fonte oficial de comissão (read-only).
    // Preferir o mais recente; se houver NF no pedido, o motor de materialização
    // também escopa por nfeId — findFirst sem orderBy era não-determinístico.
    const snapshot = await prisma.commissionOrderSnapshot.findFirst({
      where: { salesOrderId: input.order.id, status: "ACTIVE" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        items: {
          include: {
            rule: {
              select: {
                id: true,
                name: true,
                baseType: true,
                releaseRule: true,
                ratePercent: true,
              },
            },
          },
        },
        receivableSchedules: true,
      },
    });

    // Exceções de cliente (best-effort).
    const customerExceptions =
      input.order.externalCustomerId != null
        ? await prisma.commissionCustomerException
            .findMany({
              where: {
                OR: [
                  { customerExternalId: input.order.externalCustomerId },
                ],
              },
              include: {
                commissionPerson: { select: { canonicalName: true, id: true } },
              },
            })
            .catch(() => [])
        : [];

    // Ledger de baixas — busca por CR externo vinculado ao pedido.
    const receivableIds = input.receivables
      .map((r) => r.receivableExternalId)
      .filter((x): x is number => x != null && x > 0);
    const ledgerLines =
      receivableIds.length > 0
        ? await prisma.commissionReceiptLedgerLine
            .findMany({
              where: { nomusReceivableId: { in: receivableIds } },
            })
            .catch(() => [])
        : [];

    if (!snapshot) {
      // Sem snapshot: bloco vazio + exceções (se existirem).
      empty.customerExceptions = customerExceptions.map((e) => ({
        id: e.id,
        reason: e.reason ?? "",
        startDate: toIso(e.startDate),
        endDate: toIso(e.endDate ?? null),
        active: e.active,
        productCode: e.productCode ?? null,
        commissionPersonName: e.commissionPerson?.canonicalName ?? null,
      }));
      return empty;
    }

    const itemByStorageId = new Map<string, OrderFullAuditItem>();
    for (const i of input.items) itemByStorageId.set(i.salesOrderItemId, i);

    const items: OrderFullAuditCommissionItem[] = snapshot.items.map((si) => {
      const oi = itemByStorageId.get(si.salesOrderItemId);
      const isCanceled = oi?.nomusIsCanceled === true;
      const isCut = oi?.nomusIsCut === true;
      const isStale = oi?.nomusIsStale === true;
      const isActive = !isCanceled && !isCut && !isStale;

      const alertsForLine: string[] = [];
      const finalAmount = decimalToNumber(si.finalCommissionAmount) ?? 0;
      if ((isCanceled || isStale) && finalAmount > MONEY_TOLERANCE) {
        alertsForLine.push("CANCELED_ITEM_GENERATING_COMMISSION");
      }
      if (
        finalAmount > MONEY_TOLERANCE &&
        (snapshot.canonicalSellerId == null &&
          (snapshot.rawSellerName ?? "").trim() === "")
      ) {
        alertsForLine.push("COMMISSION_WITHOUT_SELLER");
      }

      return {
        salesOrderItemId: si.salesOrderItemId,
        productCode: oi?.productCode ?? null,
        productName: oi?.productName ?? si.productNameSnapshot,
        itemSequence: oi?.itemSequence ?? null,
        itemStatus: isCanceled
          ? "CANCELED"
          : isCut
            ? "CUT"
            : isStale
              ? "STALE"
              : oi?.nomusItemStatusNormalized ?? "ACTIVE",
        isActive,
        isCanceled,
        isCut,
        isStale,
        quantity: oi?.quantity ?? null,
        unitPrice: oi?.unitPrice ?? null,
        activeQuantity: oi?.activeQuantity ?? null,
        commissionBase: decimalToNumber(si.soldAmount),
        marginPercent: decimalToNumber(si.marginPercent),
        commissionRatePercent: decimalToNumber(si.commissionRatePercent),
        finalCommissionAmount: finalAmount,
        grossCommissionAmount: decimalToNumber(si.grossCommissionAmount),
        ruleId: si.ruleId,
        ruleName: si.rule?.name ?? null,
        ruleBaseType: si.rule?.baseType ?? null,
        ruleReleaseRule: si.rule?.releaseRule ?? null,
        status: si.status,
        exclusionReason: si.exclusionReason,
        alerts: alertsForLine,
      };
    });

    // Vencimento oficial da parcela CR (NomusAccountsReceivable.dueDate).
    // CommissionReceivableSchedule não persiste dueDate — resolve via CR do pedido.
    const dueByReceivableExternalId = new Map<number, string | null>();
    for (const r of input.receivables) {
      dueByReceivableExternalId.set(r.receivableExternalId, r.dueDate);
    }
    const missingDueIds = Array.from(
      new Set(
        snapshot.receivableSchedules
          .map((s) => s.receivableId)
          .filter(
            (id): id is number =>
              typeof id === "number" &&
              id > 0 &&
              !dueByReceivableExternalId.has(id)
          )
      )
    );
    if (missingDueIds.length > 0) {
      const missingRows = await prisma.nomusAccountsReceivable
        .findMany({
          where: { externalId: { in: missingDueIds } },
          select: { externalId: true, dueDate: true },
        })
        .catch(() => []);
      for (const row of missingRows) {
        dueByReceivableExternalId.set(row.externalId, toIso(row.dueDate));
      }
    }

    const receivableSchedule: OrderFullAuditCommissionScheduleEntry[] =
      snapshot.receivableSchedules.map((s) => {
        const dueRaw = dueByReceivableExternalId.get(s.receivableId) ?? null;
        const receivableDueDate = toCivilDateKey(dueRaw);
        const receivableDueDateFormatted =
          formatReceivableDueDateSlash(dueRaw);
        return {
          receivableExternalId: s.receivableId,
          receivableCode: s.receivableCode,
          installmentNumber: s.installmentNumber,
          receivableDueDate,
          receivableDueDateFormatted,
          receivableNominalAmount: decimalToNumber(s.receivableNominalAmount),
          receivableSharePercent: decimalToNumber(s.receivableSharePercent),
          scheduledCommissionAmount: decimalToNumber(
            s.scheduledCommissionAmount
          ),
          scheduleDate: receivableDueDate,
          status: s.status,
        };
      });

    const receipts: OrderFullAuditCommissionReceipt[] = ledgerLines.map((l) => ({
      ledgerLineKey: l.ledgerLineKey,
      receivableExternalId: l.nomusReceivableId,
      receivableNumber: l.receivableNumber,
      installmentNumber: l.installmentNumber,
      settlementDate: toIso(l.settlementDate),
      dueDate: toIso(l.dueDate),
      receivedAmount: decimalToNumber(l.receivedAmount),
      releasedCommissionAmount:
        decimalToNumber((l as unknown as { releasedCommissionAmount?: unknown }).releasedCommissionAmount ?? null),
      paidCommissionAmount:
        decimalToNumber((l as unknown as { paidCommissionAmount?: unknown }).paidCommissionAmount ?? null),
      blockedCommissionAmount:
        decimalToNumber((l as unknown as { blockedCommissionAmount?: unknown }).blockedCommissionAmount ?? null),
      status:
        (l as unknown as { status?: string | null }).status ?? null,
      paymentDate:
        toIso((l as unknown as { paymentDate?: Date | string | null }).paymentDate ?? null),
      paymentStatus:
        (l as unknown as { paymentStatus?: string | null }).paymentStatus ?? null,
      canonicalSellerName: l.canonicalSellerName,
      rawSellerName: l.rawSellerName,
    }));

    // Alertas ledger vs schedule: liberação sem baixa.
    for (const r of receipts) {
      if (
        (r.releasedCommissionAmount ?? 0) > 0.009 &&
        r.settlementDate == null
      ) {
        // agregada em alerts globais na função buildAlerts.
      }
    }

    const commissionableBase = round2(
      items
        .filter((i) => i.isActive)
        .reduce((s, i) => s + (i.commissionBase ?? 0), 0)
    );
    const ignoredBase = round2(
      input.items
        .filter((i) => i.nomusIsCanceled || i.nomusIsCut || i.nomusIsStale)
        .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
    );

    return {
      present: true,
      readOnly: true,
      snapshotId: snapshot.id,
      snapshotStatus: snapshot.status,
      canonicalSellerId: snapshot.canonicalSellerId,
      canonicalSellerName: snapshot.canonicalSellerName,
      rawSellerId: snapshot.rawSellerId,
      rawSellerName: snapshot.rawSellerName,
      commercialResponsibleName: input.commercialResponsibleName,
      totals: {
        totalSoldAmount: decimalToNumber(snapshot.totalSoldAmount),
        totalGrossCommissionAmount: decimalToNumber(
          snapshot.totalGrossCommissionAmount
        ),
        totalFinalCommissionAmount: decimalToNumber(
          snapshot.totalFinalCommissionAmount
        ),
        totalConfirmedAmount: round2(
          items
            .filter((i) => i.isActive && i.status === "ACTIVE")
            .reduce((s, i) => s + (i.finalCommissionAmount ?? 0), 0)
        ),
        totalReleasedAmount: round2(
          receipts.reduce(
            (s, r) => s + (r.releasedCommissionAmount ?? 0),
            0
          )
        ),
        totalPaidAmount: round2(
          receipts.reduce((s, r) => s + (r.paidCommissionAmount ?? 0), 0)
        ),
        totalBlockedAmount: round2(
          receipts.reduce(
            (s, r) => s + (r.blockedCommissionAmount ?? 0),
            0
          )
        ),
        commissionableBase,
        ignoredBase,
      },
      counts: {
        totalItems: items.length,
        itemsWithCommission: items.filter(
          (i) => (i.finalCommissionAmount ?? 0) > MONEY_TOLERANCE
        ).length,
        itemsExcluded: items.filter((i) => i.exclusionReason != null).length,
        canceledItems: items.filter((i) => i.isCanceled).length,
        cutItems: items.filter((i) => i.isCut).length,
        staleItems: items.filter((i) => i.isStale).length,
      },
      items,
      receivableSchedule,
      receipts,
      customerExceptions: customerExceptions.map((e) => ({
        id: e.id,
        reason: e.reason ?? "",
        startDate: toIso(e.startDate),
        endDate: toIso(e.endDate ?? null),
        active: e.active,
        productCode: e.productCode ?? null,
        commissionPersonName: e.commissionPerson?.canonicalName ?? null,
      })),
    };
  } catch (e) {
    console.warn(
      "[orderFullAuditService] falha ao carregar bloco de comissão.",
      e
    );
    return empty;
  }
}

function emptyCommissionBlockShape(): OrderFullAuditCommissionBlock {
  return {
    present: false,
    readOnly: true,
    snapshotId: null,
    snapshotStatus: null,
    canonicalSellerId: null,
    canonicalSellerName: null,
    rawSellerId: null,
    rawSellerName: null,
    commercialResponsibleName: null,
    totals: {
      totalSoldAmount: null,
      totalGrossCommissionAmount: null,
      totalFinalCommissionAmount: null,
      totalConfirmedAmount: null,
      totalReleasedAmount: null,
      totalPaidAmount: null,
      totalBlockedAmount: null,
      commissionableBase: null,
      ignoredBase: null,
    },
    counts: {
      totalItems: 0,
      itemsWithCommission: 0,
      itemsExcluded: 0,
      canceledItems: 0,
      cutItems: 0,
      staleItems: 0,
    },
    items: [],
    receivableSchedule: [],
    receipts: [],
    customerExceptions: [],
    todo: "",
  };
}

/** Compat alias — mantido para consumidores externos. */
function emptyCommissionBlock(): OrderFullAuditCommissionBlock {
  return emptyCommissionBlockShape();
}

/* ---------------------------------------------------------------------- */
/*  Helpers                                                                */
/* ---------------------------------------------------------------------- */

function normalizeFact(raw: Record<string, unknown>): OrderToCashAuditFactRecord {
  return {
    id: String(raw.id),
    runId: String(raw.runId),
    orderCode: (raw.orderCode as string | null) ?? null,
    orderIssueDate: (raw.orderIssueDate as Date | string | null) ?? null,
    orderExpectedDeliveryDate: (raw.orderExpectedDeliveryDate as Date | string | null) ?? null,
    orderNetValue: decimalToNumber(raw.orderNetValue),
    customerId: (raw.customerId as string | null) ?? null,
    customerName: (raw.customerName as string | null) ?? null,
    externalCustomerId: (raw.externalCustomerId as number | null) ?? null,
    sellerName: (raw.sellerName as string | null) ?? null,
    sellerQualityStatus: (raw.sellerQualityStatus as string | null) ?? null,
    productCode: (raw.productCode as string | null) ?? null,
    sku: (raw.sku as string | null) ?? null,
    productName: (raw.productName as string | null) ?? null,
    lineType: (raw.lineType as string | null) ?? null,
    orderedQuantity: decimalToNumber(raw.orderedQuantity),
    orderUnitPrice: decimalToNumber(raw.orderUnitPrice),
    orderItemTotalValue: decimalToNumber(raw.orderItemTotalValue),
    stockDocumentId: (raw.stockDocumentId as string | null) ?? null,
    stockDocumentExternalId: (raw.stockDocumentExternalId as number | null) ?? null,
    stockDocumentDate: (raw.stockDocumentDate as Date | string | null) ?? null,
    stockDocumentItemQuantity: decimalToNumber(raw.stockDocumentItemQuantity),
    quantityUsedForOrder: decimalToNumber(raw.quantityUsedForOrder),
    excessQuantity: decimalToNumber(raw.excessQuantity),
    outsideOrderQuantity: decimalToNumber(raw.outsideOrderQuantity),
    allocatedValueByOrderPrice: decimalToNumber(raw.allocatedValueByOrderPrice),
    allocatedValueByDocumentPrice: decimalToNumber(raw.allocatedValueByDocumentPrice),
    stockDocumentItemUnitValue: decimalToNumber(raw.stockDocumentItemUnitValue),
    stockDocumentItemTotalValue: decimalToNumber(raw.stockDocumentItemTotalValue),
    nfeItemQuantity: decimalToNumber(raw.nfeItemQuantity),
    nfeItemUnitValue: decimalToNumber(raw.nfeItemUnitValue),
    nfeItemTotalValue: decimalToNumber(raw.nfeItemTotalValue),
    nfeNumber: (raw.nfeNumber as string | null) ?? null,
    nfeIssueDate: (raw.nfeIssueDate as Date | string | null) ?? null,
    nfeHeaderValue: decimalToNumber(raw.nfeHeaderValue),
    receivableTotalValue: decimalToNumber(raw.receivableTotalValue),
    receivableOpenValue: decimalToNumber(raw.receivableOpenValue),
    receivableReceivedValue: decimalToNumber(raw.receivableReceivedValue),
    paymentDueDate: (raw.paymentDueDate as Date | string | null) ?? null,
    paymentSettlementDate: (raw.paymentSettlementDate as Date | string | null) ?? null,
    paymentStatus: (raw.paymentStatus as string | null) ?? null,
    operationalStage: (raw.operationalStage as string | null) ?? null,
    financialStage: (raw.financialStage as string | null) ?? null,
    orderToCashStage: (raw.orderToCashStage as string | null) ?? null,
    temperature: (raw.temperature as string | null) ?? null,
    confidenceScore: decimalToNumber(raw.confidenceScore),
    confidenceLabel: (raw.confidenceLabel as string | null) ?? null,
    responsibleArea: (raw.responsibleArea as string | null) ?? null,
    recommendedAction: (raw.recommendedAction as string | null) ?? null,
    alertsJson: raw.alertsJson,
    hasDeliveryDelay: Boolean(raw.hasDeliveryDelay),
    hasMissingStockDocument: Boolean(raw.hasMissingStockDocument),
    hasPartialFulfillment: Boolean(raw.hasPartialFulfillment),
    hasFullFulfillment: Boolean(raw.hasFullFulfillment),
    hasExcessQuantity: Boolean(raw.hasExcessQuantity),
    hasProductOutsideOrder: Boolean(raw.hasProductOutsideOrder),
    hasNfeHeaderGreaterThanOrder: Boolean(raw.hasNfeHeaderGreaterThanOrder),
    hasPriceMismatch: Boolean(raw.hasPriceMismatch),
    hasDocumentWithoutReceivable: Boolean(raw.hasDocumentWithoutReceivable),
    hasOverdueReceivable: Boolean(raw.hasOverdueReceivable),
    salesOrderId: (raw.salesOrderId as string | null) ?? null,
    salesOrderItemId: (raw.salesOrderItemId as string | null) ?? null,
    orderItemStatus: (raw.orderItemStatus as string | null) ?? null,
    blockingReasonsJson: raw.blockingReasonsJson,
  };
}

function latestIso(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (valid.length === 0) return null;
  return valid.sort().at(-1) ?? null;
}

function buildSummary(input: {
  order: Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>;
  customer: { companyName: string; tradeName: string | null; taxId: string | null } | null;
  items: OrderFullAuditItem[];
  facts: OrderToCashAuditFactRecord[];
  receivables: OrderFullAuditReceivable[];
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  commercialResponsibleName: string | null;
  commercialResponsible: ResolvedCommercialResponsibleDisplay;
  orderSeller: ResolvedOrderSellerIdentity;
  alertCount: number;
}): OrderFullAuditPayload["summary"] {
  const order = input.order;
  const orderNetValue = decimalToNumber(order?.totalNetValue) ?? 0;
  const canceledValue = round2(
    input.items
      .filter((i) => isInactiveSalesOrderItemNomusFlags({
        nomusIsCanceled: i.nomusIsCanceled,
        nomusIsStale: i.nomusIsStale,
        nomusItemStatusNormalized: i.nomusItemStatusNormalized,
      }))
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const cutValue = round2(
    input.items
      .filter((i) =>
        isFulfilledWithCutSalesOrderItem({
          nomusIsCut: i.nomusIsCut,
          nomusItemStatusNormalized: i.nomusItemStatusNormalized,
        })
      )
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const activeValue = round2(Math.max(0, orderNetValue - canceledValue - cutValue));
  const allocated = round2(
    Math.min(
      activeValue,
      input.facts.reduce(
        (s, f) => s + Math.max(0, f.allocatedValueByOrderPrice ?? 0),
        0
      )
    )
  );
  const pendingActive = round2(Math.max(0, activeValue - allocated));

  // CR deduplicado (input.receivables já veio deduplicado pelo pipeline principal —
  // reforçamos por `receivableExternalId` para nunca duplicar em nenhum caminho de resumo).
  const uniqueReceivables = new Map<number, OrderFullAuditReceivable>();
  for (const r of input.receivables) {
    if (!uniqueReceivables.has(r.receivableExternalId)) {
      uniqueReceivables.set(r.receivableExternalId, r);
    }
  }
  const receivablesDedup = [...uniqueReceivables.values()];
  const receivableTotal = round2(
    receivablesDedup.reduce((s, r) => s + r.amountReceivable, 0)
  );
  const receivableOpen = round2(
    receivablesDedup.reduce((s, r) => s + r.balanceReceivable, 0)
  );
  const receivableReceived = round2(
    receivablesDedup.reduce((s, r) => s + r.amountReceived, 0)
  );
  const receivableOverdue = round2(
    receivablesDedup
      .filter((r) => r.status === "OVERDUE")
      .reduce((s, r) => s + r.balanceReceivable, 0)
  );

  // Documentos de saída — dedup por `stockDocumentExternalId`, soma total e alocada.
  const uniqueDocs = new Map<number, OrderFullAuditStockDocument>();
  for (const d of input.stockDocuments) {
    if (!uniqueDocs.has(d.stockDocumentExternalId)) {
      uniqueDocs.set(d.stockDocumentExternalId, d);
    }
  }
  const docsDedup = [...uniqueDocs.values()];
  const stockDocumentsTotalValue = round2(
    docsDedup.reduce((s, d) => s + d.totalValue, 0)
  );
  const stockDocumentsAllocatedValue = round2(
    docsDedup.reduce((s, d) => s + d.allocatedValue, 0)
  );

  // NFs — dedup por `nfeExternalId`. Cabeçalho vs alocação são grandezas distintas —
  // usamos o cabeçalho para o card de valor NF-e e a alocação para diferenças oficiais.
  const uniqueNfes = new Map<number, OrderFullAuditNfe>();
  for (const n of input.nfes) {
    if (!uniqueNfes.has(n.nfeExternalId)) {
      uniqueNfes.set(n.nfeExternalId, n);
    }
  }
  const nfesDedup = [...uniqueNfes.values()];
  const nfeTotalValueAll = round2(
    nfesDedup.reduce((s, n) => s + (n.valorTotal ?? 0), 0)
  );
  const nfeValidValue = round2(
    nfesDedup
      .filter((n) => n.isValidForBilling)
      .reduce((s, n) => s + (n.valorTotal ?? 0), 0)
  );
  const nfeCanceledValue = round2(
    nfesDedup
      .filter((n) => n.isCanceled)
      .reduce((s, n) => s + (n.valorTotal ?? 0), 0)
  );
  const validNfeCount = nfesDedup.filter((n) => n.isValidForBilling).length;
  const canceledNfeCount = nfesDedup.filter((n) => n.isCanceled).length;
  const nfeAllocatedValueAll = round2(
    nfesDedup.reduce((s, n) => s + n.allocatedValueToOrder, 0)
  );
  const nfeAllocatedValue = round2(
    nfesDedup
      .filter((n) => n.isValidForBilling)
      .reduce((s, n) => s + n.allocatedValueToOrder, 0)
  );
  // Card principal "Valor NF-e" permanece histórico; diffs usam alocação válida.
  const nfeTotalValue = nfeTotalValueAll;

  const dominant = input.facts.reduce<Record<string, number>>((acc, f) => {
    if (f.orderToCashStage) acc[f.orderToCashStage] = (acc[f.orderToCashStage] ?? 0) + 1;
    return acc;
  }, {});
  const consolidatedStatus =
    Object.entries(dominant).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const operationalStage =
    input.facts.find((f) => f.operationalStage)?.operationalStage ?? null;
  const financialStage =
    input.facts.find((f) => f.financialStage)?.financialStage ?? null;

  return {
    orderCode: order?.orderCode ?? null,
    customerName: input.customer?.tradeName ?? input.customer?.companyName ?? null,
    // externalCustomerId vem do próprio SalesOrder — o `Customer` model não tem essa coluna.
    externalCustomerId: order?.externalCustomerId ?? null,
    customerDocument: input.customer?.taxId ?? null,
    companyName: order?.companyIssuer ?? null,
    orderIssueDate: toIso(order?.issueDate),
    orderExpectedDeliveryDate: toIso(order?.expectedDeliveryDate),
    paymentTerms: order?.paymentTerms ?? null,
    paymentMethod: order?.paymentMethod ?? null,
    freightCondition: order?.freightCondition ?? null,
    commercialResponsibleName: input.commercialResponsibleName,
    commercialResponsible: input.commercialResponsible,
    orderSellerName: input.orderSeller.isMapped
      ? input.orderSeller.canonicalName
      : input.orderSeller.isInformed
        ? input.orderSeller.displayName
        : null,
    orderSellerExternalId: input.orderSeller.rawExternalId,
    orderSeller: toOrderSellerDto(input.orderSeller),
    operationalResponsibleArea: order?.responsible ?? null,
    originalOrderValue: round2(orderNetValue),
    canceledOrderValue: canceledValue,
    cutOrderValue: cutValue,
    activeOrderValue: activeValue,
    allocatedOrderValue: allocated,
    pendingActiveOrderValue: pendingActive,
    fulfillmentPercentActive:
      activeValue > MONEY_TOLERANCE
        ? Math.round((allocated / activeValue) * 10000) / 100
        : allocated > MONEY_TOLERANCE
          ? 100
          : 0,
    receivableTotalValue: receivableTotal,
    receivableOpenValue: receivableOpen,
    receivableReceivedValue: receivableReceived,
    receivableOverdueValue: receivableOverdue,
    stockDocumentsTotalValue,
    stockDocumentsAllocatedValue,
    nfeTotalValue,
    nfeTotalValueAll,
    nfeValidValue,
    nfeCanceledValue,
    validNfeCount,
    canceledNfeCount,
    nfeAllocatedValue,
    nfeAllocatedValueAll,
    diffs: {
      orderVsStockDocument: round2(activeValue - stockDocumentsAllocatedValue),
      orderVsNfe: round2(activeValue - nfeAllocatedValue),
      orderVsReceivable: round2(orderNetValue - receivableTotal),
      activeVsReceivable: round2(activeValue - receivableTotal),
      allocatedVsReceivable: round2(allocated - receivableTotal),
    },
    operationalStatus: operationalStage,
    financialStatus: financialStage,
    operationalStage,
    financialStage,
    orderToCashStage: input.facts.find((f) => f.orderToCashStage)?.orderToCashStage ?? null,
    temperature: input.facts.find((f) => f.temperature)?.temperature ?? null,
    consolidatedStatus,
    alertCount: input.alertCount,
  };
}

function summarizeReceivables(
  receivables: OrderFullAuditReceivable[]
): OrderFullAuditPayload["receivablesTotal"] {
  let totalAmount = 0;
  let openAmount = 0;
  let receivedAmount = 0;
  let overdueCount = 0;
  let maxAmount = 0;
  let nextDueDate: string | null = null;
  for (const r of receivables) {
    totalAmount += r.amountReceivable;
    openAmount += r.balanceReceivable;
    receivedAmount += r.amountReceived;
    maxAmount = Math.max(maxAmount, r.amountReceivable);
    if (r.status === "OVERDUE") overdueCount += 1;
    if (r.balanceReceivable > MONEY_TOLERANCE && r.dueDate) {
      if (!nextDueDate || r.dueDate < nextDueDate) nextDueDate = r.dueDate;
    }
  }
  return {
    totalAmount: round2(totalAmount),
    openAmount: round2(openAmount),
    receivedAmount: round2(receivedAmount),
    overdueCount,
    nextDueDate,
    maxAmount: round2(maxAmount),
    totalCount: receivables.length,
  };
}

function buildTimeline(input: {
  orderIssueDate: Date | null | undefined;
  proposal: OrderFullAuditProposalBlock | null;
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  receivables: OrderFullAuditReceivable[];
}): OrderFullAuditTimelinePoint[] {
  const stockDate = latestIso(
    input.stockDocuments.map((d) => d.dataDocumento).filter((d): d is string => Boolean(d))
  );
  const stockTotal = input.stockDocuments.reduce((s, d) => s + d.totalValue, 0);
  const nfeDate = latestIso(
    input.nfes
      .map((n) => n.dataEmissao ?? n.dataProcessamento)
      .filter((d): d is string => Boolean(d))
  );
  const nfeTotal = input.nfes.reduce((s, n) => s + (n.valorTotal ?? 0), 0);

  // CR "gerado" = data mais antiga entre os títulos (fluxo cronológico da esteira).
  const receivableIssuedDate = (() => {
    const dates = input.receivables
      .map((r) => r.competenceDate ?? r.scheduleDate)
      .filter((d): d is string => Boolean(d));
    if (dates.length === 0) return null;
    return dates.sort()[0] ?? null;
  })();
  const receivableTotal = input.receivables.reduce(
    (s, r) => s + r.amountReceivable,
    0
  );

  // Vencimento consolidado = próximo vencimento em aberto ou o mais recente já vencido.
  const openReceivables = input.receivables.filter(
    (r) => r.balanceReceivable > MONEY_TOLERANCE
  );
  const nextOpenDueDate = (() => {
    const dates = openReceivables
      .map((r) => r.dueDate)
      .filter((d): d is string => Boolean(d));
    return dates.length > 0 ? dates.sort()[0]! : null;
  })();
  const dueDate = nextOpenDueDate ?? latestIso(input.receivables.map((r) => r.dueDate));
  const dueBalance = round2(
    openReceivables.reduce((s, r) => s + r.balanceReceivable, 0)
  );
  const overdueCount = input.receivables.filter(
    (r) => r.status === "OVERDUE"
  ).length;

  const paymentDate = latestIso(input.receivables.map((r) => r.settlementDate));
  const paidTotal = input.receivables.reduce((s, r) => s + r.amountReceived, 0);

  const timeline: OrderFullAuditTimelinePoint[] = [];
  if (input.proposal?.present) {
    timeline.push({
      key: "PROPOSAL",
      label: "Proposta comercial",
      date: null,
      detail:
        input.proposal.proposalNumber ??
        input.proposal.externalProposalCode ??
        input.proposal.status ??
        "Proposta vinculada",
      active: true,
      amount:
        input.proposal.totals.totalNetValue != null
          ? round2(input.proposal.totals.totalNetValue)
          : null,
      alert: null,
    });
  }
  timeline.push(
    {
      key: "ORDER_ISSUED",
      label: "Pedido emitido",
      date: toIso(input.orderIssueDate ?? null),
      detail: null,
      active: Boolean(input.orderIssueDate),
      amount: null,
      alert: null,
    },
    {
      key: "STOCK_DOCUMENT",
      label: "Documento de saída",
      date: stockDate,
      detail:
        input.stockDocuments.length > 0
          ? `${input.stockDocuments.length} documento(s)`
          : null,
      active: input.stockDocuments.length > 0,
      amount: input.stockDocuments.length > 0 ? round2(stockTotal) : null,
      alert:
        input.stockDocuments.some((d) => d.hasExcess || d.hasOutside)
          ? "Documento com excedente ou produto fora do pedido"
          : null,
    },
    {
      key: "NFE",
      label: "NF-e",
      date: nfeDate,
      detail: input.nfes.length > 0 ? `${input.nfes.length} NF(s)` : null,
      active: input.nfes.length > 0,
      amount: input.nfes.length > 0 ? round2(nfeTotal) : null,
      alert: input.nfes.some((n) => n.headerGreaterThanOrder)
        ? "NF maior que pedido"
        : input.nfes.some((n) => !n.hasReceivable)
          ? "NF sem CR vinculado"
          : null,
    },
    {
      key: "RECEIVABLE",
      label: "CR gerado",
      date: receivableIssuedDate,
      detail:
        input.receivables.length > 0
          ? `${input.receivables.length} título(s)`
          : null,
      active: input.receivables.length > 0,
      amount: input.receivables.length > 0 ? round2(receivableTotal) : null,
      alert: null,
    },
    {
      key: "DUE_DATE",
      label: "Vencimento",
      date: dueDate,
      detail:
        overdueCount > 0
          ? `${overdueCount} título(s) vencido(s)`
          : openReceivables.length > 0
            ? `${openReceivables.length} em aberto`
            : null,
      active: Boolean(dueDate),
      amount: dueBalance > MONEY_TOLERANCE ? dueBalance : null,
      alert: overdueCount > 0 ? "CR vencido" : null,
    },
    {
      key: "PAYMENT",
      label: "Baixa / recebimento",
      date: paymentDate,
      detail: paymentDate ? "Recebido" : null,
      active: Boolean(paymentDate),
      amount: paidTotal > MONEY_TOLERANCE ? round2(paidTotal) : null,
      alert: null,
    }
  );
  return timeline;
}

function buildAlerts(input: {
  order: Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>;
  items: OrderFullAuditItem[];
  facts: OrderToCashAuditFactRecord[];
  summary: OrderFullAuditPayload["summary"];
  orderSeller: ResolvedOrderSellerIdentity;
  receivables: OrderFullAuditReceivable[];
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  stockDocuments: OrderFullAuditStockDocument[];
  stockDocumentItems: OrderFullAuditStockDocumentItem[];
  nfes: OrderFullAuditNfe[];
  nfeItems: OrderFullAuditNfeItem[];
  proposal: OrderFullAuditProposalBlock;
  proposalVsOrderComparisons: OrderFullAuditProposalOrderComparison | null;
  delivery: OrderFullAuditDeliveryBlock;
  freight: OrderFullAuditFreightBlock;
  marginPricing: OrderFullAuditMarginPricingBlock;
  commissions: OrderFullAuditCommissionBlock;
}): OrderFullAuditAlert[] {
  const alerts: OrderFullAuditAlert[] = [];

  const seen = new Set<string>();
  const push = (a: OrderFullAuditAlert): void => {
    const key = `${a.code}:${a.description}`;
    if (seen.has(key)) return;
    seen.add(key);
    alerts.push(a);
  };

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Documentos de Saída
  // (renomeadas dos códigos legados DOCUMENTO_COM_EXCEDENTE/PRODUTO_FORA_DO_PEDIDO)
  // -------------------------------------------------------------------
  for (const doc of input.stockDocuments) {
    if (doc.hasExcess) {
      push({
        code: "DOCUMENT_WITH_EXCESS",
        severity: "warning",
        title: "Documento com excedente",
        description: `Documento ${doc.stockDocumentExternalId} tem quantidade excedente ao pedido.`,
        origin: "Documento de saída",
        action: "Revisar alocação item × documento.",
        financialImpact: doc.outsideOrderValue > 0 ? round2(doc.outsideOrderValue) : null,
      });
    }
    if (doc.hasOutside) {
      push({
        code: "DOCUMENT_EXTRA_ITEM",
        severity: "warning",
        title: "Produto fora do pedido no documento",
        description: `Documento ${doc.stockDocumentExternalId} contém produto não pertencente ao pedido.`,
        origin: "Documento de saída",
        action: "Confirmar se o vínculo é intencional ou emitir documento separado.",
        financialImpact: round2(doc.outsideOrderValue),
      });
    }
    if (doc.idNfe == null) {
      push({
        code: "DOCUMENT_WITHOUT_NFE",
        severity: "warning",
        title: "Documento sem NF-e vinculada",
        description: `Documento de saída ${doc.stockDocumentExternalId} sem NF-e vinculada.`,
        origin: "Documento de saída",
        action: "Confirmar emissão da NF ou vínculo com o pedido.",
        financialImpact: null,
      });
    }
    if (doc.linkOrigin === "HEADER_ONLY" || doc.linkOrigin === "SALES_ORDER_NFE_LINK") {
      push({
        code: "DOCUMENT_ALLOCATED_BY_HEADER_ONLY",
        severity: "info",
        title: "Documento vinculado só pelo cabeçalho",
        description: `Documento ${doc.stockDocumentExternalId} não possui evidência linha a linha do pedido (${doc.linkOrigin}).`,
        origin: "Documento de saída",
        action:
          "Rever mapper para produzir evidência item × documento (linha, não header).",
        financialImpact: null,
      });
    }
    if (doc.alerts.includes("DOCUMENT_ALLOCATED_TO_CANCELED_ITEM")) {
      push({
        code: "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM",
        severity: "warning",
        title: "Documento alocado em item cancelado",
        description: `Documento ${doc.stockDocumentExternalId} tem item alocado a linha do pedido cancelada/stale.`,
        origin: "Documento de saída × SalesOrderItem",
        action: "Reprocessar alocação ou reverter documento no Nomus.",
        financialImpact: null,
      });
    }
    if (doc.alerts.includes("DOCUMENT_WITHOUT_ORDER_ITEM")) {
      push({
        code: "DOCUMENT_WITHOUT_ORDER_ITEM",
        severity: "warning",
        title: "Documento sem item de pedido",
        description: `Documento ${doc.stockDocumentExternalId} não casou com nenhum SalesOrderItem.`,
        origin: "Documento de saída",
        action: "Verificar sync do documento ou vínculo com o pedido.",
        financialImpact: null,
      });
    }
  }

  // Divergências por linha do documento (preço/quantidade). Deduplicamos por doc+item.
  const priceMismatchesSeen = new Set<string>();
  const qtyMismatchesSeen = new Set<string>();
  for (const dItem of input.stockDocumentItems) {
    if (dItem.alerts.includes("DOCUMENT_PRICE_MISMATCH")) {
      const key = `${dItem.stockDocumentExternalId}:${dItem.stockDocumentItemId}`;
      if (!priceMismatchesSeen.has(key)) {
        priceMismatchesSeen.add(key);
        push({
          code: "DOCUMENT_PRICE_MISMATCH",
          severity: "warning",
          title: "Preço divergente doc × pedido",
          description: `Documento ${dItem.stockDocumentExternalId} · item ${dItem.productSku ?? dItem.stockDocumentItemId}: preço ${
            dItem.unitValue != null ? formatMoneyShort(dItem.unitValue) : "?"
          } × pedido ${
            dItem.orderUnitPrice != null
              ? formatMoneyShort(dItem.orderUnitPrice)
              : "?"
          } (Δ ${
            dItem.priceDiffAbsolute != null
              ? formatMoneyShort(dItem.priceDiffAbsolute)
              : "?"
          }).`,
          origin: "NomusStockDocumentItem × SalesOrderItem",
          action:
            "Confirmar se houve renegociação; caso contrário, ajustar documento.",
          financialImpact: dItem.financialImpact,
        });
      }
    }
    if (dItem.alerts.includes("DOCUMENT_QUANTITY_MISMATCH")) {
      const key = `${dItem.stockDocumentExternalId}:${dItem.stockDocumentItemId}`;
      if (!qtyMismatchesSeen.has(key)) {
        qtyMismatchesSeen.add(key);
        push({
          code: "DOCUMENT_QUANTITY_MISMATCH",
          severity: "info",
          title: "Quantidade doc × pedido diferente",
          description: `Documento ${dItem.stockDocumentExternalId} · item ${dItem.productSku ?? dItem.stockDocumentItemId}: quantidade doc ${
            dItem.quantityDocument ?? "?"
          } × pedido ${dItem.orderUnitPrice != null ? "linked" : "?"}.`,
          origin: "NomusStockDocumentItem × SalesOrderItem",
          action:
            "Confirmar entrega parcial/excedente ou revisar mapper de quantidade.",
          financialImpact: null,
        });
      }
    }
  }
  // -------------------------------------------------------------------
  // Divergências oficiais da aba NF-e
  // (renomeadas dos códigos legados NF_MAIOR_QUE_PEDIDO/NF_SEM_CR)
  // -------------------------------------------------------------------
  for (const nfe of input.nfes) {
    if (nfe.isCanceled) {
      push({
        code: "NFE_CANCELED_LINKED_TO_ORDER",
        severity: "warning",
        title: "NF-e cancelada vinculada ao pedido",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} está cancelada (status ${nfe.statusRaw ?? "—"}). Exibida apenas para auditoria e não considerada como faturamento válido.`,
        origin: "NomusNfe.status",
        action: "Manter vínculo para rastreio; usar apenas NF válida no faturamento.",
        financialImpact: nfe.valorTotal,
      });
      if (nfe.hasReceivable || nfe.linkedReceivableExternalIds.length > 0) {
        push({
          code: "CANCELED_NFE_WITH_RECEIVABLE",
          severity: "critical",
          title: "CR vinculado a NF-e cancelada",
          description: `Existe título de Contas a Receber vinculado a uma NF-e cancelada (NF ${nfe.numero ?? nfe.nfeExternalId}).`,
          origin: "NomusAccountsReceivable × NomusNfe",
          action: "Não apagar o CR oficial; reconciliar cancelamento fiscal × financeira.",
          financialImpact: nfe.valorTotal,
        });
      }
      if (nfe.alerts.includes("CANCELED_NFE_INCLUDED_IN_BILLING_VALUE")) {
        push({
          code: "CANCELED_NFE_INCLUDED_IN_BILLING_VALUE",
          severity: "critical",
          title: "NF cancelada estava no valor faturado",
          description: `NF-e cancelada ${nfe.numero ?? nfe.nfeExternalId} tinha alocação bruta ${formatMoneyShort(nfe.allocatedValueToOrderRaw)} e foi excluída do faturamento válido.`,
          origin: "NomusNfe.status × alocação",
          action: "Usar apenas NF válida no faturamento; manter cancelada só como evidência.",
          financialImpact: nfe.allocatedValueToOrderRaw,
        });
      }
      if (nfe.linkedStockDocumentExternalIds.length > 0) {
        push({
          code: "DOCUMENT_LINKED_TO_CANCELED_NFE",
          severity: "warning",
          title: "Documento de saída vinculado a NF cancelada",
          description: `Documento(s) ${nfe.linkedStockDocumentExternalIds.slice(0, 3).join(", ")} vinculados à NF cancelada ${nfe.numero ?? nfe.nfeExternalId}.`,
          origin: "NomusStockDocument × NomusNfe",
          action: "Manter evidência; não usar essa NF como faturamento válido.",
          financialImpact: null,
        });
      }
      continue;
    }

    if (nfe.statusNormalized === "UNKNOWN") {
      push({
        code: "NFE_STATUS_UNKNOWN",
        severity: "warning",
        title: "Status da NF-e desconhecido",
        description: `Status da NF ${nfe.numero ?? nfe.nfeExternalId} não pôde ser normalizado (bruto: ${nfe.statusRaw ?? "null"}).`,
        origin: "NomusNfe.status",
        action: "Conferir sync NomusNfe.status e payload da NF.",
        financialImpact: null,
      });
    }

    if (nfe.headerGreaterThanOrder) {
      push({
        code: "NFE_HEADER_GREATER_THAN_ORDER",
        severity: "warning",
        title: "Cabeçalho de NF maior que pedido",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} tem cabeçalho > valor ativo do pedido.`,
        origin: "NF-e",
        action: "Não inflar carteira; conferir se a NF cobre mais de um pedido.",
        financialImpact:
          nfe.valorTotal != null && input.summary.activeOrderValue > 0
            ? round2(Math.max(0, nfe.valorTotal - input.summary.activeOrderValue))
            : null,
      });
    }
    if (
      nfe.valorTotal != null &&
      input.summary.activeOrderValue > 0 &&
      nfe.valorTotal - input.summary.activeOrderValue > MONEY_TOLERANCE &&
      !nfe.headerGreaterThanOrder
    ) {
      push({
        code: "NFE_VALUE_GREATER_THAN_ACTIVE_ORDER",
        severity: "warning",
        title: "Valor total da NF maior que valor ativo do pedido",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} (R$ ${nfe.valorTotal.toFixed(2)}) > valor ativo R$ ${input.summary.activeOrderValue.toFixed(2)}.`,
        origin: "NF-e",
        action:
          "Confirmar se a NF cobre outros pedidos; do contrário, revisar alocação.",
        financialImpact: round2(
          nfe.valorTotal - input.summary.activeOrderValue
        ),
      });
    }
    if (nfe.linkedStockDocumentExternalIds.length === 0) {
      push({
        code: "NFE_WITHOUT_DOCUMENT",
        severity: "warning",
        title: "NF-e sem documento de saída",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} não está vinculada a um documento de saída (evidência ausente).`,
        origin: "NF-e",
        action: "Verificar sync do documento de saída no Nomus.",
        financialImpact: null,
      });
    }
    if (!nfe.hasReceivable) {
      push({
        code: "NFE_WITHOUT_CR",
        severity: "warning",
        title: "NF-e sem CR",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} não possui título de Contas a Receber vinculado.`,
        origin: "NF-e / CR",
        action: "Verificar geração de CR no Nomus.",
        financialImpact: null,
      });
    }
    if (nfe.hasExtraItems) {
      push({
        code: "NFE_EXTRA_ITEM",
        severity: "warning",
        title: "NF-e com item fora do pedido",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} contém itens que não pertencem ao Pedido de Venda (valor R$ ${nfe.outsideOrderItemsValue.toFixed(2)}).`,
        origin: "NF-e",
        action:
          "Confirmar se a NF cobre outros pedidos ou revisar mapper item × NF.",
        financialImpact: nfe.outsideOrderItemsValue > 0.009
          ? round2(nfe.outsideOrderItemsValue)
          : null,
      });
    }
    if (
      nfe.linkOrigin === "HEADER_ONLY" ||
      nfe.linkOrigin === "SALES_ORDER_NFE_LINK"
    ) {
      push({
        code: "NFE_ALLOCATED_BY_HEADER_ONLY",
        severity: "info",
        title: "NF vinculada só pelo cabeçalho",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} não possui evidência linha a linha (linkOrigin=${nfe.linkOrigin}).`,
        origin: "NF-e",
        action: "Melhorar mapper para produzir evidência item × NF.",
        financialImpact: null,
      });
    }
  }

  for (const doc of input.stockDocuments) {
    if (doc.alerts.includes("DOCUMENT_LINKED_TO_CANCELED_NFE")) {
      push({
        code: "DOCUMENT_LINKED_TO_CANCELED_NFE",
        severity: "warning",
        title: "Documento de saída vinculado a NF cancelada",
        description: `Documento ${doc.stockDocumentExternalId} aponta para NF-e cancelada (idNfe=${doc.idNfe ?? "—"}).`,
        origin: "NomusStockDocument.idNfe",
        action: "Exibir vínculo na auditoria; não usar a NF cancelada no faturamento válido.",
        financialImpact: null,
      });
    }
  }
  // Alertas por item da NF — preço.
  const nfePriceSeen = new Set<string>();
  for (const item of input.nfeItems) {
    if (item.alerts.includes("NFE_PRICE_MISMATCH")) {
      const key = `${item.nfeExternalId}:${item.nfeItemIndex}:${item.productExternalId ?? "?"}`;
      if (nfePriceSeen.has(key)) continue;
      nfePriceSeen.add(key);
      push({
        code: "NFE_PRICE_MISMATCH",
        severity: "warning",
        title: "Preço divergente NF × pedido",
        description: `NF ${item.nfeNumber ?? item.nfeExternalId} · item ${item.productSku ?? item.nfeItemIndex ?? "?"}: preço NF ${
          item.unitValueNfe != null
            ? formatMoneyShort(item.unitValueNfe)
            : "?"
        } × pedido ${
          item.orderUnitPrice != null
            ? formatMoneyShort(item.orderUnitPrice)
            : "?"
        } (Δ ${
          item.priceDiffNfeVsOrderAbsolute != null
            ? formatMoneyShort(item.priceDiffNfeVsOrderAbsolute)
            : "?"
        }).`,
        origin: "NomusNfe × SalesOrderItem",
        action: "Confirmar renegociação ou revisar mapper de preço da NF.",
        financialImpact:
          item.priceDiffNfeVsOrderAbsolute != null && item.quantityNfe != null
            ? round2(item.priceDiffNfeVsOrderAbsolute * item.quantityNfe)
            : null,
      });
    }
  }
  // -------------------------------------------------------------------
  // Divergências oficiais da aba Financeiro — Títulos e Baixas
  // -------------------------------------------------------------------
  const totalReceivableAmount = round2(
    input.receivables.reduce((s, r) => s + r.amountReceivable, 0)
  );
  const totalReceivableOpen = round2(
    input.receivables.reduce((s, r) => s + r.balanceReceivable, 0)
  );
  const totalDocumentedValue = round2(
    input.nfes.reduce((s, n) => s + n.allocatedValueToOrder, 0)
  );

  if (
    input.summary.activeOrderValue > 0 &&
    totalReceivableAmount - input.summary.activeOrderValue > MONEY_TOLERANCE
  ) {
    push({
      code: "RECEIVABLE_GREATER_THAN_ACTIVE_ORDER",
      severity: "warning",
      title: "CR total maior que valor ativo do pedido",
      description: `Σ CR = ${formatMoneyShort(totalReceivableAmount)} > valor ativo ${formatMoneyShort(input.summary.activeOrderValue)}.`,
      origin: "Contas a Receber",
      action:
        "Confirmar se os CRs cobrem mais de um pedido; caso contrário revisar alocação.",
      financialImpact: round2(
        totalReceivableAmount - input.summary.activeOrderValue
      ),
    });
  }
  if (
    totalDocumentedValue > 0 &&
    totalDocumentedValue - totalReceivableAmount > MONEY_TOLERANCE
  ) {
    push({
      code: "RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE",
      severity: "warning",
      title: "CR menor que valor já documentado",
      description: `Σ CR = ${formatMoneyShort(totalReceivableAmount)} < NF alocada ${formatMoneyShort(totalDocumentedValue)}.`,
      origin: "NF-e × CR",
      action: "Verificar se algum título ainda não foi gerado no Nomus.",
      financialImpact: round2(totalDocumentedValue - totalReceivableAmount),
    });
  }
  if (totalReceivableOpen > MONEY_TOLERANCE) {
    push({
      code: "RECEIVABLE_OPEN",
      severity: "info",
      title: "CR em aberto",
      description: `Total em aberto: ${formatMoneyShort(totalReceivableOpen)} em ${input.receivables.filter((r) => r.balanceReceivable > MONEY_TOLERANCE).length} título(s).`,
      origin: "Contas a Receber",
      action: "Acompanhar recebimento conforme cronograma.",
      financialImpact: totalReceivableOpen,
    });
  }

  // Deduplicação por evidência: mesmo CR referenciado por vários facts.
  const receivableRefFactCount = new Map<number, number>();
  for (const fact of input.facts) {
    // O fact não traz receivableExternalId direto; usamos a NF como proxy.
    // Se um NF gerou 1 CR e o fact traz esse NF várias vezes (por múltiplos itens do pedido),
    // então o CR "aparece" várias vezes na trilha de auditoria. Contamos para o alerta.
    const nfeNum = fact.nfeNumber?.trim();
    if (!nfeNum) continue;
    // Localiza o CR correspondente pela NF number → sourceInvoiceNumber.
    for (const r of input.receivables) {
      if (r.sourceInvoiceNumber === nfeNum) {
        receivableRefFactCount.set(
          r.receivableExternalId,
          (receivableRefFactCount.get(r.receivableExternalId) ?? 0) + 1
        );
      }
    }
  }
  for (const [externalId, count] of receivableRefFactCount) {
    if (count > 1) {
      push({
        code: "RECEIVABLE_DUPLICATED_BY_ITEM_FACTS",
        severity: "info",
        title: "CR referenciado por várias evidências",
        description: `Título ${externalId} aparece em ${count} evidências item × NF (mostrado uma única vez na aba).`,
        origin: "Contas a Receber × Fact",
        action:
          "Não é erro — apenas confirmação de que o CR foi deduplicado corretamente.",
        financialImpact: null,
      });
    }
  }

  for (const receivable of input.receivables) {
    if (receivable.alerts.includes("RECEIVED_CR_LINKED_TO_CANCELED_NFE")) {
      push({
        code: "RECEIVED_CR_LINKED_TO_CANCELED_NFE",
        severity: "critical",
        title: "CR recebido vinculado a NF cancelada",
        description: `CR ${receivable.searchReference} está ${receivable.status === "RECEIVED" ? "recebido" : "parcialmente recebido"} e vinculado à NF cancelada ${receivable.linkedNfeNumber ?? receivable.sourceInvoiceNumber ?? "—"}. Revisar se houve substituição, estorno ou reemissão.`,
        origin: "NomusAccountsReceivable × NomusNfe",
        action:
          "Manter status financeiro oficial; investigar inconsistência fiscal/financeira antes de tratar como recebimento normal.",
        financialImpact: round2(receivable.amountReceived ?? 0),
      });
    } else if (receivable.alerts.includes("CANCELED_NFE_WITH_RECEIVABLE")) {
      push({
        code: "CANCELED_NFE_WITH_RECEIVABLE",
        severity: "critical",
        title: "CR vinculado a NF-e cancelada",
        description: `Existe título de Contas a Receber (${receivable.searchReference}) vinculado a uma NF-e cancelada (${receivable.linkedNfeNumber ?? "—"}).`,
        origin: "NomusAccountsReceivable × NomusNfe",
        action: "Não apagar o CR oficial; reconciliar cancelamento fiscal × financeira.",
        financialImpact: round2(receivable.amountReceivable ?? 0),
      });
    }
    if (receivable.alerts.includes("RECEIVABLE_WITHOUT_NFE")) {
      push({
        code: "RECEIVABLE_WITHOUT_NFE",
        severity: "warning",
        title: "CR sem NF-e vinculada",
        description: `Título ${receivable.receivableExternalId} sem NF associada (sourceInvoiceId ausente).`,
        origin: "Contas a Receber",
        action: "Confirmar geração da NF fiscal correspondente.",
        financialImpact: round2(receivable.amountReceivable ?? 0),
      });
    }
    if (receivable.alerts.includes("RECEIVABLE_WITHOUT_DUE_DATE")) {
      push({
        code: "RECEIVABLE_WITHOUT_DUE_DATE",
        severity: "warning",
        title: "CR sem data de vencimento",
        description: `Título ${receivable.receivableExternalId} não tem dueDate — cronograma indefinido.`,
        origin: "Contas a Receber",
        action: "Corrigir cadastro do CR no Nomus.",
        financialImpact: null,
      });
    }
    if (receivable.alerts.includes("RECEIPT_GREATER_THAN_RECEIVABLE")) {
      push({
        code: "RECEIPT_GREATER_THAN_RECEIVABLE",
        severity: "critical",
        title: "Recebido maior que previsto",
        description: `Título ${receivable.receivableExternalId}: recebido ${formatMoneyShort(receivable.amountReceived ?? 0)} > previsto ${formatMoneyShort(receivable.amountReceivable ?? 0)}.`,
        origin: "Contas a Receber",
        action:
          "Investigar duplicidade de baixa ou ajuste manual não conciliado.",
        financialImpact: round2(
          (receivable.amountReceived ?? 0) -
            (receivable.amountReceivable ?? 0)
        ),
      });
    }
    if (
      receivable.alerts.includes("PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE")
    ) {
      push({
        code: "PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE",
        severity: "warning",
        title: "Baixa parcial com saldo inconsistente",
        description: `Título ${receivable.receivableExternalId}: previsto − recebido ≠ saldo (esperado ${formatMoneyShort((receivable.amountReceivable ?? 0) - (receivable.amountReceived ?? 0))} × real ${formatMoneyShort(receivable.balanceReceivable ?? 0)}).`,
        origin: "Contas a Receber",
        action: "Revisar cronograma / juros / multa aplicados no CR.",
        financialImpact: round2(
          Math.abs(
            (receivable.amountReceivable ?? 0) -
              (receivable.amountReceived ?? 0) -
              (receivable.balanceReceivable ?? 0)
          )
        ),
      });
    }
    if (receivable.status === "OVERDUE") {
      push({
        code: "RECEIVABLE_OVERDUE",
        severity: "critical",
        title: "CR vencido",
        description: `Título ${receivable.receivableExternalId} vencido em ${receivable.dueDate ?? "?"}${
          receivable.daysOverdue != null
            ? ` (há ${receivable.daysOverdue} dia(s))`
            : ""
        }.`,
        origin: "Contas a Receber",
        action: "Priorizar cobrança.",
        financialImpact: round2(receivable.balanceReceivable),
      });
    }
  }
  // -------------------------------------------------------------------
  // Divergências oficiais dos Recebíveis Planejados (forecast)
  // Só emitidas quando não existe CR real para a mesma parcela — a linha
  // "replacedByRealCr" é mantida no payload para auditoria mas não gera alerta.
  // -------------------------------------------------------------------
  const hasAnyRealCr = input.receivables.length > 0;
  const pendingPlannedForAlerts = input.plannedReceivables.filter(
    (p) => !p.replacedByRealCr
  );
  for (const planned of pendingPlannedForAlerts) {
    const dueLabel = planned.dueDate ?? "sem vencimento";
    if (planned.statusLabel === "Vencido") {
      push({
        code: "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
        severity: "critical",
        title: "Parcela planejada vencida sem CR real",
        description: `${planned.reference} venceu em ${dueLabel} sem NF/CR real emitida (${formatMoneyShort(
          planned.openAmount
        )}).`,
        origin: "Pedido de Venda / Condição de pagamento",
        action:
          "Confirmar emissão da NF e sync do Contas a Receber para regularizar o CR real.",
        financialImpact: round2(planned.openAmount),
      });
    } else {
      push({
        code: "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
        severity: "warning",
        title: "Recebível planejado sem CR real",
        description: `${planned.reference} previsto para ${dueLabel} — ainda sem NF/CR real (${formatMoneyShort(
          planned.openAmount
        )}).`,
        origin: "Pedido de Venda / Condição de pagamento",
        action:
          "Emitir NF-e ou aguardar sincronismo do Contas a Receber para gerar CR real.",
        financialImpact: round2(planned.openAmount),
      });
    }
  }
  // Substituição por CR real — informativo, ajuda a auditar dedup.
  const replacedPlanned = input.plannedReceivables.filter(
    (p) => p.replacedByRealCr
  );
  if (replacedPlanned.length > 0 && hasAnyRealCr) {
    push({
      code: "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
      severity: "info",
      title: "Recebível planejado substituído por CR real",
      description: `${replacedPlanned.length} parcela(s) planejada(s) foram substituída(s) pelo CR real (dedup automático por valor/vencimento).`,
      origin: "Auditoria 360º / dedup",
      action: "Nenhuma ação — CR real prevalece.",
      financialImpact: null,
    });
  }

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Itens do Pedido
  // (códigos renomeados dos legados ITEM_CANCELADO/ITEM_COM_CORTE/etc.)
  // -------------------------------------------------------------------
  const repeatedSkuAlreadyReported = new Set<string>();
  for (const item of input.items) {
    const label = item.itemSequence ?? item.productCode ?? item.salesOrderItemId;
    if (item.nomusIsCanceled) {
      push({
        code: "ORDER_ITEM_CANCELED",
        severity: "info",
        title: "Item cancelado",
        description: `Item ${label} está cancelado no Pedido de Venda/Nomus.`,
        origin: "SalesOrderItem",
        action: "Não conta como pendente; exibido apenas para auditoria.",
        financialImpact: item.canceledValue,
      });
    }
    if (item.nomusIsCut) {
      push({
        code: "ORDER_ITEM_CUT",
        severity: "info",
        title: "Item atendido com corte",
        description: `Item ${label} teve saldo cortado no Nomus.`,
        origin: "SalesOrderItem",
        action:
          "Saldo cortado encerra pendência; não gera comissão nem NO_MARGIN.",
        financialImpact: item.cutValue,
      });
    }
    if (item.nomusIsStale) {
      push({
        code: "ORDER_ITEM_STALE",
        severity: "warning",
        title: "Item removido do pedido",
        description: `Item ${label} não veio no último payload Nomus.`,
        origin: "SalesOrderItem",
        action: "Confirmar exclusão intencional; item mantido para histórico.",
        financialImpact: item.canceledValue,
      });
    }
    const statusUpper = (item.nomusItemStatusNormalized ?? "").toUpperCase();
    if (!statusUpper || statusUpper === "UNKNOWN") {
      push({
        code: "ORDER_ITEM_STATUS_UNKNOWN",
        severity: "warning",
        title: "Status de item desconhecido",
        description: `Item ${label} sem status normalizado (Nomus raw="${item.nomusItemStatusRaw ?? ""}").`,
        origin: "SalesOrderItem",
        action:
          "Revisar mapper nomusSalesOrderItemStatus para adicionar suporte ao status bruto.",
        financialImpact: null,
      });
    }
    if ((item.matchConfidence ?? "").toUpperCase() === "AMBIGUOUS") {
      push({
        code: "ITEM_STATUS_MATCH_AMBIGUOUS",
        severity: "warning",
        title: "Casamento item × payload ambíguo",
        description: `Item ${label}: SKU repetido sem evidência de linha para reconciliar com o payload Nomus.`,
        origin: "Nomus itensPedido",
        action:
          "Ajustar `nomusItemExternalId`/`nomusItemSequence` na sincronização.",
        financialImpact: null,
      });
    }
    if (
      item.productCode &&
      (item.alerts?.includes("REPEATED_SKU_WITH_DIFFERENT_STATUS") ?? false) &&
      !repeatedSkuAlreadyReported.has(item.productCode)
    ) {
      repeatedSkuAlreadyReported.add(item.productCode);
      push({
        code: "REPEATED_SKU_WITH_DIFFERENT_STATUS",
        severity: "info",
        title: "SKU repetido com status diferente por linha",
        description: `SKU ${item.productCode} aparece em múltiplas linhas com status distintos. Cada linha mantém seu status oficial.`,
        origin: "SalesOrderItem × Nomus",
        action:
          "Validar mapeamento por linha (não herdar cancelamento entre linhas do mesmo SKU).",
        financialImpact: null,
      });
    }
    if (
      !item.nomusIsCanceled &&
      !item.nomusIsCut &&
      !item.nomusIsStale &&
      (item.activePendingQuantity ?? 0) > 0.0001
    ) {
      // Aparece consolidado como info; o alerta agressivo é o DELIVERY_DATE_OVERDUE.
      push({
        code: "ORDER_ITEM_ACTIVE_PENDING",
        severity: "info",
        title: "Item ativo pendente",
        description: `Item ${label} continua ativo com saldo pendente ${
          item.activePendingQuantity != null
            ? item.activePendingQuantity
            : "?"
        }.`,
        origin: "SalesOrderItem",
        action: "Priorizar produção/expedição do saldo pendente.",
        financialImpact: item.activeValue,
      });
    }
    if (
      item.quantity != null &&
      item.nomusQuantityFulfilled != null &&
      item.nomusQuantityFulfilled - item.quantity > 0.0001 &&
      !item.nomusIsCut
    ) {
      push({
        code: "ORDER_ITEM_OVER_FULFILLED",
        severity: "warning",
        title: "Item super-atendido",
        description: `Item ${label} atendeu ${item.nomusQuantityFulfilled} × quantidade pedida ${item.quantity}.`,
        origin: "SalesOrderItem × Nomus",
        action:
          "Confirmar se houve substituição de item; documento pode estar sobreatendendo o pedido.",
        financialImpact: null,
      });
    }
  }

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Pedido de Venda
  // -------------------------------------------------------------------
  const order = input.order;
  const orderSeller = input.orderSeller;

  if (orderSeller.alertCodes.includes("SELLER_NOT_INFORMED") && !orderSeller.isInformed) {
    push({
      code: "SELLER_NOT_INFORMED",
      severity: "warning",
      title: "Vendedor Pedido ausente",
      description:
        "Pedido sem vendedor raw no SalesOrder nem no snapshot de comissão.",
      origin: "SalesOrder",
      action: "Corrigir cadastro do vendedor no Pedido de Venda no Nomus.",
      financialImpact: null,
    });
  }
  if (orderSeller.alertCodes.includes("SELLER_ALIAS_NOT_MAPPED")) {
    push({
      code: "SELLER_ALIAS_NOT_MAPPED",
      severity: "warning",
      title: "Vendedor Pedido não mapeado",
      description: `Há vendedor raw (ID ${orderSeller.rawExternalId ?? "—"}) sem CommissionPerson/Alias canônico.`,
      origin: "SalesOrder × CommissionPersonAlias",
      action: "Cadastrar alias do vendedor Nomus no comissionamento.",
      financialImpact: null,
    });
  }
  if (
    orderSeller.alertCodes.includes(
      "SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT"
    )
  ) {
    push({
      code: "SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT",
      severity: "info",
      title: "Vendedor resolvido pelo snapshot de comissão",
      description:
        "SalesOrder estava incompleto; vendedor veio do CommissionOrderSnapshot ACTIVE.",
      origin: "CommissionOrderSnapshot × SalesOrder",
      action: "Completar externalSellerId/nomusSellerName no Pedido Nomus na próxima sync.",
      financialImpact: null,
    });
  }
  if (orderSeller.alertCodes.includes("SELLER_SOURCE_MISMATCH")) {
    push({
      code: "SELLER_SOURCE_MISMATCH",
      severity: "warning",
      title: "Vendedor diverge entre Pedido e snapshot",
      description:
        "SalesOrder.externalSellerId difere do rawSellerId do CommissionOrderSnapshot.",
      origin: "CommissionOrderSnapshot × SalesOrder",
      action: "Revisar rematerialização de comissão e sync do pedido.",
      financialImpact: null,
    });
  }
  if (
    input.summary.commercialResponsibleName == null ||
    !input.summary.commercialResponsibleName.trim()
  ) {
    push({
      code: "COMMERCIAL_RESPONSIBLE_MISSING",
      severity: "info",
      title: "Responsável comercial ausente",
      description:
        "Cliente sem responsável comercial cadastrado no CRM (`CrmCustomerCommercialOwner`).",
      origin: "CRM",
      action: "Atribuir responsável comercial no cadastro do cliente.",
      financialImpact: null,
    });
  }
  if (!input.summary.paymentTerms && !input.summary.paymentMethod) {
    push({
      code: "PAYMENT_TERM_MISSING",
      severity: "warning",
      title: "Condição de pagamento ausente",
      description: "Pedido sem condição/forma de pagamento explícita.",
      origin: "SalesOrder",
      action: "Preencher no Nomus para gerar cronograma correto.",
      financialImpact: null,
    });
  }

  // Entrega vencida — só quando ainda há saldo pendente ativo.
  if (order?.expectedDeliveryDate && input.summary.pendingActiveOrderValue > 0.01) {
    const expected = new Date(order.expectedDeliveryDate);
    if (!Number.isNaN(expected.getTime())) {
      const now = new Date();
      if (expected.getTime() < now.getTime()) {
        push({
          code: "DELIVERY_DATE_OVERDUE",
          severity: "warning",
          title: "Data de entrega vencida",
          description: `Entrega prevista em ${expected.toISOString().slice(0, 10)}; ainda há saldo pendente ativo.`,
          origin: "SalesOrder",
          action: "Revisar cronograma de expedição com a produção/PCP.",
          financialImpact: round2(input.summary.pendingActiveOrderValue),
        });
      }
    }
  }

  const orderStatusStr = order?.status ? String(order.status).trim() : "";
  if (!orderStatusStr || orderStatusStr.toUpperCase() === "UNKNOWN") {
    push({
      code: "ORDER_STATUS_UNKNOWN",
      severity: "info",
      title: "Status do pedido desconhecido",
      description:
        "Pedido sem status oficial. Revisar sync/mapper para atribuir status correto.",
      origin: "SalesOrder",
      action: "Confirmar status no Nomus e reprocessar sync.",
      financialImpact: null,
    });
  }

  if (input.items.length === 0) {
    push({
      code: "ORDER_WITHOUT_ITEMS",
      severity: "critical",
      title: "Pedido sem itens",
      description: "SalesOrder não possui `SalesOrderItem` cadastrado.",
      origin: "SalesOrder",
      action: "Investigar falha de sync do Nomus ou pedido criado manualmente incompleto.",
      financialImpact: null,
    });
  }

  const headerNet = decimalToNumber(order?.totalNetValue) ?? 0;
  const itemsSum = round2(
    input.items.reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  if (input.items.length > 0 && Math.abs(headerNet - itemsSum) > MONEY_TOLERANCE) {
    push({
      code: "ORDER_HEADER_ITEMS_TOTAL_MISMATCH",
      severity: "warning",
      title: "Cabeçalho × itens divergente",
      description: `Cabeçalho ${formatMoneyShort(headerNet)} × soma dos itens ${formatMoneyShort(itemsSum)} (Δ ${formatMoneyShort(headerNet - itemsSum)}).`,
      origin: "SalesOrder × SalesOrderItem",
      action:
        "Recalcular totais do pedido ou revisar itens (cancelados/cortados podem justificar).",
      financialImpact: round2(headerNet - itemsSum),
    });
  }

  // Uso indevido do `responsible` como Responsável Comercial.
  const responsibleName = order?.responsible ?? null;
  const commercialMissing =
    input.summary.commercialResponsibleName == null ||
    !input.summary.commercialResponsibleName.trim();
  if (commercialMissing && isOperationalSectorName(responsibleName)) {
    push({
      code: "OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE",
      severity: "warning",
      title: "Setor operacional apontado como Responsável Comercial",
      description: `Campo \`SalesOrder.responsible\` = "${responsibleName ?? ""}" é setor operacional; não deve ser usado como Responsável Comercial.`,
      origin: "SalesOrder × CRM",
      action:
        "Atribuir Responsável Comercial no CRM do cliente. Manter `responsible` como setor operacional.",
      financialImpact: null,
    });
  }

  // -------------------------------------------------------------------
  // Divergências da aba Proposta / Origem Comercial
  // -------------------------------------------------------------------
  const proposal = input.proposal;
  const orderHasProposalLink =
    (input.order?.proposalId ?? null) != null;

  if (orderHasProposalLink && !proposal.present) {
    push({
      code: "PROPOSAL_NOT_FOUND",
      severity: "warning",
      title: "Proposta não encontrada",
      description:
        proposal.emptyReason === "PROPOSAL_LOAD_ERROR"
          ? "Pedido possui `proposalId` mas a Proposal falhou ao carregar."
          : "Pedido referencia `proposalId` mas a Proposal correspondente não existe.",
      origin: "Proposal",
      action: "Revisar sync/vínculo entre pedido e proposta.",
      financialImpact: null,
    });
  }

  if (proposal.present) {
    const comparison = input.proposalVsOrderComparisons;
    if (comparison && !comparison.totalNetValue.matches) {
      const diff = comparison.totalNetValue.diff ?? 0;
      push({
        code: "PROPOSAL_ORDER_VALUE_MISMATCH",
        severity: "warning",
        title: "Valor Proposta × Pedido divergente",
        description: `Valor líquido diverge — proposta ${formatMoneyShort(
          comparison.totalNetValue.proposal
        )} × pedido ${formatMoneyShort(
          comparison.totalNetValue.salesOrder
        )} (Δ ${formatMoneyShort(diff)}).`,
        origin: "Proposal × SalesOrder",
        action:
          "Confirmar se houve renegociação após envio da proposta ou corrigir a proposta.",
        financialImpact: diff,
      });
    }
    if (comparison && !comparison.paymentTerms.matches) {
      push({
        code: "PROPOSAL_PAYMENT_TERM_MISMATCH",
        severity: "info",
        title: "Condição de pagamento divergente",
        description: `Proposta="${comparison.paymentTerms.proposal ?? "—"}" × Pedido="${comparison.paymentTerms.salesOrder ?? "—"}".`,
        origin: "Proposal × SalesOrder",
        action:
          "Confirmar se a mudança foi acordada; alinhar cronograma financeiro.",
        financialImpact: null,
      });
    }
    if (comparison && !comparison.freightCondition.matches) {
      push({
        code: "PROPOSAL_FREIGHT_MISMATCH",
        severity: "info",
        title: "Condição de frete divergente",
        description: `Proposta="${comparison.freightCondition.proposal ?? "—"}" × Pedido="${comparison.freightCondition.salesOrder ?? "—"}".`,
        origin: "Proposal × SalesOrder",
        action: "Rever CIF/FOB no pedido antes do faturamento.",
        financialImpact: null,
      });
    }

    for (const pi of proposal.items) {
      if (pi.convertedToSalesOrderItem == null) {
        push({
          code: "PROPOSAL_ITEM_NOT_CONVERTED",
          severity: "info",
          title: "Item da proposta sem conversão",
          description: `Item ${pi.productSku ?? pi.productId ?? pi.proposalItemId} da proposta não virou item de pedido.`,
          origin: "ProposalItem",
          action:
            "Confirmar se o item foi removido ou aguardando aprovação.",
          financialImpact: pi.totalNetValue,
        });
        continue;
      }
      if (pi.alerts.includes("PROPOSAL_PRICE_MISMATCH")) {
        const diff = pi.convertedToSalesOrderItem.negotiatedPriceDiff;
        push({
          code: "PROPOSAL_PRICE_MISMATCH",
          severity: "warning",
          title: "Preço unitário divergente",
          description: `Item ${pi.productSku ?? pi.productId ?? pi.proposalItemId}: proposta ${formatMoneyShort(
            pi.negotiatedPrice
          )} × pedido ${formatMoneyShort(
            pi.convertedToSalesOrderItem.negotiatedPrice
          )} (Δ ${formatMoneyShort(diff)}).`,
          origin: "ProposalItem × SalesOrderItem",
          action:
            "Confirmar renegociação de preço ou corrigir a proposta.",
          financialImpact: pi.convertedToSalesOrderItem.totalNetValueDiff,
        });
      }
    }

    for (const it of input.items) {
      if (it.proposalItemId == null) {
        push({
          code: "ORDER_ITEM_WITHOUT_PROPOSAL_ITEM",
          severity: "info",
          title: "Item do pedido sem item de proposta",
          description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} do pedido não referencia proposalItemId.`,
          origin: "SalesOrderItem",
          action:
            "Confirmar se o item foi incluído fora da proposta ou anexar à proposta.",
          financialImpact: it.totalNetValue,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Entrega / Produção / Frete
  // -------------------------------------------------------------------
  const nowMs = Date.now();
  for (const it of input.items) {
    const isActive =
      !it.nomusIsCanceled && !it.nomusIsStale && !it.nomusIsCut;
    const overdue =
      isActive &&
      it.expectedDeliveryDate != null &&
      new Date(it.expectedDeliveryDate).getTime() < nowMs &&
      (it.activePendingQuantity ?? 0) > 0.0001;

    if (overdue && it.linkedStockDocumentExternalIds.length === 0) {
      push({
        code: "DELIVERY_OVERDUE_WITHOUT_DOCUMENT",
        severity: "warning",
        title: "Entrega vencida sem documento",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} vencido em ${it.expectedDeliveryDate ?? "?"} sem documento de saída.`,
        origin: "SalesOrderItem × Documento de saída",
        action: "Priorizar expedição do saldo ativo.",
        financialImpact: it.activeValue,
      });
    }
    if (overdue && it.linkedNfeExternalIds.length === 0) {
      push({
        code: "ACTIVE_ITEM_OVERDUE_WITHOUT_NFE",
        severity: "warning",
        title: "Item ativo vencido sem NF-e",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} vencido em ${it.expectedDeliveryDate ?? "?"} sem NF-e emitida.`,
        origin: "SalesOrderItem × NF-e",
        action: "Confirmar produção/expedição e emissão fiscal.",
        financialImpact: it.activeValue,
      });
    }
    if (
      it.productionQuantity != null &&
      it.invoicedQuantity != null &&
      it.invoicedQuantity - it.productionQuantity > 0.0001 &&
      !it.nomusIsCanceled &&
      !it.nomusIsStale
    ) {
      push({
        code: "PRODUCTION_QUANTITY_LESS_THAN_INVOICED",
        severity: "warning",
        title: "Produção menor que faturado",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId}: produzido ${it.productionQuantity} < faturado ${it.invoicedQuantity}.`,
        origin: "SalesOrderItem × Nomus",
        action:
          "Confirmar substituição de item ou lançamento de estoque atrasado.",
        financialImpact: null,
      });
    }
    if (
      it.saldoPronto != null &&
      it.saldoPronto > 0.0001 &&
      !it.nomusIsCanceled &&
      !it.nomusIsStale &&
      it.invoicedQuantity != null &&
      it.quantity != null &&
      it.invoicedQuantity < it.quantity - 0.0001
    ) {
      push({
        code: "READY_BALANCE_NOT_INVOICED",
        severity: "info",
        title: "Saldo pronto sem faturar",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} tem saldo pronto ${it.saldoPronto} aguardando faturamento.`,
        origin: "SalesOrderItem × Estoque",
        action: "Priorizar emissão de NF para o saldo pronto.",
        financialImpact:
          it.saldoPronto != null && it.unitPrice != null
            ? round2(it.saldoPronto * it.unitPrice)
            : null,
      });
    }
    // Consistência: item cancelado/cut não deve estar sinalizado como pendente/overdue.
    if (
      it.nomusIsCanceled &&
      (it.alerts.includes("DELIVERY_DATE_OVERDUE") ||
        it.alerts.includes("ORDER_ITEM_ACTIVE_PENDING"))
    ) {
      push({
        code: "CANCELED_ITEM_MARKED_AS_OVERDUE",
        severity: "critical",
        title: "Item cancelado marcado como vencido/pendente",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} está cancelado no Nomus mas foi sinalizado como vencido/pendente.`,
        origin: "Auditoria de item",
        action: "Bug interno — cancelado não pode gerar atraso ativo.",
        financialImpact: null,
      });
    }
    if (
      it.nomusIsCut &&
      (it.alerts.includes("ORDER_ITEM_ACTIVE_PENDING") ||
        (it.activePendingQuantity ?? 0) > 0.0001)
    ) {
      push({
        code: "CUT_ITEM_MARKED_AS_PENDING",
        severity: "warning",
        title: "Item com corte marcado como pendente",
        description: `Item ${it.itemSequence ?? it.productCode ?? it.salesOrderItemId} teve saldo cortado mas ainda aparece como pendente ativo.`,
        origin: "Auditoria de item",
        action:
          "Corte encerra pendência: revisar `activePendingQuantity` calculado.",
        financialImpact: null,
      });
    }
  }

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Margem, Preço e Custo
  // -------------------------------------------------------------------
  const marginItemsByCode = new Map<string, OrderFullAuditMarginPricingItem[]>();
  for (const mi of input.marginPricing.items) {
    for (const code of mi.alerts) {
      const arr = marginItemsByCode.get(code) ?? [];
      arr.push(mi);
      marginItemsByCode.set(code, arr);
    }
  }
  const marginCodeMeta: Record<
    string,
    { severity: OrderFullAuditAlert["severity"]; title: string; origin: string; action: string }
  > = {
    NO_MARGIN: {
      severity: "warning",
      title: "Item ativo sem margem calculável (NO_MARGIN)",
      origin: "Margem × SalesOrderItem",
      action:
        "Confirmar vínculo de produto, custo e tabela de preço vigente na data do pedido.",
    },
    PRICE_TABLE_NOT_FOUND: {
      severity: "warning",
      title: "Tabela de preço não encontrada para o item",
      origin: "PriceTable × SalesOrderItem",
      action: "Publicar preço oficial ou revisar vínculo produto × tabela.",
    },
    COST_NOT_FOUND: {
      severity: "warning",
      title: "Custo não encontrado para o item ativo",
      origin: "CostTable × SalesOrderItem",
      action: "Sincronizar custo oficial ou apurar custo padrão.",
    },
    ORDER_PRICE_BELOW_TABLE: {
      severity: "info",
      title: "Preço do pedido abaixo da tabela",
      origin: "SalesOrderItem × PriceTable",
      action: "Confirmar desconto autorizado ou revisar preço praticado.",
    },
    ORDER_PRICE_DIFFERS_FROM_DOCUMENT: {
      severity: "warning",
      title: "Preço do pedido diverge do documento de saída",
      origin: "SalesOrderItem × NomusStockDocumentItem",
      action:
        "Revisar mapper de preço unitário do documento ou renegociação.",
    },
    DOCUMENT_PRICE_DIFFERS_FROM_NFE: {
      severity: "warning",
      title: "Preço do documento diverge da NF-e",
      origin: "NomusStockDocumentItem × NomusNfe",
      action:
        "Confirmar emissão fiscal ou revisar mapper de preço unitário NF.",
    },
    NEGATIVE_MARGIN: {
      severity: "critical",
      title: "Margem negativa em item ativo",
      origin: "Margem",
      action: "Revisar custo ou renegociar preço.",
    },
    CANCELED_ITEM_GENERATING_NO_MARGIN: {
      severity: "critical",
      title: "Item cancelado gerando NO_MARGIN",
      origin: "Auditoria de margem",
      action:
        "Bug interno: item cancelado não deve buscar margem/tabela — corrigir builder.",
    },
    STALE_ITEM_GENERATING_MARGIN: {
      severity: "warning",
      title: "Item stale gerando margem",
      origin: "Auditoria de margem",
      action: "Bug interno: item stale não deve entrar no cálculo de margem.",
    },
    PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE: {
      severity: "warning",
      title: "Sem tabela de preço vigente na data do pedido",
      origin: "PriceTableVersion × SalesOrder",
      action:
        "Publicar tabela cobrindo a data de emissão do pedido ou ajustar vigência.",
    },
  };
  const marginCodesEmitted = new Set<string>();
  for (const [code, group] of marginItemsByCode) {
    const meta = marginCodeMeta[code];
    if (!meta) continue;
    for (const mi of group) {
      push({
        code,
        severity: meta.severity,
        title: meta.title,
        description: `Item ${mi.itemSequence ?? mi.productCode ?? mi.salesOrderItemId}${
          mi.marginStatusLabel ? ` (${mi.marginStatusLabel})` : ""
        }.`,
        origin: meta.origin,
        action: meta.action,
        financialImpact:
          code === "ORDER_PRICE_DIFFERS_FROM_DOCUMENT" &&
          mi.priceDiffOrderVsDocumentAbs != null &&
          mi.activeQuantity != null
            ? round2(mi.priceDiffOrderVsDocumentAbs * mi.activeQuantity)
            : code === "NEGATIVE_MARGIN"
              ? mi.marginValue
              : null,
      });
      marginCodesEmitted.add(code);
    }
  }
  // Tabela para a data do pedido — dispara uma única vez quando 100% dos ativos com produto
  // não conseguiram achar preço de tabela.
  const activeItems = input.marginPricing.items.filter((i) => i.isActive);
  if (
    activeItems.length > 0 &&
    activeItems.every((i) => i.officialTableUnitPrice == null)
  ) {
    push({
      code: "PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE",
      severity: "warning",
      title: "Nenhuma tabela de preço vigente na data do pedido",
      description: `Nenhum dos ${activeItems.length} item(ns) ativo(s) casou com tabela de preço para a data do pedido.`,
      origin: "PriceTableVersion × SalesOrder",
      action: "Confirmar publicação da tabela cobrindo a data de emissão.",
      financialImpact: null,
    });
  }

  // -------------------------------------------------------------------
  // Divergências oficiais da aba Comissões
  // -------------------------------------------------------------------
  const commissions = input.commissions;
  const orderTotalCommission =
    commissions.totals.totalFinalCommissionAmount ?? 0;

  // Só alerta se não houver raw seller em pedido/snapshot e comissão existir.
  if (
    orderTotalCommission > MONEY_TOLERANCE &&
    !orderSeller.isInformed &&
    commissions.rawSellerId == null &&
    !(commissions.canonicalSellerName ?? "").trim()
  ) {
    push({
      code: "COMMISSION_WITHOUT_SELLER",
      severity: "critical",
      title: "Comissão calculada sem vendedor Nomus",
      description: `Snapshot de comissão tem ${formatMoneyShort(orderTotalCommission)} mas não há vendedor raw/canônico em nenhuma fonte.`,
      origin: "CommissionOrderSnapshot × SalesOrder",
      action: "Corrigir cadastro do vendedor no Pedido de Venda no Nomus.",
      financialImpact: orderTotalCommission,
    });
  }

  // Uso indevido do Responsável Comercial como vendedor comissionável.
  if (
    commissions.commercialResponsibleName &&
    commissions.canonicalSellerName &&
    commissions.commercialResponsibleName.trim().toUpperCase() ===
      commissions.canonicalSellerName.trim().toUpperCase()
  ) {
    push({
      code: "RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER",
      severity: "critical",
      title: "Responsável Comercial usado como vendedor comissionável",
      description: `Responsável Comercial (CRM) = Vendedor canônico da comissão ("${commissions.commercialResponsibleName}"). Regra oficial: vendedor da comissão vem do Pedido/Nomus, não do CRM.`,
      origin: "CommissionOrderSnapshot × CRM",
      action:
        "Corrigir origem: vendedor comissionável deve vir de SalesOrder.nomusSellerName.",
      financialImpact: null,
    });
  }

  // Item cancelado gerando comissão.
  const canceledWithCommission = commissions.items.filter((i) =>
    i.alerts.includes("CANCELED_ITEM_GENERATING_COMMISSION")
  );
  for (const ci of canceledWithCommission) {
    push({
      code: "CANCELED_ITEM_GENERATING_COMMISSION",
      severity: "critical",
      title: "Item cancelado gerando comissão",
      description: `Item ${ci.itemSequence ?? ci.productCode ?? ci.salesOrderItemId} está cancelado/stale no Nomus mas tem comissão ${formatMoneyShort(ci.finalCommissionAmount)} no snapshot.`,
      origin: "CommissionOrderItemSnapshot × SalesOrderItem",
      action: "Reprocessar snapshot de comissão para excluir item cancelado.",
      financialImpact: ci.finalCommissionAmount,
    });
  }

  // Liberação sem baixa: releasedCommissionAmount > 0 mas settlementDate null.
  for (const r of commissions.receipts) {
    if (
      (r.releasedCommissionAmount ?? 0) > 0.009 &&
      r.settlementDate == null
    ) {
      push({
        code: "COMMISSION_RELEASED_WITHOUT_RECEIPT",
        severity: "warning",
        title: "Comissão liberada sem baixa registrada",
        description: `CR ${r.receivableExternalId ?? r.receivableNumber ?? "?"}: comissão liberada ${formatMoneyShort(r.releasedCommissionAmount)} sem data de baixa.`,
        origin: "CommissionReceiptLedgerLine",
        action:
          "Confirmar baixa do CR ou revisar critério de liberação.",
        financialImpact: r.releasedCommissionAmount,
      });
    }
  }

  // Comissão paga com divergência: paid > release.
  for (const r of commissions.receipts) {
    if (
      (r.paidCommissionAmount ?? 0) > 0.009 &&
      (r.releasedCommissionAmount ?? 0) > 0.009 &&
      (r.paidCommissionAmount ?? 0) - (r.releasedCommissionAmount ?? 0) > 0.009
    ) {
      push({
        code: "COMMISSION_PAID_WITH_DIVERGENCE",
        severity: "critical",
        title: "Comissão paga maior que liberada",
        description: `CR ${r.receivableExternalId ?? r.receivableNumber ?? "?"}: pago ${formatMoneyShort(r.paidCommissionAmount)} > liberado ${formatMoneyShort(r.releasedCommissionAmount)}.`,
        origin: "CommissionReceiptLedgerLine",
        action:
          "NÃO alterar comissão paga — investigar duplicidade ou ajuste manual.",
        financialImpact:
          r.paidCommissionAmount != null && r.releasedCommissionAmount != null
            ? round2(r.paidCommissionAmount - r.releasedCommissionAmount)
            : null,
      });
    }
  }

  // Cliente exceção ativo.
  if (commissions.customerExceptions.some((e) => e.active)) {
    push({
      code: "CUSTOMER_COMMISSION_EXCEPTION",
      severity: "info",
      title: "Cliente com exceção de comissão ativa",
      description: `Cliente do pedido possui ${commissions.customerExceptions.filter((e) => e.active).length} exceção(ões) ativa(s) de comissionamento.`,
      origin: "CommissionCustomerException",
      action:
        "Revisar aplicabilidade das exceções ao pedido antes de comissionar.",
      financialImpact: null,
    });
  }

  // Base de comissão > valor recebido: comissão não pode exceder o que foi recebido.
  const totalCommissionBase = commissions.totals.commissionableBase ?? 0;
  const totalReceived = input.summary.receivableReceivedValue ?? 0;
  if (totalReceived > 0.009 && totalCommissionBase - totalReceived > 0.01) {
    push({
      code: "COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE",
      severity: "warning",
      title: "Base de comissão maior que valor recebido",
      description: `Base comissionável ${formatMoneyShort(totalCommissionBase)} > total recebido ${formatMoneyShort(totalReceived)}.`,
      origin: "CommissionOrderSnapshot × Contas a Receber",
      action:
        "Aguardar recebimento total antes de liberar comissão OU revisar cronograma.",
      financialImpact: round2(totalCommissionBase - totalReceived),
    });
  }

  // SELLER_NOT_INFORMED já emitido na aba Pedido; não duplicar.

  // Frete: divergência de condição entre pedido e proposta (quando existir).
  if (
    input.freight.freightCondition &&
    input.proposal.present &&
    input.proposal.freightCondition &&
    input.freight.freightCondition.trim().toUpperCase() !==
      input.proposal.freightCondition.trim().toUpperCase()
  ) {
    push({
      code: "FREIGHT_CONDITION_MISMATCH",
      severity: "info",
      title: "Condição de frete divergente entre pedido e proposta",
      description: `Pedido="${input.freight.freightCondition}" × Proposta="${input.proposal.freightCondition}".`,
      origin: "SalesOrder × Proposal",
      action: "Confirmar renegociação de frete pós-proposta.",
      financialImpact: null,
    });
  }

  // -------------------------------------------------------------------
  // Pós-processamento: categorização + dedup canônico
  // -------------------------------------------------------------------
  const enriched: OrderFullAuditAlert[] = [];
  const seenCanonicalKeys = new Set<string>();
  for (const a of alerts) {
    const meta = getAlertMetadata(a.code);
    const enrichedSeverity: OrderFullAuditAlertSeverity =
      meta?.severity ??
      (a.severity === "critical"
        ? "critical"
        : a.severity === "warning"
          ? "medium"
          : "info");
    const category = meta?.category ?? "REGISTRATION";
    const linkedTab = meta?.linkedTab ?? "divergences";
    // Best-effort para preencher reference/entityId a partir de menções na description.
    const orderCodeMatch = /PD\s*\d{4,}/i.exec(a.description);
    const nfeMatch = /NF\s+(\d+)/i.exec(a.description);
    const docMatch = /Documento\s+(\d+)/i.exec(a.description);
    const itemMatch = /Item\s+([\w#.\-/]+)/i.exec(a.description);
    const titleMatch = /Título\s+(\d+)/i.exec(a.description);
    const reference =
      titleMatch?.[1] ??
      nfeMatch?.[1] ??
      docMatch?.[1] ??
      itemMatch?.[1] ??
      orderCodeMatch?.[0] ??
      null;
    const entityType =
      category === "ORDER_ITEM"
        ? "SalesOrderItem"
        : category === "STOCK_DOCUMENT"
          ? "NomusStockDocument"
          : category === "NFE"
            ? "NomusNfe"
            : category === "RECEIVABLE" || category === "RECEIPT"
              ? "NomusAccountsReceivable"
              : category === "COMMISSION"
                ? "CommissionOrderSnapshot"
                : category === "COMMERCIAL"
                  ? "Proposal"
                  : category === "MARGIN_PRICING"
                    ? "SalesOrderItem"
                    : category === "DELIVERY" || category === "FREIGHT"
                      ? "SalesOrder"
                      : "SalesOrder";
    const canonicalKey = [
      a.code,
      entityType ?? "",
      reference ?? "",
      Math.round((a.financialImpact ?? 0) * 100),
    ].join("|");
    if (seenCanonicalKeys.has(canonicalKey)) continue;
    seenCanonicalKeys.add(canonicalKey);
    enriched.push({
      ...a,
      severity: enrichedSeverity,
      category,
      entityType,
      entityId: reference,
      reference,
      quantityImpact: null,
      alertDate: null,
      status: "OPEN",
      linkedTab,
    });
  }

  return enriched;
}

/**
 * Metadata canônica para cada código de divergência oficial da Auditoria 360º.
 * `severity` aqui **substitui** a severity emitida no `push()` — permite manter
 * o mapa de código → severidade em um único lugar auditável.
 */
type AlertMetadata = {
  category: OrderFullAuditAlertCategory;
  severity: OrderFullAuditAlertSeverity;
  linkedTab: OrderFullAuditAlert["linkedTab"];
};

function getAlertMetadata(code: string): AlertMetadata | null {
  const map: Record<string, AlertMetadata> = {
    // Comercial / Proposta
    PROPOSAL_NOT_FOUND: {
      category: "COMMERCIAL",
      severity: "medium",
      linkedTab: "proposal",
    },
    PROPOSAL_ORDER_VALUE_MISMATCH: {
      category: "COMMERCIAL",
      severity: "high",
      linkedTab: "proposal",
    },
    PROPOSAL_ITEM_NOT_CONVERTED: {
      category: "COMMERCIAL",
      severity: "info",
      linkedTab: "proposal",
    },
    ORDER_ITEM_WITHOUT_PROPOSAL_ITEM: {
      category: "COMMERCIAL",
      severity: "info",
      linkedTab: "proposal",
    },
    PROPOSAL_PRICE_MISMATCH: {
      category: "COMMERCIAL",
      severity: "high",
      linkedTab: "proposal",
    },
    PROPOSAL_QUANTITY_MISMATCH: {
      category: "COMMERCIAL",
      severity: "info",
      linkedTab: "proposal",
    },
    PROPOSAL_PAYMENT_TERM_MISMATCH: {
      category: "COMMERCIAL",
      severity: "info",
      linkedTab: "proposal",
    },
    PROPOSAL_FREIGHT_MISMATCH: {
      category: "COMMERCIAL",
      severity: "info",
      linkedTab: "proposal",
    },
    FREIGHT_CONDITION_MISMATCH: {
      category: "FREIGHT",
      severity: "info",
      linkedTab: "delivery",
    },
    // Pedido / Item
    ORDER_ITEM_CANCELED: {
      category: "ORDER_ITEM",
      severity: "info",
      linkedTab: "items",
    },
    ORDER_ITEM_CUT: {
      category: "ORDER_ITEM",
      severity: "info",
      linkedTab: "items",
    },
    ORDER_ITEM_STALE: {
      category: "ORDER_ITEM",
      severity: "medium",
      linkedTab: "items",
    },
    ORDER_ITEM_STATUS_UNKNOWN: {
      category: "ORDER_ITEM",
      severity: "medium",
      linkedTab: "items",
    },
    ORDER_ITEM_ACTIVE_PENDING: {
      category: "ORDER_ITEM",
      severity: "info",
      linkedTab: "items",
    },
    ORDER_ITEM_OVER_FULFILLED: {
      category: "ORDER_ITEM",
      severity: "high",
      linkedTab: "items",
    },
    REPEATED_SKU_WITH_DIFFERENT_STATUS: {
      category: "ORDER_ITEM",
      severity: "info",
      linkedTab: "items",
    },
    ITEM_STATUS_MATCH_AMBIGUOUS: {
      category: "INTEGRATION_NOMUS",
      severity: "medium",
      linkedTab: "items",
    },
    SELLER_NOT_INFORMED: {
      category: "ORDER",
      severity: "medium",
      linkedTab: "salesOrder",
    },
    SELLER_ALIAS_NOT_MAPPED: {
      category: "ORDER",
      severity: "medium",
      linkedTab: "salesOrder",
    },
    SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT: {
      category: "ORDER",
      severity: "info",
      linkedTab: "salesOrder",
    },
    SELLER_SOURCE_MISMATCH: {
      category: "ORDER",
      severity: "medium",
      linkedTab: "salesOrder",
    },
    SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT: {
      category: "ORDER",
      severity: "info",
      linkedTab: "salesOrder",
    },
    COMMERCIAL_RESPONSIBLE_MISSING: {
      category: "REGISTRATION",
      severity: "info",
      linkedTab: "salesOrder",
    },
    PAYMENT_TERM_MISSING: {
      category: "RECEIVABLE",
      severity: "medium",
      linkedTab: "financial",
    },
    DELIVERY_DATE_OVERDUE: {
      category: "DELIVERY",
      severity: "high",
      linkedTab: "delivery",
    },
    ORDER_STATUS_UNKNOWN: {
      category: "ORDER",
      severity: "info",
      linkedTab: "salesOrder",
    },
    ORDER_WITHOUT_ITEMS: {
      category: "ORDER",
      severity: "critical",
      linkedTab: "salesOrder",
    },
    ORDER_HEADER_ITEMS_TOTAL_MISMATCH: {
      category: "ORDER",
      severity: "medium",
      linkedTab: "salesOrder",
    },
    OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE: {
      category: "REGISTRATION",
      severity: "medium",
      linkedTab: "salesOrder",
    },
    // Documento
    DOCUMENT_WITH_EXCESS: {
      category: "STOCK_DOCUMENT",
      severity: "medium",
      linkedTab: "documents",
    },
    DOCUMENT_EXTRA_ITEM: {
      category: "STOCK_DOCUMENT",
      severity: "high",
      linkedTab: "documents",
    },
    DOCUMENT_WITHOUT_ORDER_ITEM: {
      category: "STOCK_DOCUMENT",
      severity: "medium",
      linkedTab: "documents",
    },
    DOCUMENT_WITHOUT_NFE: {
      category: "STOCK_DOCUMENT",
      severity: "medium",
      linkedTab: "documents",
    },
    DOCUMENT_PRICE_MISMATCH: {
      category: "STOCK_DOCUMENT",
      severity: "high",
      linkedTab: "documents",
    },
    DOCUMENT_QUANTITY_MISMATCH: {
      category: "STOCK_DOCUMENT",
      severity: "info",
      linkedTab: "documents",
    },
    DOCUMENT_ALLOCATED_TO_CANCELED_ITEM: {
      category: "STOCK_DOCUMENT",
      severity: "high",
      linkedTab: "documents",
    },
    DOCUMENT_ALLOCATED_BY_HEADER_ONLY: {
      category: "STOCK_DOCUMENT",
      severity: "info",
      linkedTab: "documents",
    },
    // NFE
    NFE_HEADER_GREATER_THAN_ORDER: {
      category: "NFE",
      severity: "high",
      linkedTab: "nfes",
    },
    NFE_VALUE_GREATER_THAN_ACTIVE_ORDER: {
      category: "NFE",
      severity: "high",
      linkedTab: "nfes",
    },
    NFE_WITHOUT_DOCUMENT: {
      category: "NFE",
      severity: "medium",
      linkedTab: "nfes",
    },
    NFE_WITHOUT_CR: {
      category: "NFE",
      severity: "medium",
      linkedTab: "nfes",
    },
    NFE_EXTRA_ITEM: {
      category: "NFE",
      severity: "high",
      linkedTab: "nfes",
    },
    NFE_PRICE_MISMATCH: {
      category: "NFE",
      severity: "medium",
      linkedTab: "nfes",
    },
    NFE_ALLOCATED_BY_HEADER_ONLY: {
      category: "NFE",
      severity: "info",
      linkedTab: "nfes",
    },
    NFE_CANCELED_LINKED_TO_ORDER: {
      category: "NFE",
      severity: "high",
      linkedTab: "nfes",
    },
    CANCELED_NFE_INCLUDED_IN_BILLING_VALUE: {
      category: "NFE",
      severity: "high",
      linkedTab: "nfes",
    },
    CANCELED_NFE_WITH_RECEIVABLE: {
      category: "NFE",
      severity: "critical",
      linkedTab: "financial",
    },
    RECEIVED_CR_LINKED_TO_CANCELED_NFE: {
      category: "RECEIVABLE",
      severity: "critical",
      linkedTab: "financial",
    },
    DOCUMENT_LINKED_TO_CANCELED_NFE: {
      category: "STOCK_DOCUMENT",
      severity: "high",
      linkedTab: "documents",
    },
    NFE_STATUS_UNKNOWN: {
      category: "NFE",
      severity: "medium",
      linkedTab: "nfes",
    },
    // Financeiro
    RECEIVABLE_OPEN: {
      category: "RECEIVABLE",
      severity: "info",
      linkedTab: "financial",
    },
    RECEIVABLE_OVERDUE: {
      category: "RECEIVABLE",
      severity: "critical",
      linkedTab: "financial",
    },
    RECEIVABLE_GREATER_THAN_ACTIVE_ORDER: {
      category: "RECEIVABLE",
      severity: "high",
      linkedTab: "financial",
    },
    RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE: {
      category: "RECEIVABLE",
      severity: "medium",
      linkedTab: "financial",
    },
    RECEIVABLE_DUPLICATED_BY_ITEM_FACTS: {
      category: "RECEIVABLE",
      severity: "info",
      linkedTab: "financial",
    },
    RECEIVABLE_WITHOUT_NFE: {
      category: "RECEIVABLE",
      severity: "medium",
      linkedTab: "financial",
    },
    RECEIVABLE_WITHOUT_DUE_DATE: {
      category: "RECEIVABLE",
      severity: "medium",
      linkedTab: "financial",
    },
    RECEIPT_GREATER_THAN_RECEIVABLE: {
      category: "RECEIPT",
      severity: "critical",
      linkedTab: "financial",
    },
    PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE: {
      category: "RECEIPT",
      severity: "medium",
      linkedTab: "financial",
    },
    PLANNED_RECEIVABLE_WITHOUT_REAL_CR: {
      category: "RECEIVABLE",
      severity: "medium",
      linkedTab: "financial",
    },
    PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR: {
      category: "RECEIVABLE",
      severity: "critical",
      linkedTab: "financial",
    },
    PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR: {
      category: "RECEIVABLE",
      severity: "info",
      linkedTab: "financial",
    },
    // Entrega / Frete
    DELIVERY_OVERDUE_WITHOUT_DOCUMENT: {
      category: "DELIVERY",
      severity: "high",
      linkedTab: "delivery",
    },
    ACTIVE_ITEM_OVERDUE_WITHOUT_NFE: {
      category: "DELIVERY",
      severity: "high",
      linkedTab: "delivery",
    },
    READY_BALANCE_NOT_INVOICED: {
      category: "DELIVERY",
      severity: "medium",
      linkedTab: "delivery",
    },
    CANCELED_ITEM_MARKED_AS_OVERDUE: {
      category: "DELIVERY",
      severity: "critical",
      linkedTab: "delivery",
    },
    CUT_ITEM_MARKED_AS_PENDING: {
      category: "DELIVERY",
      severity: "medium",
      linkedTab: "delivery",
    },
    PRODUCTION_QUANTITY_LESS_THAN_INVOICED: {
      category: "DELIVERY",
      severity: "high",
      linkedTab: "delivery",
    },
    // Margem/Preço
    NO_MARGIN: {
      category: "MARGIN_PRICING",
      severity: "medium",
      linkedTab: "marginPricing",
    },
    PRICE_TABLE_NOT_FOUND: {
      category: "MARGIN_PRICING",
      severity: "medium",
      linkedTab: "marginPricing",
    },
    COST_NOT_FOUND: {
      category: "MARGIN_PRICING",
      severity: "medium",
      linkedTab: "marginPricing",
    },
    ORDER_PRICE_BELOW_TABLE: {
      category: "MARGIN_PRICING",
      severity: "info",
      linkedTab: "marginPricing",
    },
    ORDER_PRICE_DIFFERS_FROM_DOCUMENT: {
      category: "MARGIN_PRICING",
      severity: "high",
      linkedTab: "marginPricing",
    },
    DOCUMENT_PRICE_DIFFERS_FROM_NFE: {
      category: "MARGIN_PRICING",
      severity: "high",
      linkedTab: "marginPricing",
    },
    NEGATIVE_MARGIN: {
      category: "MARGIN_PRICING",
      severity: "critical",
      linkedTab: "marginPricing",
    },
    CANCELED_ITEM_GENERATING_NO_MARGIN: {
      category: "MARGIN_PRICING",
      severity: "critical",
      linkedTab: "marginPricing",
    },
    STALE_ITEM_GENERATING_MARGIN: {
      category: "MARGIN_PRICING",
      severity: "medium",
      linkedTab: "marginPricing",
    },
    PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE: {
      category: "MARGIN_PRICING",
      severity: "medium",
      linkedTab: "marginPricing",
    },
    // Comissão
    COMMISSION_WITHOUT_SELLER: {
      category: "COMMISSION",
      severity: "critical",
      linkedTab: "commissions",
    },
    CANCELED_ITEM_GENERATING_COMMISSION: {
      category: "COMMISSION",
      severity: "critical",
      linkedTab: "commissions",
    },
    COMMISSION_RELEASED_WITHOUT_RECEIPT: {
      category: "COMMISSION",
      severity: "medium",
      linkedTab: "commissions",
    },
    COMMISSION_PAID_WITH_DIVERGENCE: {
      category: "COMMISSION",
      severity: "critical",
      linkedTab: "commissions",
    },
    CUSTOMER_COMMISSION_EXCEPTION: {
      category: "COMMISSION",
      severity: "info",
      linkedTab: "commissions",
    },
    COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE: {
      category: "COMMISSION",
      severity: "medium",
      linkedTab: "commissions",
    },
    RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER: {
      category: "COMMISSION",
      severity: "critical",
      linkedTab: "commissions",
    },
    CONDICAO_PAGAMENTO_AUSENTE: {
      category: "ORDER",
      severity: "medium",
      linkedTab: "salesOrder",
    },
  };
  return map[code] ?? null;
}

function formatMoneyShort(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
