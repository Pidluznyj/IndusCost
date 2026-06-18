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

function mapRawItem(raw: Record<string, unknown>): NomusRawItem {
  return {
    item: asNumber(raw.item) ?? asString(raw.item),
    idProduto: asNumber(raw.idProduto),
    codigoProduto: asString(raw.codigoProduto) ?? asString(raw.codigo),
    status: asString(raw.status) ?? asString(raw.situacao) ?? asString(raw.statusItem),
    quantidade: readQuantity(raw, ["quantidade", "qtdPedida", "quantidadePedida"]),
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
    quantidadeCancelada: readQuantity(raw, ["quantidadeCancelada", "qtdCancelada"]),
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
  const items = root.itensPedido;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => item != null)
    .map(mapRawItem);
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

export function matchRawItemToDbItem(
  rawItems: NomusRawItem[],
  dbItem: {
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
  }
): NomusRawItem | null {
  if (rawItems.length === 0) return null;
  if (dbItem.externalProductId != null) {
    const byProduct = rawItems.find((r) => r.idProduto === dbItem.externalProductId);
    if (byProduct) return byProduct;
  }
  const sku = dbItem.skuSnapshot?.trim().toLowerCase();
  if (sku) {
    const bySku = rawItems.find(
      (r) => r.codigoProduto?.trim().toLowerCase() === sku
    );
    if (bySku) return bySku;
  }
  const name = dbItem.productNameSnapshot?.trim().toLowerCase();
  if (name) {
    const byName = rawItems.find(
      (r) =>
        asString(r.raw.nomeProduto)?.trim().toLowerCase() === name ||
        asString(r.raw.descricaoProduto)?.trim().toLowerCase() === name
    );
    if (byName) return byName;
  }
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
