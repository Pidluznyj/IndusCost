/**
 * Resolver oficial de recebíveis do Pedido de Venda.
 *
 * Este arquivo é uma **façade de leitura** que codifica o padrão oficial
 * "CR real (Nomus) + Recebíveis planejados (pedido) com dedup automático".
 *
 * Consumidores esperados (read-only):
 *   - Auditoria 360º do Pedido (`orderFullAuditService`)
 *   - Contas a Receber filtrado por pedido (deep-link via `?search=<orderCode>`)
 *   - Fluxo de Caixa quando precisar do saldo consolidado por pedido
 *   - Scripts de QA / inspects
 *
 * Motores oficiais reutilizados (sem duplicar lógica):
 *   - **CR real**: `NomusAccountsReceivable` via `getOrderFullAudit`
 *     (loader oficial da Auditoria 360º) — mesmo motor usado pela aba
 *     Financeiro/Contas a Receber, com dedup por `externalId`.
 *   - **Recebíveis planejados**: `buildSalesOrderPlannedReceivables`
 *     (`src/lib/finance/salesOrderPlannedReceivables.ts`) que reusa
 *     `resolveSalesOrderListPaymentSummary` — o mesmo motor que já
 *     materializa "Pedido PD XXXXX - Parcela N" no grid Comercial e no
 *     Fluxo de Caixa.
 *   - **Baixas/recebimentos**: derivados dos CRs oficiais via
 *     `getOrderFullAudit().receipts`.
 *   - **Divergências financeiras**: filtradas do array oficial
 *     `alerts[]` da Auditoria 360º por `linkedTab === "financial"`.
 *
 * Regras oficiais preservadas:
 *   1. CR real prevalece sobre planejado — dedup por (dueDate ± 3 dias) +
 *      (valor ± R$ 0,01). Ver `buildSalesOrderPlannedReceivables`.
 *   2. Planejado não altera `NomusAccountsReceivable` (append-only).
 *   3. Pedido sem NF pode ter planejado.
 *   4. Empty state só quando não há CR real **e** não há planejado.
 *   5. Cabeçalho NF não infla financeiro — dedup por `receivableExternalId`.
 *
 * O resolver **não** grava nada. Somente lê e compõe.
 */
import { getOrderFullAudit } from "./orderFullAuditService.js";
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
  /** Parcelas planejadas ativas (`replacedByRealCr === false`). */
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  /** Baixas/recebimentos oficiais derivados dos CRs. */
  receipts: OrderFullAuditReceipt[];
  /** Totais oficiais do CR real (`receivablesTotal` do payload). */
  totals: ResolveReceivablesTotals;
  /** Totais dos planejados (inclui `replacedCount`/`replacedAmount`). */
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
 * Retorna a fatia financeira oficial do pedido — CR real + planejado +
 * baixas + divergências — pronta para consumir por qualquer UI executiva.
 *
 * Wrapper sobre `getOrderFullAudit`. Não reimplementa nada:
 * apenas filtra a fatia financeira e formaliza o contrato público.
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

  const realReceivables = includeReal ? audit.receivables : [];
  const activePlanned = includePlanned
    ? audit.plannedReceivables.filter((p) => !p.replacedByRealCr)
    : [];
  const receipts = includeReal ? audit.receipts : [];
  const financialDivergences = audit.alerts.filter(
    (alert) => alert.linkedTab === "financial"
  );

  return {
    ok: true,
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? input.orderCode ?? null,
    realReceivables,
    plannedReceivables: activePlanned,
    receipts,
    totals: audit.receivablesTotal,
    plannedTotals: audit.plannedReceivablesTotal,
    divergences: financialDivergences,
    sources: {
      realCr: "NomusAccountsReceivable (via getOrderFullAudit)",
      plannedForecast:
        "buildSalesOrderPlannedReceivables → resolveSalesOrderListPaymentSummary",
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
