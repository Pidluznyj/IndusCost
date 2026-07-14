/**
 * Consolidação de identidade comercial (vendedor/responsável) para CRM.
 * Base: SalesOrder. Agrupa fragmentos com mesmo nome normalizado exato.
 */
import { Prisma } from "@prisma/client";
import { normalizeSearchString } from "@/src/lib/utils.js";
import { formatSellerDisplayName } from "@/src/lib/adminSellerOptions.js";
import {
  cleanExecutiveCommercialName,
  isSellerIdOnlyLabel,
} from "@/src/lib/commercial/commercialPersonIdentityResolver.js";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

export type SellerRowFragment = {
  externalSellerId: number | null;
  responsible: string | null;
  ordersCount: number;
  /** Chave bruta do agrupamento SQL (id:464, r:nome…). */
  sourceSellerKey: string;
};

export type ConsolidatedSellerOption = {
  displayName: string;
  /** Chave de agrupamento (maiúscula, sem acentos, espaços colapsados). */
  normalizedName: string;
  /** Chave de filtro (minúscula) — usada em query/SQL. */
  sellerIdentityKey: string;
  responsible: string | null;
  /** ID primário quando há exatamente um; null se consolidou vários ou só sem ID. */
  externalSellerId: number | null;
  externalSellerIds: number[];
  hasOrdersWithoutNomusId: boolean;
  ordersCount: number;
  mergedFragmentCount: number;
  sourceSellerKeys: string[];
  /** Mesmo nome normalizado com responsáveis textuais conflitantes — mantém separado. */
  needsReview: boolean;
};

const ID_ONLY_PREFIX = "__ID_ONLY__:";

/** Normaliza nome para comparação: trim, espaços, sem acentos, case-insensitive. */
export function normalizeSellerIdentityName(value: string): string {
  return normalizeSearchString(value).replace(/\s+/g, " ").trim();
}

export function buildRawSellerKeyFromRow(
  externalSellerId: number | null,
  responsible: string | null
): string {
  if (externalSellerId !== null) return `id:${externalSellerId}`;
  const resp = (responsible ?? "").trim();
  if (resp) return `r:${normalizeSellerIdentityName(resp)}`;
  return "unknown";
}

function pickDisplayResponsible(fragments: SellerRowFragment[]): string | null {
  let best: string | null = null;
  for (const f of fragments) {
    const r = cleanExecutiveCommercialName(f.responsible);
    if (!r) continue;
    if (!best || r.length > best.length) best = r;
  }
  return best;
}

/** Melhor nome conhecido por `externalSellerId` (prefere o mais completo). */
export function buildSellerNameByExternalIdMap(
  rows: { external_seller_id: number | null; responsible: string | null }[]
): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    const id = row.external_seller_id;
    const name = cleanExecutiveCommercialName(row.responsible);
    if (id == null || !Number.isFinite(id) || !name) continue;
    const prev = map.get(id);
    if (!prev || name.length > prev.length) map.set(id, name);
  }
  return map;
}

/**
 * Preenche `responsible` vazio (ou "Vendedor ID N") com nome já conhecido para o mesmo ID Nomus.
 * Evita opções "Vendedor ID 464" quando o mesmo ID já aparece com nome em outra linha.
 */
export function applySellerNamesToRows<
  T extends {
    external_seller_id: number | null;
    responsible: string | null;
    orders_count: number;
  },
>(rows: T[], nameById: Map<number, string>): T[] {
  return rows.map((row) => {
    const current = cleanExecutiveCommercialName(row.responsible);
    if (current) {
      return current === (row.responsible ?? "").trim().replace(/\s+/g, " ")
        ? row
        : { ...row, responsible: current };
    }
    // Limpa label técnico mesmo sem mapa, para o enrich/consolidação tratarem como ID-only.
    const cleared =
      row.responsible != null && isSellerIdOnlyLabel(row.responsible)
        ? { ...row, responsible: null as string | null }
        : row;
    if (nameById.size === 0) return cleared;
    if (cleared.external_seller_id == null) return cleared;
    const resolved = cleanExecutiveCommercialName(
      nameById.get(cleared.external_seller_id) ?? null
    );
    if (!resolved) return cleared;
    return { ...cleared, responsible: resolved };
  });
}

/**
 * Mesma ideia do comissionamento (`resolveCommissionSellerIdentity`):
 * resolve nome canônico a partir de CommissionPerson.nomusPersonId e aliases ACTIVE.
 * Não sobrescreve nome já presente no mapa (só troca se o canônico for mais completo).
 */
export function mergeCommissionSellerNamesIntoMap(
  nameById: Map<number, string>,
  persons: Array<{ nomusPersonId: number | null; name: string; active?: boolean }>,
  aliases: Array<{
    rawSellerId: number | null;
    status?: string | null;
    personName?: string | null;
    rawSellerName?: string | null;
    personActive?: boolean;
  }>
): Map<number, string> {
  const map = new Map(nameById);

  const putName = (id: number | null | undefined, rawName: string | null | undefined) => {
    const name = cleanExecutiveCommercialName(rawName);
    if (id == null || !Number.isFinite(id) || id <= 0 || !name) return;
    const prev = map.get(id);
    if (!prev || name.length > prev.length) map.set(id, name);
  };

  for (const person of persons) {
    if (person.active === false) continue;
    putName(person.nomusPersonId, person.name);
  }

  for (const alias of aliases) {
    if (alias.status && alias.status !== "ACTIVE") continue;
    if (alias.personActive === false) continue;
    putName(alias.rawSellerId, alias.personName ?? alias.rawSellerName);
  }

  return map;
}

/**
 * Quando o filtro do CRM aponta uma identidade consolidada, amplia com todos os
 * IDs Nomus do grupo (cobre pedidos com ID sem nome no SalesOrder).
 */
export function expandSellerFilterWithConsolidatedIds<
  T extends {
    sellerIdentityKey: string;
    externalSellerId: number | null;
    externalSellerIds: number[];
  },
>(
  filter: {
    externalSellerId: number | null;
    responsible: string | null;
    sellerIdentityKey: string | null;
    externalSellerIds?: number[] | null;
  },
  options: readonly T[]
): {
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
  externalSellerIds: number[] | null;
} {
  const key = filter.sellerIdentityKey?.trim() || null;
  const seedId = filter.externalSellerId;
  let matched =
    (key
      ? options.find((o) => o.sellerIdentityKey === key)
      : undefined) ??
    (seedId != null
      ? options.find(
          (o) => o.externalSellerId === seedId || o.externalSellerIds.includes(seedId)
        )
      : undefined);

  if (!matched && key?.startsWith(ID_ONLY_PREFIX)) {
    const id = Number.parseInt(key.slice(ID_ONLY_PREFIX.length), 10);
    if (Number.isFinite(id)) {
      matched = options.find(
        (o) => o.externalSellerId === id || o.externalSellerIds.includes(id)
      );
    }
  }

  if (!matched) {
    return {
      ...filter,
      externalSellerIds: filter.externalSellerIds?.length
        ? [...filter.externalSellerIds]
        : null,
    };
  }

  const ids = [
    ...new Set(
      [
        ...(filter.externalSellerIds ?? []),
        ...matched.externalSellerIds,
        matched.externalSellerId,
        seedId,
      ].filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ].sort((a, b) => a - b);

  const nextKey =
    matched.sellerIdentityKey.startsWith(ID_ONLY_PREFIX) && key
      ? key
      : matched.sellerIdentityKey;

  return {
    externalSellerId: matched.externalSellerId ?? seedId,
    responsible: filter.responsible,
    sellerIdentityKey: nextKey,
    externalSellerIds: ids.length > 0 ? ids : null,
  };
}

function groupingKeyForFragment(fragment: SellerRowFragment): string {
  const responsible = cleanExecutiveCommercialName(fragment.responsible);
  if (responsible) {
    return normalizeSellerIdentityName(responsible);
  }
  if (fragment.externalSellerId !== null) {
    return `${ID_ONLY_PREFIX}${fragment.externalSellerId}`;
  }
  return "";
}

function buildConsolidatedFromGroup(
  fragments: SellerRowFragment[],
  groupingKey: string
): ConsolidatedSellerOption | null {
  if (fragments.length === 0 || !groupingKey) return null;

  const responsibles = new Set(
    fragments.map((f) => (f.responsible ?? "").trim()).filter(Boolean)
  );
  const needsReview = responsibles.size > 1;

  const externalSellerIds = [
    ...new Set(
      fragments
        .map((f) => f.externalSellerId)
        .filter((id): id is number => id !== null && Number.isFinite(id))
    ),
  ].sort((a, b) => a - b);

  const hasOrdersWithoutNomusId = fragments.some((f) => f.externalSellerId === null);
  const ordersCount = fragments.reduce((sum, f) => sum + (f.ordersCount ?? 0), 0);
  const sourceSellerKeys = fragments.map((f) => f.sourceSellerKey);

  const isIdOnly = groupingKey.startsWith(ID_ONLY_PREFIX);
  const responsible = pickDisplayResponsible(fragments);
  const displayName = isIdOnly
    ? formatSellerDisplayName(null, externalSellerIds[0] ?? null)
    : responsible
      ? responsible.replace(/\s+/g, " ")
      : formatSellerDisplayName(null, externalSellerIds[0] ?? null);

  if (!displayName) return null;

  const sellerIdentityKey = isIdOnly
    ? groupingKey
    : normalizeSellerIdentityName(displayName);

  return {
    displayName,
    normalizedName: sellerIdentityKey.toUpperCase(),
    sellerIdentityKey,
    responsible: isIdOnly ? null : responsible,
    externalSellerId: externalSellerIds.length === 1 ? externalSellerIds[0]! : null,
    externalSellerIds,
    hasOrdersWithoutNomusId,
    ordersCount,
    mergedFragmentCount: fragments.length,
    sourceSellerKeys,
    needsReview,
  };
}

/**
 * Consolida fragmentos do SQL (um por seller_key) em identidades comerciais únicas.
 * Regra: mesmo sellerIdentityKey exato → uma opção; nomes diferentes → separados.
 * Linhas só com ID herdam o nome de outra linha do mesmo externalSellerId quando existir.
 */
export function consolidateSellerRowFragments(
  rows: { external_seller_id: number | null; responsible: string | null; orders_count: number }[]
): ConsolidatedSellerOption[] {
  const enrichedRows = applySellerNamesToRows(
    rows,
    buildSellerNameByExternalIdMap(rows)
  );
  const fragments: SellerRowFragment[] = enrichedRows.map((row) => ({
    externalSellerId: row.external_seller_id,
    responsible: row.responsible ?? null,
    ordersCount: row.orders_count ?? 0,
    sourceSellerKey: buildRawSellerKeyFromRow(row.external_seller_id, row.responsible),
  }));

  const buckets = new Map<string, SellerRowFragment[]>();
  for (const fragment of fragments) {
    const key = groupingKeyForFragment(fragment);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(fragment);
    buckets.set(key, bucket);
  }

  const consolidated: ConsolidatedSellerOption[] = [];
  for (const [groupingKey, group] of buckets) {
    const option = buildConsolidatedFromGroup(group, groupingKey);
    if (option) consolidated.push(option);
  }

  return consolidated.sort((a, b) => {
    if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
    return a.displayName.localeCompare(b.displayName, "pt-BR", { sensitivity: "base" });
  });
}

export function consolidatedOptionToSellerOption(
  option: ConsolidatedSellerOption
): import("@/src/components/crmSellerDashboardTypes.js").SellerOption {
  return {
    displayName: option.displayName,
    normalizedName: option.normalizedName,
    sellerIdentityKey: option.sellerIdentityKey,
    externalSellerId: option.externalSellerId,
    externalSellerIds: option.externalSellerIds,
    responsible: option.responsible,
    ordersCount: option.ordersCount,
    hasOrdersWithoutNomusId: option.hasOrdersWithoutNomusId,
    mergedFragmentCount: option.mergedFragmentCount,
    sourceSellerKeys: option.sourceSellerKeys,
    needsReview: option.needsReview,
  };
}

/** Vendedor logado pertence à identidade consolidada (ID ou nome normalizado). */
export function consolidatedIdentityMatchesUser(
  option: Pick<
    ConsolidatedSellerOption,
    "sellerIdentityKey" | "externalSellerIds" | "responsible"
  >,
  user: { externalSellerId: number | null; sellerResponsibleName: string | null }
): boolean {
  if (user.externalSellerId != null && option.externalSellerIds.includes(user.externalSellerId)) {
    return true;
  }
  const userName = (user.sellerResponsibleName ?? "").trim();
  if (userName && option.sellerIdentityKey === normalizeSellerIdentityName(userName)) {
    return true;
  }
  return false;
}

export function formatConsolidatedSellerAuditLabel(option: ConsolidatedSellerOption): string {
  const ids =
    option.externalSellerIds.length > 0
      ? `IDs Nomus: ${option.externalSellerIds.join(", ")}`
      : "sem ID Nomus";
  const fragments = `fragmentos: ${option.sourceSellerKeys.join(", ")}`;
  return `${option.displayName} — ${ids}; ${fragments}; pedidos: ${option.ordersCount}`;
}

/** Nome mais frequente no SalesOrder para um ID Nomus (read-only). */
export async function lookupSellerResponsibleNameForExternalId(
  externalSellerId: number
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ responsible: string | null }[]>(Prisma.sql`
    SELECT MODE() WITHIN GROUP (ORDER BY NULLIF(TRIM(so."responsible"), '')) AS responsible
    FROM "SalesOrder" so
    WHERE so."externalSellerId" = ${externalSellerId}
      AND so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND NULLIF(TRIM(so."responsible"), '') IS NOT NULL
  `);
  const name = rows[0]?.responsible?.trim();
  return name || null;
}

/**
 * Enriquece sessão do usuário vendedor: resolve sellerIdentityKey para consolidação CRM.
 * Não altera dados no banco — apenas contexto de autenticação.
 */
export async function enrichAppAuthSellerCommercialLink(
  auth: AppAuthContext
): Promise<AppAuthContext> {
  if (auth.sellerIdentityKey?.trim()) return auth;

  let responsible = auth.sellerResponsibleName?.trim() || null;
  if (!responsible && auth.externalSellerId != null) {
    responsible = await lookupSellerResponsibleNameForExternalId(auth.externalSellerId);
  }
  if (!responsible) return auth;

  return {
    ...auth,
    sellerIdentityKey: normalizeSellerIdentityName(responsible),
  };
}
