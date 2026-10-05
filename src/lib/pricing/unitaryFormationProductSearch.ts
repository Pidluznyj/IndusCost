/**
 * Busca read-only de produtos/componentes para a aba Formação de Preço Unitária.
 * Sem custo, sem preço, sem publicação.
 */

export const UNITARY_FORMATION_PRODUCT_SEARCH_ENDPOINT =
  "/api/pricing/unitary-formation/product-search";

export const UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS = 2;
export const UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT = 20;
export const UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT = 20;
export const UNITARY_FORMATION_PRODUCT_SEARCH_MAX_QUERY_LEN = 80;
/** Candidatos brutos antes do ranking em memória (evita perder SKU exato no slice do DB). */
export const UNITARY_FORMATION_PRODUCT_SEARCH_CANDIDATE_CAP = 100;

export const UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS = 280;

export type UnitaryFormationProductMatchKind =
  | "SKU_EXACT"
  | "SKU_PREFIX"
  | "NAME_CONTAINS";

export type UnitaryFormationProductSearchResult = {
  productId: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string | null;
  matchKind: UnitaryFormationProductMatchKind;
};

export type UnitaryFormationProductSearchResponse = {
  query: string;
  limit: number;
  count: number;
  results: UnitaryFormationProductSearchResult[];
};

export type UnitaryFormationProductSearchQuery = {
  q: string;
  limit: number;
};

export type UnitaryFormationProductSearchParseError = {
  code: "QUERY_TOO_SHORT";
  message: string;
};

export function parseUnitaryFormationProductSearchQuery(
  query: Record<string, unknown>
): UnitaryFormationProductSearchQuery | UnitaryFormationProductSearchParseError {
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q;
  const q =
    typeof rawQ === "string"
      ? rawQ.replace(/\s+/g, " ").trim().slice(0, UNITARY_FORMATION_PRODUCT_SEARCH_MAX_QUERY_LEN)
      : "";
  if (q.length < UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS) {
    return {
      code: "QUERY_TOO_SHORT",
      message: "Informe ao menos 2 caracteres.",
    };
  }

  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const parsedLimit = Number(rawLimit);
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT)
      : UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT;

  return { q, limit };
}

export function isUnitaryFormationProductSearchParseError(
  value: UnitaryFormationProductSearchQuery | UnitaryFormationProductSearchParseError
): value is UnitaryFormationProductSearchParseError {
  return "code" in value;
}

/** Filtro de elegibilidade: PRODUCT/COMPONENT ativos (status null legado = ativo). */
export function buildUnitaryFormationProductSearchWhere(q: string): {
  AND: Array<Record<string, unknown>>;
} {
  return {
    AND: [
      { type: { in: ["PRODUCT", "COMPONENT"] } },
      { OR: [{ status: "ACTIVE" }, { status: null }] },
      {
        OR: [
          { sku: { equals: q, mode: "insensitive" } },
          { sku: { startsWith: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
    ],
  };
}

export function resolveUnitaryFormationProductMatchKind(
  sku: string,
  name: string,
  q: string
): UnitaryFormationProductMatchKind | null {
  const term = q.trim().toLocaleLowerCase("pt-BR");
  if (!term) return null;
  const skuNorm = String(sku ?? "").toLocaleLowerCase("pt-BR");
  const nameNorm = String(name ?? "").toLocaleLowerCase("pt-BR");
  if (skuNorm === term) return "SKU_EXACT";
  if (skuNorm.startsWith(term)) return "SKU_PREFIX";
  if (nameNorm.includes(term)) return "NAME_CONTAINS";
  return null;
}

function matchRank(kind: UnitaryFormationProductMatchKind): number {
  if (kind === "SKU_EXACT") return 0;
  if (kind === "SKU_PREFIX") return 1;
  return 2;
}

export function rankUnitaryFormationProductSearchResults(
  rows: Array<{
    id: string;
    sku: string;
    name: string;
    type: "PRODUCT" | "COMPONENT";
    status: string | null;
  }>,
  q: string,
  limit: number = UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT
): UnitaryFormationProductSearchResult[] {
  const ranked: UnitaryFormationProductSearchResult[] = [];
  for (const row of rows) {
    const matchKind = resolveUnitaryFormationProductMatchKind(row.sku, row.name, q);
    if (!matchKind) continue;
    ranked.push({
      productId: row.id,
      sku: row.sku,
      name: row.name,
      type: row.type,
      status: row.status,
      matchKind,
    });
  }

  ranked.sort((a, b) => {
    const rankDiff = matchRank(a.matchKind) - matchRank(b.matchKind);
    if (rankDiff !== 0) return rankDiff;
    const skuDiff = a.sku.localeCompare(b.sku, "pt-BR", { sensitivity: "base" });
    if (skuDiff !== 0) return skuDiff;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });

  const capped = Math.min(Math.max(limit, 1), UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT);
  return ranked.slice(0, capped);
}

export function buildUnitaryFormationProductSearchResponse(
  q: string,
  limit: number,
  results: UnitaryFormationProductSearchResult[]
): UnitaryFormationProductSearchResponse {
  return {
    query: q,
    limit,
    count: results.length,
    results,
  };
}

export function buildUnitaryFormationProductSearchUrl(
  q: string,
  limit: number = UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT
): string {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(limit));
  return `${UNITARY_FORMATION_PRODUCT_SEARCH_ENDPOINT}?${params.toString()}`;
}
