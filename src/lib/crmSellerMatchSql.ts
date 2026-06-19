/**
 * Filtros SQL de vendedor/responsável — paridade entre dashboard e carteira CRM.
 */
import { Prisma } from "@prisma/client";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";

export function buildSellerResponsibleNormalizedSql(alias: string): Prisma.Sql {
  return Prisma.sql`LOWER(REGEXP_REPLACE(TRIM(COALESCE(${Prisma.raw(`${alias}."responsible"`)}, '')), '\\s+', ' ', 'g'))`;
}

/** Filtra pedidos pelo nome normalizado exato do responsável (consolida todos os IDs com mesmo nome). */
export function buildSellerMatchByIdentityKeySql(
  alias: string,
  sellerIdentityKey: string
): Prisma.Sql {
  const key = normalizeSellerIdentityName(sellerIdentityKey);
  return Prisma.sql`${buildSellerResponsibleNormalizedSql(alias)} = ${key}`;
}

export function buildCrmSellerFilterSql(
  alias: string,
  filter: {
    externalSellerId: number | null;
    responsible: string | null;
    sellerIdentityKey: string | null;
  }
): Prisma.Sql {
  if (filter.sellerIdentityKey?.trim()) {
    return buildSellerMatchByIdentityKeySql(alias, filter.sellerIdentityKey);
  }
  if (filter.externalSellerId !== null && filter.responsible !== null) {
    return Prisma.sql`(
      ${Prisma.raw(`${alias}."externalSellerId"`)} = ${filter.externalSellerId}
      OR (
        ${Prisma.raw(`${alias}."externalSellerId"`)} IS NULL
        AND ${Prisma.raw(`${alias}."responsible"`)} IS NOT NULL
        AND LOWER(TRIM(${Prisma.raw(`${alias}."responsible"`)})) = LOWER(TRIM(${filter.responsible}))
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
