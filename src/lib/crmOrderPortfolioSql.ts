/**
 * Fragmentos SQL do CRM — SOMENTE relacionamento (CommercialActivity).
 *
 * Regra de pedido NÃO mora aqui. O que é pedido válido, carteira aberta,
 * faturado, intercompany e período é decidido por UMA implementação — a da
 * tela Pedidos de Venda — e o cockpit a consome via
 * `crmCanonicalSalesOrderScope.server` + `crmManagementOrderFacts.server`.
 *
 * Este arquivo já teve fragmentos que reescreviam essas regras em SQL. Eles
 * divergiam do oficial em quatro pontos (ERROR contado a menos, borda de
 * período fechada em vez de meio-aberta, prefixo de nome do grupo que
 * excluía clientes legítimos e exigência de `presentInLastPayload`) e foram
 * removidos. Não reintroduzir: se faltar recorte, o lugar de mudar é o
 * módulo canônico de Pedidos de Venda.
 */

import { Prisma } from "@prisma/client";

import { crmOrderHasFollowUpExistsSql } from "@/src/lib/crmOrderFollowUp";

export { crmOrderHasFollowUpExistsSql };

/** Pedido em carteira sem follow-up — regra de relacionamento do CRM. */
export function crmOrderWithoutFollowUpNotExistsSql(alias: string) {
  return Prisma.sql`NOT ${crmOrderHasFollowUpExistsSql(alias)}`;
}

/** Atividade comercial ainda em aberto (não concluída/cancelada). */
export const CRM_ACTIVITY_NOT_CLOSED_SQL = Prisma.sql`(
  a."status" IS NULL
  OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
)`;
