/**
 * Client HTTP — listagem de Ordens de Produção (somente IndusCost API).
 * Nunca chama a API Nomus.
 */
import { fetchJsonOk } from "@/src/lib/http";
import type {
  ProductionOrderGridRow,
  ProductionOrdersListResponse,
} from "@/src/lib/productionOrdersList.js";

export type ProductionOrdersListClientQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string | null;
  tipo?: string | null;
  company?: string | null;
  from?: string | null;
  to?: string | null;
};

export type { ProductionOrderGridRow, ProductionOrdersListResponse };

export const PRODUCTION_ORDERS_LIST_API_PATH = "/api/operations/production-orders";

export function buildProductionOrdersListQueryString(
  query: ProductionOrdersListClientQuery = {}
): string {
  const params = new URLSearchParams();
  if (query.page != null) params.set("page", String(query.page));
  if (query.pageSize != null) params.set("pageSize", String(query.pageSize));
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.status?.trim()) params.set("status", query.status.trim());
  if (query.tipo?.trim()) params.set("tipo", query.tipo.trim());
  if (query.company?.trim()) params.set("company", query.company.trim());
  if (query.from?.trim()) params.set("from", query.from.trim());
  if (query.to?.trim()) params.set("to", query.to.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchProductionOrdersList(
  query: ProductionOrdersListClientQuery = {}
): Promise<ProductionOrdersListResponse> {
  return fetchJsonOk<ProductionOrdersListResponse>(
    `${PRODUCTION_ORDERS_LIST_API_PATH}${buildProductionOrdersListQueryString(query)}`
  );
}
