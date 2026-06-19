import { Prisma } from "@prisma/client";

/**
 * Array JSON de NFes em nomusRawResponse — alinhado ao CRM (`crmCustomersList`) com
 * fallbacks para formatos Nomus legados (array no topo, NFe única como objeto).
 * Sempre retorna um jsonb array para jsonb_array_elements (evita 500 no PostgreSQL).
 */
export function nomusNfesJsonbArraySql(alias: string) {
  const raw = Prisma.raw(`${alias}."nomusRawResponse"`);
  return Prisma.sql`
    CASE
      WHEN ${raw} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${raw}) = 'array'
        AND jsonb_typeof(${raw} -> 'nfes') = 'array'
      THEN ${raw} -> 'nfes'
      WHEN jsonb_typeof(${raw}) = 'array'
      THEN ${raw}
      WHEN jsonb_typeof(${raw} -> 'nfes') = 'array'
      THEN ${raw} -> 'nfes'
      WHEN jsonb_typeof(${raw} -> 'nfes') = 'object'
      THEN jsonb_build_array(${raw} -> 'nfes')
      ELSE '[]'::jsonb
    END
  `;
}

/** Elementos NFe em nomusRawResponse — mesma regra do CRM/relatórios comerciais. */
export function nomusNfesElementsSql(alias: string) {
  return Prisma.sql`
    jsonb_array_elements(${nomusNfesJsonbArraySql(alias)}) AS nfe
  `;
}

/** Converte dataProcessamento DD/MM/YYYY para date (NULL se inválido). */
export function nfeProcessamentoDateSql() {
  return Prisma.sql`
    CASE
      WHEN NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      THEN to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY')
      ELSE NULL
    END
  `;
}

/** Pedido possui ao menos uma NFe com dataProcessamento preenchida. */
export function orderIsInvoicedSql(alias: string) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM ${nomusNfesElementsSql(alias)}
      WHERE NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') IS NOT NULL
    )
  `;
}

export function orderNotInvoicedSql(alias: string) {
  return Prisma.sql`NOT (${orderIsInvoicedSql(alias)})`;
}

/** Data da NF mais recente com dataProcessamento válido. */
export function orderLatestInvoiceDateSql(alias: string) {
  return Prisma.sql`
    (
      SELECT MAX((${nfeProcessamentoDateSql()}))
      FROM ${nomusNfesElementsSql(alias)}
      WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
    )
  `;
}

/** Pedido faturado com dataProcessamento dentro do intervalo [from, to] (inclusive). */
export function orderInvoicedInPeriodSql(alias: string, fromYmd: string, toYmd: string) {
  const dateExpr = nfeProcessamentoDateSql();
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM ${nomusNfesElementsSql(alias)}
      WHERE (${dateExpr}) IS NOT NULL
        AND (${dateExpr}) >= ${fromYmd}::date
        AND (${dateExpr}) <= ${toYmd}::date
    )
  `;
}

export function toPgDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
