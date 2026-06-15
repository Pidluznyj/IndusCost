/**
 * Fragmentos SQL reutilizáveis — carteira aberta e faturamento em SalesOrder.
 */

import { Prisma } from "@prisma/client";

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
 * Follow-up por cliente (Fase 2): atividade após updatedAt/issueDate do pedido.
 * Limitação: sem CommercialActivity.salesOrderId ainda.
 */
export function crmOrderWithoutFollowUpNotExistsSql(alias: string) {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM "CommercialActivity" a
      WHERE a."customerId" = ${Prisma.raw(`${alias}."customerId"`)}
        AND COALESCE(a."contactDate", a."createdAt") >= COALESCE(
          ${Prisma.raw(`${alias}."updatedAt"`)},
          ${Prisma.raw(`${alias}."issueDate"`)}
        )
    )
  `;
}

export const CRM_ACTIVITY_NOT_CLOSED_SQL = Prisma.sql`(
  a."status" IS NULL
  OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
)`;
