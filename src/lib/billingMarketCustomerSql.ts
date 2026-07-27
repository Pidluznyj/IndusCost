import { Prisma } from "@prisma/client";
import { ECONOMIC_GROUP_CNPJ_DIGITS } from "@/src/lib/financeInternalGroupExclusions.js";

/**
 * Filtro SQL: cliente de mercado (exclui Lazarios, Koppetel, SM).
 * Fonte canônica: `ECONOMIC_GROUP_CNPJ_DIGITS` / `isGroupCompanyCustomer`.
 */
export function billingMarketCustomerFilterSql(customerAlias = "c") {
  const taxId = Prisma.raw(`${customerAlias}."taxId"`);
  const company = Prisma.raw(`${customerAlias}."companyName"`);
  const trade = Prisma.raw(`${customerAlias}."tradeName"`);
  const cnpjList = Prisma.join(ECONOMIC_GROUP_CNPJ_DIGITS.map((d) => Prisma.sql`${d}`));

  return Prisma.sql`
    NOT (
      regexp_replace(COALESCE(${taxId}, ''), '[^0-9]', '', 'g') IN (${cnpjList})
      OR lower(COALESCE(${company}, '')) LIKE '%koppetel%'
      OR lower(COALESCE(${trade}, '')) LIKE '%koppetel%'
      OR lower(COALESCE(${company}, '')) LIKE '%lazarios%'
      OR lower(COALESCE(${trade}, '')) LIKE '%lazarios%'
      OR lower(COALESCE(${company}, '')) LIKE '%sm comercio de plastic%'
      OR lower(COALESCE(${trade}, '')) LIKE '%sm comercio de plastic%'
      OR lower(COALESCE(${company}, '')) LIKE '%sm com%plastic%'
      OR lower(COALESCE(${trade}, '')) LIKE '%sm com%plastic%'
      OR lower(trim(COALESCE(${company}, ''))) = 'sm'
      OR lower(trim(COALESCE(${trade}, ''))) = 'sm'
    )
  `;
}
