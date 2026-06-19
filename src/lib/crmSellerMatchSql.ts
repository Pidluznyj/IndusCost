/**
 * Filtros SQL de vendedor/responsável — paridade entre dashboard e carteira CRM.
 */
import { Prisma } from "@prisma/client";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";

export function buildSellerResponsibleNormalizedSql(alias: string): Prisma.Sql {
  const col = Prisma.raw(`${alias}."responsible"`);
  return Prisma.sql`
    LOWER(
      translate(
        REGEXP_REPLACE(TRIM(COALESCE(${col}, '')), '\\s+', ' ', 'g'),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )
    )
  `;
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
