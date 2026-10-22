import type { Prisma } from "@prisma/client";
import { brazilUfMatchValues, parseBrazilUfFilter } from "./customerIndicators.js";

export const CUSTOMER_LIST_DEFAULT_LIMIT = 20;
export const CUSTOMER_LIST_MAX_LIMIT = 100;
/** Filtro da grade: clientes sem Responsável Comercial ativo. */
export const CUSTOMER_LIST_OWNER_NONE = "none";

export type CustomerListQuery = {
  page: number;
  limit: number;
  skip: number;
  search: string;
  /** Chave de identidade do responsável, `none`, ou vazio (todos). */
  commercialOwner: string;
  /** Sigla UF, ou vazio (todos os estados). */
  state: string;
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
    commercialOwner: String(query.commercialOwner ?? "").trim(),
    state: parseBrazilUfFilter(query.state),
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
    query.commercialOwner != null ||
    query.state != null ||
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

/** Clientes sem CrmCustomerCommercialOwner ativo. Outras chaves não filtram aqui. */
export function buildCustomerOwnerWhere(ownerKey: string): Prisma.CustomerWhereInput | undefined {
  const key = ownerKey.trim();
  if (key !== CUSTOMER_LIST_OWNER_NONE) return undefined;
  return { NOT: { CrmCustomerCommercialOwner: { is: { isActive: true } } } };
}

/** Cadastro cuja UF normalizada é a sigla pedida (SP, São Paulo, Sao Paulo). */
export function buildCustomerStateWhere(uf: string): Prisma.CustomerWhereInput | undefined {
  const values = brazilUfMatchValues(uf);
  if (values.length === 0) return undefined;
  return {
    OR: values.map((value) => ({
      state: { equals: value, mode: "insensitive" as const },
    })),
  };
}

export function buildCustomerListWhere(
  search: string,
  ownerWhere?: Prisma.CustomerWhereInput,
  stateWhere?: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput | undefined {
  const parts = [buildCustomerSearchWhere(search), ownerWhere, stateWhere].filter(
    (part): part is Prisma.CustomerWhereInput => part != null
  );
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}
