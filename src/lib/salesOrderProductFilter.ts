/**
 * Filtro de produto da tela Resultado de Pedidos de Venda — parte PURA
 * (frontend-safe: só `import type` do Prisma).
 *
 * Semântica (mesma do motor do Resultado): pedidos que CONTÊM o produto
 * (`SalesOrderItem.productId`). As opções do dropdown vêm só de produtos que já
 * aparecem em itens de pedido de venda, buscando por SKU ou nome.
 */
import type { Prisma } from "@prisma/client";

export const SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH = "/api/sales-orders/product-filter-options";
export const SALES_ORDER_PRODUCT_FILTER_MIN_CHARS = 2;
export const SALES_ORDER_PRODUCT_FILTER_DEFAULT_LIMIT = 20;
export const SALES_ORDER_PRODUCT_FILTER_MAX_LIMIT = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SalesOrderProductFilterOption = {
  productId: string;
  sku: string;
  name: string;
};

/** UUID válido do produto ou null (vazio/ inválido). */
export function normalizeSalesOrderProductFilterId(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Restrição Prisma do filtro de produto. Sem valor → null (sem filtro).
 * Valor inválido → nenhum pedido (nunca ignora o filtro em silêncio).
 */
export function buildSalesOrderProductFilterWhere(value: unknown): Prisma.SalesOrderWhereInput | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const productId = normalizeSalesOrderProductFilterId(raw);
  if (!productId) return { id: { in: [] } };
  return { items: { some: { productId } } };
}

export type SalesOrderProductFilterSearch = { term: string; limit: number };

/** Termo (mín. 2 caracteres) + limite (1–50, default 20); null quando não há busca. */
export function parseSalesOrderProductFilterSearch(
  query: Record<string, unknown>
): SalesOrderProductFilterSearch | null {
  const rawTerm = Array.isArray(query.q) ? query.q[0] : query.q;
  const term = typeof rawTerm === "string" ? rawTerm.replace(/\s+/g, " ").trim() : "";
  if (term.length < SALES_ORDER_PRODUCT_FILTER_MIN_CHARS) return null;
  const rawLimit = Number(Array.isArray(query.limit) ? query.limit[0] : query.limit);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, SALES_ORDER_PRODUCT_FILTER_MAX_LIMIT)
      : SALES_ORDER_PRODUCT_FILTER_DEFAULT_LIMIT;
  return { term: term.slice(0, 80), limit };
}

/** Produtos que aparecem em itens de pedido de venda, por SKU ou nome (sem diferenciar caixa). */
export function buildSalesOrderProductFilterSearchWhere(term: string): Prisma.ProductWhereInput {
  return {
    SalesOrderItem: { some: {} },
    OR: [
      { sku: { contains: term, mode: "insensitive" } },
      { name: { contains: term, mode: "insensitive" } },
    ],
  };
}

export function getSalesOrderProductFilterOptionsUrl(
  term: string,
  limit: number = SALES_ORDER_PRODUCT_FILTER_DEFAULT_LIMIT
): string {
  const params = new URLSearchParams();
  params.set("q", term);
  params.set("limit", String(limit));
  return `${SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH}?${params.toString()}`;
}
