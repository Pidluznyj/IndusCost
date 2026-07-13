/**
 * Filtros SQL de vendedor no pedido vs. escopo de carteira CRM.
 *
 * Pedido (comissionável / Nomus): COALESCE(nomusSellerName, responsible) + externalSellerId.
 * Carteira CRM: responsável comercial do cliente (CrmCustomerCommercialOwner) ∪ pedidos do vendedor.
 * Os dois eixos NÃO se misturam na comissão — só no CRM a carteira agrega pedidos do cliente.
 */
import { Prisma } from "@prisma/client";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";

export type CrmSellerMatchFilter = {
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
};

/** Nome de vendedor do pedido: oficial Nomus, com fallback legado. */
export function buildCrmOrderSellerNameSql(alias: string): Prisma.Sql {
  const nomus = Prisma.raw(`${alias}."nomusSellerName"`);
  const legacy = Prisma.raw(`${alias}."responsible"`);
  return Prisma.sql`COALESCE(NULLIF(TRIM(${nomus}), ''), NULLIF(TRIM(${legacy}), ''))`;
}

export function buildSellerResponsibleNormalizedSql(alias: string): Prisma.Sql {
  const nameExpr = buildCrmOrderSellerNameSql(alias);
  return Prisma.sql`
    LOWER(
      translate(
        REGEXP_REPLACE(TRIM(COALESCE(${nameExpr}, '')), '\\s+', ' ', 'g'),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )
    )
  `;
}

/** Filtra pedidos pelo nome normalizado do vendedor do pedido (Nomus/legado). */
export function buildSellerMatchByIdentityKeySql(
  alias: string,
  sellerIdentityKey: string
): Prisma.Sql {
  const key = normalizeSellerIdentityName(sellerIdentityKey);
  return Prisma.sql`${buildSellerResponsibleNormalizedSql(alias)} = ${key}`;
}

export function hasCrmSellerMatchFilter(filter: CrmSellerMatchFilter): boolean {
  return Boolean(
    filter.sellerIdentityKey?.trim() ||
      filter.externalSellerId != null ||
      filter.responsible?.trim()
  );
}

/**
 * Match no vendedor do pedido (Nomus) — NÃO é o responsável comercial do cliente.
 * Preferência: sellerIdentityKey → externalSellerId → responsible legado.
 */
export function buildCrmSellerFilterSql(
  alias: string,
  filter: CrmSellerMatchFilter
): Prisma.Sql {
  const key = filter.sellerIdentityKey?.trim();
  if (key) {
    if (key.startsWith("__ID_ONLY__:")) {
      const idRaw = key.slice("__ID_ONLY__:".length);
      const id = Number.parseInt(idRaw, 10);
      if (Number.isFinite(id)) {
        return Prisma.sql`${Prisma.raw(`${alias}."externalSellerId"`)} = ${id}`;
      }
    }
    return buildSellerMatchByIdentityKeySql(alias, key);
  }
  if (filter.externalSellerId !== null && filter.responsible !== null) {
    return Prisma.sql`(
      ${Prisma.raw(`${alias}."externalSellerId"`)} = ${filter.externalSellerId}
      OR (
        ${Prisma.raw(`${alias}."externalSellerId"`)} IS NULL
        AND ${buildSellerMatchByIdentityKeySql(alias, filter.responsible)}
      )
    )`;
  }
  if (filter.externalSellerId !== null) {
    return Prisma.sql`${Prisma.raw(`${alias}."externalSellerId"`)} = ${filter.externalSellerId}`;
  }
  if (filter.responsible !== null) {
    return buildSellerMatchByIdentityKeySql(alias, filter.responsible);
  }
  return Prisma.sql`TRUE`;
}

export function buildCustomerIdsInSql(alias: string, customerIds: readonly string[]): Prisma.Sql {
  if (customerIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(`${alias}."customerId"`)} IN (${Prisma.join(
    customerIds.map((id) => Prisma.sql`${id}::uuid`)
  )})`;
}

/**
 * Escopo de pedidos do CRM por vendedor/carteira:
 * - pedidos cujo vendedor Nomus casa com o filtro, OU
 * - qualquer pedido de cliente com responsável comercial manual atribuído a esse vendedor.
 *
 * Assim a carteira CRM não zera quando o pedido tem outro vendedor comissionável.
 */
export function buildCrmSellerPortfolioOrderScopeSql(
  alias: string,
  filter: CrmSellerMatchFilter,
  manualOwnerCustomerIds: readonly string[]
): Prisma.Sql {
  if (!hasCrmSellerMatchFilter(filter)) {
    return Prisma.sql`TRUE`;
  }
  const sellerMatch = buildCrmSellerFilterSql(alias, filter);
  if (manualOwnerCustomerIds.length === 0) {
    return sellerMatch;
  }
  const ownedCustomers = buildCustomerIdsInSql(alias, manualOwnerCustomerIds);
  return Prisma.sql`(${ownedCustomers} OR ${sellerMatch})`;
}
