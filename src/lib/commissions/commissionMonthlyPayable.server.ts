import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  aggregateMonthlyPayableFromRows,
  type CommissionMonthlyPayableQuery,
  type CommissionMonthlyPayableSummary,
} from "./commissionMonthlyPayable.js";
import { listPayableVisualAuditRows } from "./commissionVisualAudit.server.js";

export type { CommissionMonthlyPayableQuery, CommissionMonthlyPayableSummary };
export {
  aggregateMonthlyPayableFromRows,
  buildMonthlyPayableCsv,
  buildMonthKey,
  formatMonthLabelPt,
  mapRowToPayableDetail,
} from "./commissionMonthlyPayable.js";

/**
 * Resumo mensal oficial: comissão a pagar = liberada em títulos baixados no mês (settlementDate).
 * Reutiliza linhas PAYABLE da auditoria visual — não recalcula comissão nem altera pagamentos.
 */
export async function getCommissionMonthlyPayableSummary(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope
): Promise<CommissionMonthlyPayableSummary> {
  const rows = await listPayableVisualAuditRows(
    {
      year: query.year,
      month: query.month,
      commissionPersonId: query.sellerId ?? null,
    },
    scope
  );
  return aggregateMonthlyPayableFromRows(rows, query);
}
