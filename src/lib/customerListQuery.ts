import type { Prisma } from "@prisma/client";
import { normalizeCityKey } from "./commercial/customerActivityMap/customerActivityMap.js";
import {
  parseCustomerCreditListFilter,
  type CustomerCreditListFilter,
} from "./commercial/customerCreditListFilter.js";
import { brazilUfMatchValues, normalizeBrazilUf, parseBrazilUfFilter } from "./customerIndicators.js";

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
  /** Chave de cidade (sem acento e sem caixa), ou vazio (todas). */
  city: string;
  /** Situação oficial de crédito, ou vazio (todas). */
  creditStatus: CustomerCreditListFilter | "";
  /** Recorte do Radar: qualquer vínculo, pendente, confirmado, ou vazio. */
  linkStatus: CustomerLinkListFilter | "";
};

export const CUSTOMER_LINK_LIST_FILTERS = ["any", "pending", "confirmed"] as const;
export type CustomerLinkListFilter = (typeof CUSTOMER_LINK_LIST_FILTERS)[number];

export function parseCustomerLinkListFilter(raw: unknown): CustomerLinkListFilter | "" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CUSTOMER_LINK_LIST_FILTERS as readonly string[]).includes(value) ? (value as CustomerLinkListFilter) : "";
}

const CONFIRMED_LINK_WHERE: Prisma.CustomerWhereInput = {
  OR: [
    { corporateLinks: { some: { closedAt: null, status: { notIn: ["REJECTED", "CLOSED"] } } } },
    { corporateLinksIncoming: { some: { closedAt: null, status: { notIn: ["REJECTED", "CLOSED"] } } } },
  ],
};

const PENDING_LINK_WHERE: Prisma.CustomerWhereInput = {
  OR: [
    { corporateRadarSignals: { some: { status: "OPEN" } } },
    { corporateRadarSignalsIncoming: { some: { status: "OPEN" } } },
  ],
};

/** Vínculo confirmado entra no crédito. Pendente é coincidência ainda não confirmada. */
export function buildCustomerLinkWhere(filter: CustomerLinkListFilter | ""): Prisma.CustomerWhereInput | undefined {
  if (filter === "confirmed") return CONFIRMED_LINK_WHERE;
  if (filter === "pending") return PENDING_LINK_WHERE;
  if (filter === "any") return { OR: [CONFIRMED_LINK_WHERE, PENDING_LINK_WHERE] };
  return undefined;
}

export type CustomerCityOption = {
  key: string;
  label: string;
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
    city: parseCustomerCityFilter(query.city),
    creditStatus: parseCustomerCreditListFilter(query.creditStatus),
    linkStatus: parseCustomerLinkListFilter(query.linkStatus),
  };
}

/** Cidade da grade: mesma chave do mapa (caixa, acento e pontuação não separam). */
export function parseCustomerCityFilter(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  const split = splitCityTrailingUf(text);
  const key = normalizeCityKey(split.uf ? split.city : text);
  if (key.length < 2 || key.length > 80) return "";
  return key;
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
    query.city != null ||
    query.creditStatus != null ||
    query.linkStatus != null ||
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

/** "Curitiba - PR" / "Curitiba/PB" → cidade e UF do sufixo, quando a UF é válida. */
function splitCityTrailingUf(city: string): { city: string; uf: string | null } {
  const match = /^(.*?)[\s]*[-/–(,][\s]*([A-Za-z]{2})\)?\s*$/.exec(city.trim());
  if (!match?.[1]?.trim()) return { city: city.trim(), uf: null };
  const uf = normalizeBrazilUf(match[2]);
  if (uf === "—" || uf === "OUTROS") return { city: city.trim(), uf: null };
  return { city: match[1].trim(), uf };
}

function knownUf(raw: string | null | undefined): string {
  const uf = normalizeBrazilUf(raw);
  return uf === "—" || uf === "OUTROS" ? "" : uf;
}

function preferCityLabel(current: string, candidate: string): string {
  const score = (value: string) => {
    let points = 0;
    if (value !== value.toUpperCase()) points += 2;
    if (/[À-ÿ]/.test(value)) points += 2;
    return points;
  };
  return score(candidate) > score(current) ? candidate : current;
}

export function resolveCustomerCityFilter(
  rows: Array<{ city: string | null; state: string | null }>,
  stateUf: string,
  cityKey: string
): { options: CustomerCityOption[]; cityWhere: Prisma.CustomerWhereInput | undefined } {
  const scopedUf = parseBrazilUfFilter(stateUf);
  const requested = parseCustomerCityFilter(cityKey);
  const grouped = new Map<string, { label: string; raws: string[] }>();

  for (const row of rows) {
    const stored = row.city ?? "";
    const trimmed = stored.trim();
    if (!trimmed) continue;

    let uf = knownUf(row.state);
    const split = splitCityTrailingUf(trimmed);
    let label = trimmed;
    if (uf && split.uf === uf) label = split.city;
    else if (!uf && split.uf) {
      uf = split.uf;
      label = split.city;
    }
    if (scopedUf && uf !== scopedUf) continue;

    const key = normalizeCityKey(label);
    if (key.length < 2 || key.length > 80) continue;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { label, raws: [stored] });
      continue;
    }
    current.label = preferCityLabel(current.label, label);
    if (!current.raws.includes(stored)) current.raws.push(stored);
  }

  const options = [...grouped.entries()]
    .map(([key, value]) => ({ key, label: value.label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  if (!requested) return { options, cityWhere: undefined };
  const match = grouped.get(requested);
  if (!match || match.raws.length === 0) return { options, cityWhere: { id: { in: [] } } };
  return {
    options,
    cityWhere: {
      OR: match.raws.map((value) => ({
        city: { equals: value, mode: "insensitive" as const },
      })),
    },
  };
}

export function buildCustomerListWhere(
  search: string,
  ownerWhere?: Prisma.CustomerWhereInput,
  stateWhere?: Prisma.CustomerWhereInput,
  cityWhere?: Prisma.CustomerWhereInput,
  linkWhere?: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput | undefined {
  const parts = [buildCustomerSearchWhere(search), ownerWhere, stateWhere, cityWhere, linkWhere].filter(
    (part): part is Prisma.CustomerWhereInput => part != null
  );
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}
