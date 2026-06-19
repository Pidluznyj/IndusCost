import type { SalesOrderItemNomusStatus } from "./salesOrderLifecycleTypes.js";

export type NomusRawItem = {
  item?: number | string | null;
  idProduto?: number | null;
  codigoProduto?: string | null;
  status?: string | null;
  quantidade?: number | null;
  quantidadeAtendida?: number | null;
  quantidadeFaturada?: number | null;
  quantidadeCancelada?: number | null;
  quantidadeDevolvida?: number | null;
  quantidadeEnviada?: number | null;
  quantidadeEntregue?: number | null;
  dataEntrega?: string | null;
  raw: Record<string, unknown>;
};

export type NomusRawNfe = {
  numero: string | null;
  serie: string | null;
  status: string | null;
  dataProcessamento: string | null;
  dataEmissao: string | null;
  valor: number | null;
};

export type NomusRawProductionOrder = {
  id?: string;
  number?: string;
  productCode?: string;
  productName?: string;
  status?: string;
  plannedQuantity?: number | null;
  producedQuantity?: number | null;
  openedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  dueDate?: string | null;
  raw: Record<string, unknown>;
};

const PRODUCTION_ORDER_KEYS = [
  "ordensProducao",
  "ordensProducaoPedido",
  "ordemProducao",
  "ordensDeProducao",
  "productionOrders",
  "ops",
  "op",
] as const;

const SALES_ORDER_RAW_FIELD_ALIASES: Record<string, readonly string[]> = {
  status: ["status", "situacao", "situacaoPedido"],
  issueDate: ["dataEmissao", "issueDate", "dtEmissao"],
  expectedDeliveryDate: [
    "dataPrevisaoEntrega",
    "dataEntregaPrevista",
    "previsaoEntrega",
    "expectedDeliveryDate",
  ],
  deliveryDate: ["dataEntrega", "deliveryDate", "dtEntrega"],
  releaseDate: ["dataLiberacao", "dtLiberacao"],
  invoiceDate: ["dataFaturamento", "dataProcessamento", "dataEmissaoNf"],
  fulfillmentDate: ["dataAtendimento", "dataAtendimentoPedido"],
};

const SALES_ORDER_ITEM_RAW_FIELD_ALIASES: Record<string, readonly string[]> = {
  status: [
    "status",
    "situacao",
    "situacaoItem",
    "statusItem",
    "descricaoStatus",
    "descricaoStatusItem",
    "descricao_status",
    "descricaoSituacao",
    "descricaoSituacaoItem",
    "situacaoPedidoItem",
    "situacaoItemPedido",
    "statusPedidoItem",
    "statusDescricao",
    "nomeStatus",
    "statusNome",
  ],
  quantity: [
    "quantidade",
    "qtdPedida",
    "quantidadePedida",
    "qtdePedida",
    "qtd_pedida",
    "quantidade_pedida",
  ],
  quantityFulfilled: ["quantidadeAtendida", "qtdAtendida", "quantidadeAtendimento"],
  quantityInvoiced: ["quantidadeFaturada", "qtdFaturada", "quantidadeNF"],
  quantityCanceled: [
    "quantidadeCancelada",
    "qtdCancelada",
    "qtdeCancelada",
    "quantidade_cancelada",
    "qtde_cancelada",
    "qtd_cancelada",
  ],
  quantityReturned: ["quantidadeDevolvida", "qtdDevolvida"],
  quantityShipped: ["quantidadeEnviada", "qtdEnviada"],
  quantityDelivered: ["quantidadeEntregue", "qtdEntregue"],
  expectedDeliveryDate: ["dataEntrega", "dataEntregaItem", "dataPrevisaoEntrega"],
  productCode: [
    "codigoProduto",
    "codigo",
    "sku",
    "codigo_produto",
    "productCode",
  ],
  productName: ["nomeProduto", "descricaoProduto", "produto", "descricao"],
  itemNumber: ["item", "numeroItem", "sequencia", "idItemPedido", "numero"],
};

const NOMUS_ITEM_ARRAY_KEYS = [
  "itensPedido",
  "itens",
  "items",
  "pedidoItens",
  "itensDoPedido",
] as const;

const NOMUS_NESTED_LABEL_KEYS = [
  "descricao",
  "nome",
  "label",
  "titulo",
  "texto",
  "status",
  "nomeStatus",
  "statusNome",
  "descricaoStatus",
] as const;

const ORDERED_QTY_KEYS = [
  "quantidade",
  "qtdPedida",
  "quantidadePedida",
  "qtdePedida",
  "qtd_pedida",
  "quantidade_pedida",
];

const CANCELLED_QTY_KEYS = [
  "quantidadeCancelada",
  "qtdCancelada",
  "qtdeCancelada",
  "quantidade_cancelada",
  "qtde_cancelada",
  "qtd_cancelada",
];

function readFirstRawValue(
  obj: Record<string, unknown>,
  aliases: readonly string[]
): unknown {
  for (const key of aliases) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

/** Extrai campo do pedido no nomusRawResponse com aliases seguros. */
export function extractSalesOrderRawField(
  nomusRawResponse: unknown,
  field: keyof typeof SALES_ORDER_RAW_FIELD_ALIASES | string
): unknown {
  const root = asObject(nomusRawResponse);
  if (!root) return undefined;
  const aliases =
    SALES_ORDER_RAW_FIELD_ALIASES[field] ??
    (typeof field === "string" ? [field] : []);
  return readFirstRawValue(root, aliases);
}

/** Extrai campo de um item em itensPedido[] com aliases seguros. */
export function extractSalesOrderItemRawField(
  rawItem: unknown,
  field: keyof typeof SALES_ORDER_ITEM_RAW_FIELD_ALIASES | string
): unknown {
  const obj = asObject(rawItem);
  if (!obj) return undefined;
  const aliases =
    SALES_ORDER_ITEM_RAW_FIELD_ALIASES[field] ??
    (typeof field === "string" ? [field] : []);
  return readFirstRawValue(obj, aliases);
}

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

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Converte DD/MM/YYYY ou ISO para Date local (meio-dia para evitar drift). */
export function parseNomusBrOrIsoDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const year = Number(br[3]);
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const isoOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const d = new Date(isoOnly ? `${trimmed}T12:00:00.000Z` : trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

export function diffCalendarDays(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function readQuantity(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = asNumber(obj[key]);
    if (n != null) return n;
  }
  return null;
}

/** Converte string, número ou objeto Nomus ({ descricao, nome }) em texto. */
export function coerceNomusTextValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const obj = asObject(value);
  if (!obj) return null;
  for (const key of NOMUS_NESTED_LABEL_KEYS) {
    const nested = coerceNomusTextValue(obj[key]);
    if (nested) return nested;
  }
  return null;
}

function normalizeProductCode(value: string | null | undefined): string | null {
  const s = value?.trim().toLowerCase();
  return s || null;
}

function extractItemProductCode(raw: Record<string, unknown>): string | null {
  const direct = coerceNomusTextValue(extractSalesOrderItemRawField(raw, "productCode"));
  if (direct) return direct;
  const produto = asObject(raw.produto);
  if (produto) {
    return (
      coerceNomusTextValue(produto.codigo) ??
      coerceNomusTextValue(produto.codigoProduto) ??
      coerceNomusTextValue(produto.sku) ??
      null
    );
  }
  return null;
}

function extractItemIdProduto(raw: Record<string, unknown>): number | null {
  const direct = asNumber(raw.idProduto);
  if (direct != null) return direct;
  const produto = asObject(raw.produto);
  if (!produto) return null;
  return asNumber(produto.id) ?? asNumber(produto.idProduto);
}

function extractItemNumber(raw: Record<string, unknown>): number | string | null {
  const fromAliases = coerceNomusTextValue(extractSalesOrderItemRawField(raw, "itemNumber"));
  if (fromAliases) {
    const asNum = asNumber(fromAliases);
    return asNum ?? fromAliases;
  }
  return asNumber(raw.item) ?? asString(raw.item);
}

export function isSalesOrderItemCancelledByRawQuantity(
  rawItem: unknown
): boolean {
  const obj = asObject(rawItem);
  if (!obj) return false;
  const ordered = readQuantity(obj, ORDERED_QTY_KEYS);
  const cancelled = readQuantity(obj, CANCELLED_QTY_KEYS);
  return ordered != null && cancelled != null && ordered > 0 && cancelled >= ordered;
}

export function deepExtractNomusItemStatus(raw: Record<string, unknown>): string | null {
  for (const alias of SALES_ORDER_ITEM_RAW_FIELD_ALIASES.status) {
    const text = coerceNomusTextValue(raw[alias]);
    if (text) return text;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (/status|situac/i.test(key)) {
      const text = coerceNomusTextValue(value);
      if (text) return text;
    }
  }
  if (isSalesOrderItemCancelledByRawQuantity(raw)) return "Cancelado";
  return null;
}

export function extractNomusItemStatusFromItemRaw(rawItem: unknown): string | null {
  const obj = asObject(rawItem);
  if (!obj) return null;
  return deepExtractNomusItemStatus(obj);
}

export function extractNomusItemStatusFromOrderRaw(
  orderRaw: unknown,
  dbItem: {
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
  },
  options?: { itemIndex?: number; totalDbItems?: number }
): string | null {
  const rawItems = extractNomusRawItems(orderRaw);
  const matched = matchRawItemToDbItem(rawItems, dbItem, options);
  if (!matched) return null;
  return matched.status ?? deepExtractNomusItemStatus(matched.raw);
}

export function resolveSalesOrderItemNomusStatus(
  orderRaw: unknown,
  dbItem: {
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
  },
  options?: { itemIndex?: number; totalDbItems?: number }
): SalesOrderItemNomusStatus {
  const statusText = extractNomusItemStatusFromOrderRaw(orderRaw, dbItem, options);
  return normalizeSalesOrderItemNomusStatus(statusText);
}

function inferCancelledStatusFromQuantities(raw: Record<string, unknown>): string | null {
  if (isSalesOrderItemCancelledByRawQuantity(raw)) return "Cancelado";
  return null;
}

function mapRawItem(raw: Record<string, unknown>): NomusRawItem {
  const status = deepExtractNomusItemStatus(raw);
  return {
    item: extractItemNumber(raw),
    idProduto: extractItemIdProduto(raw),
    codigoProduto: extractItemProductCode(raw),
    status,
    quantidade: readQuantity(raw, ORDERED_QTY_KEYS),
    quantidadeAtendida: readQuantity(raw, [
      "quantidadeAtendida",
      "qtdAtendida",
      "quantidadeAtendimento",
    ]),
    quantidadeFaturada: readQuantity(raw, [
      "quantidadeFaturada",
      "qtdFaturada",
      "quantidadeNF",
    ]),
    quantidadeCancelada: readQuantity(raw, CANCELLED_QTY_KEYS),
    quantidadeDevolvida: readQuantity(raw, ["quantidadeDevolvida", "qtdDevolvida"]),
    quantidadeEnviada: readQuantity(raw, ["quantidadeEnviada", "qtdEnviada"]),
    quantidadeEntregue: readQuantity(raw, ["quantidadeEntregue", "qtdEntregue"]),
    dataEntrega: asString(raw.dataEntrega) ?? asString(raw.dataEntregaItem),
    raw,
  };
}

export function extractNomusRawItems(nomusRawResponse: unknown): NomusRawItem[] {
  const root = asObject(nomusRawResponse);
  if (!root) return [];
  for (const key of NOMUS_ITEM_ARRAY_KEYS) {
    const items = root[key];
    if (!Array.isArray(items)) continue;
    const mapped = items
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => item != null)
      .map(mapRawItem);
    if (mapped.length > 0) return mapped;
  }
  return [];
}

export function extractNomusRawNfes(nomusRawResponse: unknown): NomusRawNfe[] {
  const root = asObject(nomusRawResponse);
  if (!root || !Array.isArray(root.nfes)) return [];
  const out: NomusRawNfe[] = [];
  for (const nfe of root.nfes) {
    const obj = asObject(nfe);
    if (!obj) continue;
    out.push({
      numero:
        asString(obj.numero) ??
        asString(obj.nNF) ??
        (obj.numero != null ? String(obj.numero) : null),
      serie: asString(obj.serie) ?? (obj.serie != null ? String(obj.serie) : null),
      status: asString(obj.status),
      dataProcessamento: asString(obj.dataProcessamento),
      dataEmissao:
        asString(obj.dataEmissao) ??
        asString(obj.dhEmi) ??
        asString(obj.xmlDhEmi),
      valor: readQuantity(obj, ["valor", "valorTotal", "xmlVNF", "vNF"]),
    });
  }
  return out;
}

function mapProductionOrder(raw: Record<string, unknown>): NomusRawProductionOrder {
  return {
    id:
      asString(raw.id) ??
      asString(raw.idOP) ??
      asString(raw.idOrdemProducao) ??
      (raw.id != null ? String(raw.id) : undefined),
    number:
      asString(raw.numero) ??
      asString(raw.numeroOP) ??
      asString(raw.codigoOP) ??
      asString(raw.codigo),
    productCode: asString(raw.codigoProduto) ?? asString(raw.idProduto),
    productName: asString(raw.nomeProduto) ?? asString(raw.descricaoProduto),
    status: asString(raw.status) ?? asString(raw.situacao),
    plannedQuantity: readQuantity(raw, [
      "quantidadePlanejada",
      "qtdPlanejada",
      "quantidade",
    ]),
    producedQuantity: readQuantity(raw, [
      "quantidadeProduzida",
      "qtdProduzida",
      "quantidadeRealizada",
    ]),
    openedAt:
      asString(raw.dataAbertura) ??
      asString(raw.dataCriacao) ??
      asString(raw.abertura),
    startedAt: asString(raw.dataInicio) ?? asString(raw.inicioProducao),
    finishedAt: asString(raw.dataFim) ?? asString(raw.dataFinalizacao),
    dueDate: asString(raw.dataPrazo) ?? asString(raw.prazo) ?? asString(raw.dataEntrega),
    raw,
  };
}

function collectProductionArrays(root: Record<string, unknown>): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const key of PRODUCTION_ORDER_KEYS) {
    const value = root[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        const obj = asObject(entry);
        if (obj) found.push(obj);
      }
    } else {
      const obj = asObject(value);
      if (obj) found.push(obj);
    }
  }
  return found;
}

export function extractNomusProductionOrders(
  nomusRawResponse: unknown
): NomusRawProductionOrder[] {
  const root = asObject(nomusRawResponse);
  if (!root) return [];
  const arrays = collectProductionArrays(root);
  const seen = new Set<string>();
  const out: NomusRawProductionOrder[] = [];
  for (const raw of arrays) {
    const mapped = mapProductionOrder(raw);
    const key = `${mapped.id ?? ""}|${mapped.number ?? ""}|${mapped.productCode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

const ITEM_STATUS_RULES: Array<{ match: RegExp; status: SalesOrderItemNomusStatus }> = [
  { match: /aguardando\s*liberac/, status: "awaiting_release" },
  { match: /^liberad/, status: "released" },
  { match: /atendido\s*com\s*corte/, status: "fulfilled_with_cut" },
  { match: /atendido\s*parcial/, status: "partially_fulfilled" },
  { match: /atendido\s*total/, status: "fully_fulfilled" },
  { match: /^cancelad/, status: "cancelled" },
  { match: /devolvido\s*parcial/, status: "partially_returned" },
  { match: /devolvido\s*total/, status: "fully_returned" },
  { match: /^devolv/, status: "partially_returned" },
  { match: /^enviad/, status: "shipped" },
  { match: /^entreg/, status: "delivered" },
];

export function normalizeSalesOrderItemNomusStatus(
  originalStatus: string | null | undefined
): SalesOrderItemNomusStatus {
  if (!originalStatus?.trim()) return "unknown";
  const norm = normalizeText(originalStatus);
  for (const rule of ITEM_STATUS_RULES) {
    if (rule.match.test(norm)) return rule.status;
  }
  return "unknown";
}

/** Alias público solicitado pelo contrato de lifecycle. */
export const normalizeSalesOrderItemStatus = normalizeSalesOrderItemNomusStatus;
export function matchRawItemToDbItem(
  rawItems: NomusRawItem[],
  dbItem: {
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
  },
  options?: { itemIndex?: number; totalDbItems?: number }
): NomusRawItem | null {
  if (rawItems.length === 0) return null;

  const matchesExternalId = (r: NomusRawItem): boolean => {
    if (dbItem.externalProductId == null) return false;
    if (r.idProduto === dbItem.externalProductId) return true;
    const nestedId = asNumber(asObject(r.raw.produto)?.id);
    const nestedProductId = asNumber(asObject(r.raw.produto)?.idProduto);
    return nestedId === dbItem.externalProductId || nestedProductId === dbItem.externalProductId;
  };

  if (dbItem.externalProductId != null) {
    const byProduct = rawItems.find(matchesExternalId);
    if (byProduct) return byProduct;
  }

  const sku = normalizeProductCode(dbItem.skuSnapshot);
  if (sku) {
    const bySku = rawItems.find(
      (r) => normalizeProductCode(r.codigoProduto) === sku
    );
    if (bySku) return bySku;
  }

  const name = dbItem.productNameSnapshot?.trim().toLowerCase();
  if (name) {
    const byName = rawItems.find((r) => {
      const rawName =
        coerceNomusTextValue(r.raw.nomeProduto) ??
        coerceNomusTextValue(r.raw.descricaoProduto) ??
        coerceNomusTextValue(asObject(r.raw.produto)?.descricao) ??
        coerceNomusTextValue(asObject(r.raw.produto)?.nome);
      return rawName?.trim().toLowerCase() === name;
    });
    if (byName) return byName;
  }

  if (
    options?.itemIndex != null &&
    options.totalDbItems != null &&
    options.totalDbItems === rawItems.length
  ) {
    return rawItems[options.itemIndex] ?? null;
  }

  if (rawItems.length === 1 && options?.totalDbItems === 1) {
    return rawItems[0];
  }

  if (rawItems.length === 1) return rawItems[0];

  return null;
}

export function resolveItemFulfilledQuantity(
  ordered: number,
  raw: NomusRawItem | null,
  normalizedStatus: SalesOrderItemNomusStatus
): number | null {
  if (raw?.quantidadeAtendida != null) return Math.max(0, raw.quantidadeAtendida);
  if (raw?.quantidadeEntregue != null) return Math.max(0, raw.quantidadeEntregue);
  if (raw?.quantidadeEnviada != null) return Math.max(0, raw.quantidadeEnviada);
  if (
    normalizedStatus === "fully_fulfilled" ||
    normalizedStatus === "delivered" ||
    normalizedStatus === "shipped"
  ) {
    return ordered;
  }
  if (
    normalizedStatus === "partially_fulfilled" ||
    normalizedStatus === "fulfilled_with_cut" ||
    normalizedStatus === "partially_returned"
  ) {
    return null;
  }
  if (normalizedStatus === "cancelled") return 0;
  return null;
}

export function resolveItemInvoicedQuantity(
  ordered: number,
  fulfilled: number | null,
  raw: NomusRawItem | null,
  hasOrderInvoice: boolean
): number | null {
  if (raw?.quantidadeFaturada != null) return Math.max(0, raw.quantidadeFaturada);
  if (!hasOrderInvoice) return 0;
  if (fulfilled != null) return fulfilled;
  return hasOrderInvoice ? ordered : 0;
}

export function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const result = (numerator / denominator) * 100;
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
}
