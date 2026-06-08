import type { Prisma } from "@prisma/client";

export const CUSTOMER_LIST_DEFAULT_LIMIT = 20;
export const CUSTOMER_LIST_MAX_LIMIT = 100;

export type CustomerListQuery = {
  page: number;
  limit: number;
  skip: number;
  search: string;
};

export type CustomerListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function parseCustomerListPage(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function parseCustomerListLimit(
  raw: unknown,
  fallback = CUSTOMER_LIST_DEFAULT_LIMIT
): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), CUSTOMER_LIST_MAX_LIMIT);
}

export function parseCustomerListQuery(query: Record<string, unknown>): CustomerListQuery {
  const page = parseCustomerListPage(query.page);
  const limit = parseCustomerListLimit(query.limit);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    search: String(query.search ?? "").trim(),
  };
}

export function customerListMeta(total: number, page: number, limit: number): CustomerListMeta {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return { page, limit, total, totalPages };
}

export function buildCustomerListResponse<T>(items: T[], meta: CustomerListMeta) {
  return {
    customers: items,
    items,
    page: meta.page,
    limit: meta.limit,
    total: meta.total,
    totalPages: meta.totalPages,
  };
}

/** Paginação ativa quando há parâmetros de listagem; sem params mantém resposta legada (array). */
export function shouldUseCustomerPagination(query: Record<string, unknown>): boolean {
  return (
    query.page != null ||
    query.limit != null ||
    query.search != null ||
    String(query.paginated ?? "").trim() === "true"
  );
}

export function formatCustomerListRange(meta: CustomerListMeta): string {
  if (meta.total <= 0) return "Nenhum cliente encontrado";
  const start = (meta.page - 1) * meta.limit + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);
  return `Mostrando ${start}–${end} de ${meta.total} clientes`;
}

export function buildCustomerSearchWhere(search: string): Prisma.CustomerWhereInput | undefined {
  const searchRaw = search.trim();
  if (!searchRaw) return undefined;

  const digits = searchRaw.replace(/\D/g, "");
  const ors: Prisma.CustomerWhereInput[] = [
    { companyName: { contains: searchRaw, mode: "insensitive" } },
    { tradeName: { contains: searchRaw, mode: "insensitive" } },
    { taxId: { contains: searchRaw, mode: "insensitive" } },
  ];

  if (digits.length >= 2 && digits !== searchRaw) {
    ors.push({ taxId: { contains: digits, mode: "insensitive" } });
  }

  return { OR: ors };
}
