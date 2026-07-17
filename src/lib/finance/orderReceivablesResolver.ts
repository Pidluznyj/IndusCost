/**
 * Resolver oficial de recebíveis do Pedido de Venda.
 *
 * Façade de leitura: CR real (Nomus) + previsão residual efetiva (FIN-05).
 *
 * Consumidores (read-only):
 *   - Contas a Receber filtrado por pedido / cliente (FIN-08)
 *   - Auditoria 360º / scripts de QA
 *
 * Regras:
 *   1. CR real deduplicado só por `externalId` (nunca só valor+vencimento).
 *   2. Previsão integral substituída não permanece ativa.
 *   3. Corte comercial não entra como recebível.
 *   4. Documento coberto por CR da mesma NF não vira segundo título.
 *
 * O resolver **não** grava nada.
 */
import { getOrderFullAudit } from "./orderFullAuditService.js";
import { buildSalesOrderDetailFinancialFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import type {
  OrderFullAuditAlert,
  OrderFullAuditPayload,
  OrderFullAuditPlannedReceivable,
  OrderFullAuditPlannedReceivablesTotal,
  OrderFullAuditReceipt,
  OrderFullAuditReceivable,
} from "./orderFullAuditClient.js";

// Helper puro frontend-safe — reexport para consumidores server-side.
export {
  computeConsolidatedFinancialSummary,
} from "@/src/lib/sales/orderFinancialConsolidation.js";
export type { ConsolidatedFinancialSummary } from "@/src/lib/sales/orderFinancialConsolidation.js";

export type ResolveReceivablesInput = {
  /** ID interno do SalesOrder (uuid). Obrigatório. */
  salesOrderId: string;
  /** Código operacional (`orderCode`) do pedido — usado apenas para logs/alertas. */
  orderCode?: string | null;
  /** Se `false`, omite `plannedReceivables` do retorno. Default: `true`. */
  includePlanned?: boolean;
  /** Se `false`, omite `realReceivables` do retorno. Default: `true`. */
  includeReal?: boolean;
  /**
   * Contexto do usuário (opcional). A autorização real vem da rota que chama
   * este resolver; mantido só para permitir extensões futuras (auditoria de
   * acesso, filtragem por carteira comercial etc.).
   */
  userContext?: { userId?: string | null; permissions?: readonly string[] } | null;
};

export type ResolveReceivablesTotals = OrderFullAuditPayload["receivablesTotal"];

export type OrderReceivablesResolverPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string | null;
  /** CR real do Nomus, deduplicado por `externalId`. */
  realReceivables: OrderFullAuditReceivable[];
  /** Previsão residual ativa (FIN-05) — sem previsão integral substituída. */
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  /** Baixas/recebimentos oficiais derivados dos CRs. */
  receipts: OrderFullAuditReceipt[];
  /** Totais oficiais do CR real (`receivablesTotal` do payload). */
  totals: ResolveReceivablesTotals;
  /** Totais do residual efetivo (FIN-05 / FIN-06). */
  plannedTotals: OrderFullAuditPlannedReceivablesTotal;
  /** Divergências oficiais da aba Financeiro (`linkedTab === "financial"`). */
  divergences: OrderFullAuditAlert[];
  /** Rótulo canônico da origem — auditável na aba Técnica. */
  sources: {
    realCr: string;
    plannedForecast: string;
    receipts: string;
  };
};

export type OrderReceivablesResolverError = {
  ok: false;
  status: number;
  error: string;
};

/**
 * Retorna CR real + previsão residual efetiva (FIN-05) + baixas + divergências.
 */
export async function resolveReceivablesForSalesOrder(
  input: ResolveReceivablesInput
): Promise<OrderReceivablesResolverPayload | OrderReceivablesResolverError> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    return { ok: false, status: 400, error: "salesOrderId é obrigatório." };
  }

  const audit = await getOrderFullAudit({
    salesOrderId,
    orderCode: input.orderCode ?? null,
    userContext: input.userContext ?? null,
  });

  if (!("ok" in audit) || audit.ok !== true) {
    return audit as OrderReceivablesResolverError;
  }

  const includeReal = input.includeReal !== false;
  const includePlanned = input.includePlanned !== false;

  const effective = buildSalesOrderDetailFinancialFromAudit(audit);
  const realReceivables = includeReal ? effective.realReceivables : [];
  const activePlanned = includePlanned ? effective.plannedReceivables : [];
  const receipts = includeReal ? effective.receipts : [];
  const financialDivergences = audit.alerts.filter(
    (alert) => alert.linkedTab === "financial"
  );

  const plannedTotals: OrderFullAuditPlannedReceivablesTotal = {
    ...audit.plannedReceivablesTotal,
    totalCount: effective.plannedTotals.totalCount,
    totalExpected: effective.plannedTotals.totalExpected,
    applicableExpected: effective.plannedTotals.applicableExpected,
    openExpected: effective.plannedTotals.openExpected,
    overdueExpected: effective.plannedTotals.overdueExpected,
    overdueCount: effective.plannedTotals.overdueCount,
    nextDueDate: effective.plannedTotals.nextDueDate,
    replacedCount: effective.plannedTotals.replacedCount,
    replacedAmount: effective.plannedTotals.replacedAmount,
    coveredByRealReceivables: effective.plannedTotals.coveredByRealReceivables,
    coveredByDocumentsWithoutRealReceivable:
      effective.plannedTotals.coveredByDocumentsWithoutRealReceivable,
    remainingPlannedValue: effective.plannedTotals.remainingPlannedValue,
    fullySuperseded: effective.plannedTotals.fullySuperseded,
    partiallySuperseded: effective.plannedTotals.partiallySuperseded,
    precedenceSource: effective.plannedTotals.precedenceSource,
  };

  return {
    ok: true,
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? input.orderCode ?? null,
    realReceivables,
    plannedReceivables: activePlanned,
    receipts,
    totals: effective.totals,
    plannedTotals,
    divergences: financialDivergences,
    sources: {
      realCr: "NomusAccountsReceivable (via getOrderFullAudit)",
      plannedForecast:
        "buildSalesOrderEffectiveFinancialSchedule (FIN-05) → residual ativo",
      receipts: "NomusAccountsReceivable.settlementDate/amountReceived",
    },
  };
}

/**
 * Helper puro (sem I/O) — indica se o pedido está no estado "sem CR real,
 * mas com planejado disponível" (o cenário do PD 02740 antes da NF).
 */
export function isOrderInPlannedOnlyState(payload: {
  realReceivables: readonly OrderFullAuditReceivable[];
  plannedReceivables: readonly OrderFullAuditPlannedReceivable[];
}): boolean {
  const anyReal = payload.realReceivables.length > 0;
  const anyActivePlanned = payload.plannedReceivables.some((p) => !p.replacedByRealCr);
  return !anyReal && anyActivePlanned;
}
