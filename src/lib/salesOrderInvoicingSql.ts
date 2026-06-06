import { Prisma } from "@prisma/client";

/** Elementos NFe em nomusRawResponse — mesma regra do CRM/relatórios comerciais. */
export function nomusNfesElementsSql(alias: string) {
  return Prisma.sql`
    jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes') = 'array'
        THEN ${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes'
        ELSE '[]'::jsonb
      END
    ) AS nfe
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
