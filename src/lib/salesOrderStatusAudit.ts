import type { EnrichedLifecycleItem } from "./salesOrderLifecycleStatus.js";
import type { SalesOrderLifecycleSummary } from "./salesOrderLifecycleTypes.js";
import { ITEM_NOMUS_STATUS_LABELS } from "./salesOrderManagementUi.js";
import {
  extractNomusProductionOrders,
  extractNomusRawItems,
  extractNomusRawNfes,
  extractSalesOrderItemRawField,
  extractSalesOrderRawField,
  matchRawItemToDbItem,
  normalizeNomusSalesOrderItemStatusCode,
  parseNomusBrOrIsoDate,
  resolveRawItemMatchType,
  type NomusRawItem,
  type RawItemMatchType,
} from "./salesOrderNomusRaw.js";

export type SalesOrderAuditSource =
  | "nomus_raw"
  | "induscost"
  | "calculated"
  | "inferred";

export type SalesOrderItemStatusSource =
  | "db"
  | "item_raw"
  | "order_raw"
  | "inferred"
  | "unknown";

export type SalesOrderAuditRuleTraceEntry = {
  rule: string;
  result: string;
  source: SalesOrderAuditSource;
  evidence?: string;
};

export type SalesOrderIntelligenceInvoiceLink = {
  label: string;
  href: string;
  type: "internal" | "external" | "download" | "copy";
};

export type SalesOrderIntelligenceInvoice = {
  id?: string | number | null;
  number?: string | null;
  series?: string | null;
  accessKey?: string | null;
  status?: string | null;
  issueDate?: string | null;
  processingDate?: string | null;
  totalValue?: number | null;
  source: "nomus_raw" | "nomus_nfe_table" | "inferred";
  linkedItems?: Array<{
    itemNumber?: string | null;
    sku?: string | null;
    quantity?: number | null;
    value?: number | null;
  }>;
  links: SalesOrderIntelligenceInvoiceLink[];
  rawSummary?: Record<string, unknown>;
};

export type SalesOrderIntelligenceRawData = {
  orderRawAvailable: boolean;
  orderRawKeys: string[];
  orderRawPreview: Record<string, unknown>;
  itemsRawPreview: Array<Record<string, unknown>>;
  invoicesRawPreview: Array<Record<string, unknown>>;
  previewTruncated: boolean;
};

export type SalesOrderIntelligenceAuditMeta = {
  generatedAt: string;
  sourcesUsed: string[];
  missingData: string[];
  warnings: string[];
};

const RAW_PREVIEW_MAX_KEYS = 40;
const RAW_PREVIEW_MAX_DEPTH = 2;

const HEADER_STATUS_KEYS = [
  "status",
  "situacao",
  "descricaoStatus",
  "situacaoPedido",
  "statusPedido",
  "nomeStatus",
  "statusDescricao",
] as const;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function formatNomusStatusLabel(
  raw: string | number | null | undefined
): string | null {
  if (raw == null || raw === "") return null;
  const fromCode = normalizeNomusSalesOrderItemStatusCode(raw);
  if (fromCode) {
    return ITEM_NOMUS_STATUS_LABELS[fromCode];
  }
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw.trim()))) {
    const code = typeof raw === "number" ? raw : Number.parseInt(raw.trim(), 10);
    return `Status Nomus não mapeado: código ${code}`;
  }
  return String(raw);
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = parseNomusBrOrIsoDate(value);
  return d ? d.toISOString() : value;
}

function shallowPreview(
  value: unknown,
  depth = 0,
  keyBudget = { remaining: RAW_PREVIEW_MAX_KEYS }
): unknown {
  if (keyBudget.remaining <= 0) return "[truncado]";
  if (value == null || typeof value !== "object") return value;
  if (depth >= RAW_PREVIEW_MAX_DEPTH) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    return "[objeto]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((v) => shallowPreview(v, depth + 1, keyBudget));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).slice(0, 20)) {
    keyBudget.remaining -= 1;
    if (keyBudget.remaining < 0) break;
    out[key] = shallowPreview(obj[key], depth + 1, keyBudget);
  }
  if (Object.keys(obj).length > 20) {
    out._truncatedKeys = Object.keys(obj).length - 20;
  }
  return out;
}

export function buildFinanceBillingLink(invoiceNumber?: string | null): string {
  if (invoiceNumber?.trim()) {
    return `/finance/billing?documentNumber=${encodeURIComponent(invoiceNumber.trim())}`;
  }
  return "/finance/billing";
}

export function extractNomusHeaderStatusRaw(
  nomusRawResponse: unknown
): string | number | null {
  const root = asObject(nomusRawResponse);
  if (!root) return null;
  for (const key of HEADER_STATUS_KEYS) {
    const direct = root[key];
    if (direct != null && direct !== "") {
      if (typeof direct === "object" && !Array.isArray(direct)) {
        const nested =
          asString((direct as Record<string, unknown>).descricao) ??
          asString((direct as Record<string, unknown>).nome) ??
          asString((direct as Record<string, unknown>).codigo);
        if (nested) return nested;
      }
      if (typeof direct === "number" && Number.isFinite(direct)) return direct;
      const text = asString(direct);
      if (text) return text;
    }
  }
  const fromAlias = extractSalesOrderRawField(nomusRawResponse, "status");
  if (fromAlias == null || fromAlias === "") return null;
  if (typeof fromAlias === "number" && Number.isFinite(fromAlias)) return fromAlias;
  return asString(fromAlias);
}

export function buildLifecycleRuleTrace(input: {
  lifecycle: SalesOrderLifecycleSummary;
  items: EnrichedLifecycleItem[];
  hasInvoice: boolean;
}): SalesOrderAuditRuleTraceEntry[] {
  const { lifecycle, items, hasInvoice } = input;
  const allCancelled =
    items.length > 0 && items.every((i) => i.isCancelled || i.normalizedStatus === "cancelled");
  const anyReturned = items.some((i) => i.isReturned);
  const anyCut = items.some((i) => i.hasCut);
  const overdueNoInvoice =
    lifecycle.deadlineStatus === "overdue" && !hasInvoice && lifecycle.operationalStatus !== "cancelled";
  const invoiceAfterDeadline = lifecycle.deadlineStatus === "invoiced_late";
  const invoiceOnTime =
    lifecycle.deadlineStatus === "invoiced_on_time" ||
    lifecycle.deadlineStatus === "invoiced_early";

  const trace: SalesOrderAuditRuleTraceEntry[] = [
    {
      rule: "Todos os itens cancelados?",
      result: allCancelled ? "Sim" : "Não",
      source: items.length > 0 ? "nomus_raw" : "inferred",
      evidence:
        items.length > 0
          ? `${items.filter((i) => i.isCancelled).length}/${items.length} itens cancelados`
          : "Sem itens no pedido",
    },
    {
      rule: "Possui NF processada?",
      result: hasInvoice ? "Sim" : "Não",
      source: hasInvoice ? "nomus_raw" : "calculated",
      evidence: hasInvoice
        ? lifecycle.invoiceNumbers.join(", ") || "NF no raw"
        : "Não localizado na integração",
    },
    {
      rule: "NF foi após prazo?",
      result: invoiceAfterDeadline ? "Sim" : hasInvoice ? "Não" : "Não aplicável",
      source: hasInvoice ? "calculated" : "inferred",
      evidence: lifecycle.lastInvoiceDate ?? lifecycle.expectedDeliveryDate ?? undefined,
    },
    {
      rule: "Previsão vencida sem NF?",
      result: overdueNoInvoice ? "Sim" : "Não",
      source: "calculated",
      evidence:
        lifecycle.daysOverdue != null
          ? `${lifecycle.daysOverdue} dia(s) de atraso`
          : undefined,
    },
    {
      rule: "Itens com devolução?",
      result: anyReturned ? "Sim" : "Não",
      source: "nomus_raw",
    },
    {
      rule: "Itens com corte?",
      result: anyCut ? "Sim" : "Não",
      source: "nomus_raw",
    },
    {
      rule: "NF no prazo?",
      result: invoiceOnTime ? "Sim" : hasInvoice ? "Não" : "Não aplicável",
      source: "calculated",
    },
    {
      rule: "Resultado — status gerencial",
      result: lifecycle.executiveStatusLabel,
      source: "induscost",
      evidence: lifecycle.operationalStatus,
    },
  ];

  return trace;
}

export function buildIntelligenceInvoices(
  nomusRawResponse: unknown
): SalesOrderIntelligenceInvoice[] {
  const nfes = extractNomusRawNfes(nomusRawResponse);
  return nfes.map((nfe, index) => {
    const links: SalesOrderIntelligenceInvoiceLink[] = [];
    if (nfe.accessKey) {
      links.push({
        label: "Copiar chave de acesso",
        href: nfe.accessKey,
        type: "copy",
      });
    }
    links.push({
      label: "Ver no Faturamento",
      href: buildFinanceBillingLink(nfe.numero),
      type: "internal",
    });

    const rawSummary = shallowPreview(nfe.raw) as Record<string, unknown>;
    return {
      id: index + 1,
      number: nfe.numero,
      series: nfe.serie,
      accessKey: nfe.accessKey,
      status: nfe.status ?? (nfe.dataProcessamento ? "Processada" : null),
      issueDate: toIsoDate(nfe.dataEmissao),
      processingDate: toIsoDate(nfe.dataProcessamento),
      totalValue: nfe.valor,
      source: "nomus_raw" as const,
      links,
      rawSummary,
    };
  });
}

export function buildRawDataPreview(nomusRawResponse: unknown): SalesOrderIntelligenceRawData {
  const root = asObject(nomusRawResponse);
  const orderRawAvailable = root != null;
  const orderRawKeys = root ? Object.keys(root).sort() : [];
  const rawItems = extractNomusRawItems(nomusRawResponse);
  const rawNfes = extractNomusRawNfes(nomusRawResponse);

  const keyBudget = { remaining: RAW_PREVIEW_MAX_KEYS };
  const orderRawPreview = root
    ? (shallowPreview(root, 0, keyBudget) as Record<string, unknown>)
    : {};
  const previewTruncated =
    orderRawKeys.length > RAW_PREVIEW_MAX_KEYS ||
    keyBudget.remaining <= 0;

  return {
    orderRawAvailable,
    orderRawKeys,
    orderRawPreview,
    itemsRawPreview: rawItems.map((item) =>
      shallowPreview(item.raw) as Record<string, unknown>
    ),
    invoicesRawPreview: rawNfes.map((nfe) =>
      shallowPreview(nfe.raw) as Record<string, unknown>
    ),
    previewTruncated,
  };
}

function buildItemRawSummary(raw: NomusRawItem | null): Record<string, unknown> {
  if (!raw) return {};
  return shallowPreview(raw.raw) as Record<string, unknown>;
}

function resolveItemStatusSource(
  raw: NomusRawItem | null,
  matchType: RawItemMatchType
): SalesOrderItemStatusSource {
  if (!raw) return "unknown";
  if (matchType === "none") return "inferred";
  return "item_raw";
}

function buildItemAlerts(item: EnrichedLifecycleItem): string[] {
  const alerts: string[] = [];
  if (item.normalizedStatus === "unknown") {
    alerts.push(
      item.originalStatus
        ? `Status Nomus não mapeado: ${item.originalStatus}`
        : "Status do item não informado"
    );
  }
  if (item.hasCut) alerts.push("Item com corte de quantidade");
  if (item.isCancelled) alerts.push("Item cancelado");
  if (item.isReturned) alerts.push("Item com devolução");
  return alerts;
}

export function enrichIntelligenceItems(input: {
  items: EnrichedLifecycleItem[];
  dbItems: Array<{
    id: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    productId?: string | null;
    unit?: string | null;
  }>;
  nomusRawResponse: unknown;
}) {
  const rawItems = extractNomusRawItems(input.nomusRawResponse);

  return input.items.map((item, index) => {
    const dbItem = input.dbItems[index];
    const matchOptions = {
      itemIndex: index,
      totalDbItems: input.dbItems.length,
    };
    const db = dbItem ?? {
      externalProductId: undefined as number | null | undefined,
      skuSnapshot: item.productCode,
      productNameSnapshot: item.productName,
    };
    const raw = matchRawItemToDbItem(rawItems, db, matchOptions);
    const rawMatchedBy = resolveRawItemMatchType(rawItems, db, matchOptions);
    const statusSource = resolveItemStatusSource(raw, rawMatchedBy);
    const statusRaw = item.originalStatus;
    const statusLabel = formatNomusStatusLabel(statusRaw) ?? "Não informado";

    const rawItem = raw?.raw ?? null;
    const itemNumber =
      raw?.item != null
        ? String(raw.item)
        : rawItem
          ? asString(extractSalesOrderItemRawField(rawItem, "itemNumber"))
          : null;

    const quantityCancelled = raw?.quantidadeCancelada ?? null;
    const quantityReturned = raw?.quantidadeDevolvida ?? null;

    return {
      ...item,
      itemNumber,
      externalItemId: raw?.item ?? null,
      productId: dbItem?.productId ?? null,
      externalProductId: dbItem?.externalProductId ?? raw?.idProduto ?? null,
      sku: item.productCode,
      description: item.productName,
      quantityOrdered: item.orderedQuantity,
      quantityFulfilled: item.fulfilledQuantity,
      quantityInvoiced: item.invoicedQuantity,
      quantityCancelled,
      quantityReturned,
      statusRaw,
      statusLabel,
      statusNormalized: item.normalizedStatus,
      statusSource,
      rawMatchedBy,
      alerts: buildItemAlerts(item),
      rawSummary: buildItemRawSummary(raw),
    };
  });
}

export function buildAuditMeta(input: {
  nomusRawResponse: unknown;
  lifecycle: SalesOrderLifecycleSummary;
  productionWarnings: string[];
  dataQualityWarnings: string[];
}): SalesOrderIntelligenceAuditMeta {
  const sourcesUsed = ["SalesOrder", "SalesOrderItem"];
  const missingData: string[] = [];
  const warnings = [...input.dataQualityWarnings, ...input.productionWarnings];

  const root = asObject(input.nomusRawResponse);
  if (root) {
    sourcesUsed.push("nomusRawResponse");
    if (!Array.isArray(root.nfes) || root.nfes.length === 0) {
      if (!input.lifecycle.hasInvoice) {
        missingData.push("nota_fiscal");
      }
    }
    if (extractNomusProductionOrders(input.nomusRawResponse).length === 0) {
      missingData.push("ordem_producao");
    }
  } else {
    missingData.push("nomus_raw_response");
    warnings.push("nomusRawResponse ausente — dados crus da integração indisponíveis.");
  }

  if (!input.lifecycle.expectedDeliveryDate) {
    missingData.push("previsao_entrega");
  }

  return {
    generatedAt: new Date().toISOString(),
    sourcesUsed: [...new Set(sourcesUsed)],
    missingData,
    warnings: [...new Set(warnings)],
  };
}

export function buildOrderAuditFields(input: {
  statusIndusCost: string;
  externalSalesOrderId?: number | null;
  externalSalesOrderCode?: string | null;
  nomusRawResponse?: unknown;
  lifecycle: SalesOrderLifecycleSummary;
}) {
  const statusNomusRaw = extractNomusHeaderStatusRaw(input.nomusRawResponse);
  const statusNomusLabel =
    formatNomusStatusLabel(statusNomusRaw) ??
    (statusNomusRaw == null ? "Não localizado na integração" : String(statusNomusRaw));

  return {
    orderCode: input.lifecycle.salesOrderNumber,
    externalSalesOrderId: input.externalSalesOrderId ?? null,
    externalSalesOrderCode: input.externalSalesOrderCode ?? null,
    statusIndusCost: input.statusIndusCost,
    statusNomusRaw,
    statusNomusLabel,
  };
}

export function formatItemStatusSourceLabel(source: SalesOrderItemStatusSource): string {
  const labels: Record<SalesOrderItemStatusSource, string> = {
    db: "IndusCost (DB)",
    item_raw: "Nomus (item raw)",
    order_raw: "Nomus (pedido raw)",
    inferred: "Inferido",
    unknown: "Desconhecido",
  };
  return labels[source];
}

export function formatRawMatchedByLabel(match: RawItemMatchType): string {
  const labels: Record<RawItemMatchType, string> = {
    external_id: "ID externo do produto",
    product_id: "ID do produto",
    sku: "SKU / código",
    item_number: "Número sequencial do item",
    description: "Descrição do produto",
    single_item_fallback: "Único item no raw",
    none: "Não vinculado",
  };
  return labels[match];
}

export function isAuditPayloadSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
    return true;
  } catch {
    return false;
  }
}
