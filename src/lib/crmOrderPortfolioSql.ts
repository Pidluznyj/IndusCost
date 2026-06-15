/**
 * Fragmentos SQL reutilizáveis — carteira aberta e faturamento em SalesOrder.
 */

import { Prisma } from "@prisma/client";
import { crmOrderHasFollowUpExistsSql } from "@/src/lib/crmOrderFollowUp";

export const CRM_VALID_PURCHASE_STATUS_SQL = Prisma.sql`so.status::text IN ('READY_TO_SEND', 'SENT_TO_NOMUS')`;

export function crmNomusNfesElementsSql(alias: string) {
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

export function crmOrderIsInvoicedSql(alias: string) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM ${crmNomusNfesElementsSql(alias)}
      WHERE NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') IS NOT NULL
    )
  `;
}

/** Pedido válido para métricas: exclui CANCELLED e ERROR. */
export function crmValidMetricsOrderSql(alias: string) {
  return Prisma.sql`${Prisma.raw(`${alias}.status::text`)} NOT IN ('CANCELLED', 'ERROR')`;
}

/** Carteira aberta: pedido válido sem NF processada. */
export function crmOpenPortfolioOrderSql(alias: string) {
  return Prisma.sql`
    ${crmValidMetricsOrderSql(alias)}
    AND NOT ${crmOrderIsInvoicedSql(alias)}
  `;
}

/**
 * Pedido em carteira sem follow-up: sem atividade vinculada ao pedido nem fallback do cliente.
 */
export function crmOrderWithoutFollowUpNotExistsSql(alias: string) {
  return Prisma.sql`NOT ${crmOrderHasFollowUpExistsSql(alias)}`;
}

export const CRM_ACTIVITY_NOT_CLOSED_SQL = Prisma.sql`(
  a."status" IS NULL
  OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
)`;
