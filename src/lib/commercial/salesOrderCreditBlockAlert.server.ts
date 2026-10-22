/**
 * Aviso da grade de pedidos. Lê a mesma decisão da carteira e não grava crédito.
 */
import { attachCustomerCnpjRisk } from "../customerCnpjRiskSummary.server.js";
import type { CustomerCnpjRiskDb } from "../customerCnpjRiskSummary.server.js";
import {
  blockedCustomerDocumentAlert,
  type BlockedCustomerDocumentAlert,
} from "./blockedCustomerDocumentAlert.js";
import type { CustomerDelinquencyDb } from "./customerDelinquencyAnalysis.server.js";
import { loadPortfolioCredit } from "./portfolioCredit.server.js";

type AlertDb = CustomerDelinquencyDb & CustomerCnpjRiskDb;

export async function loadSalesOrderCreditBlockAlerts(
  db: AlertDb,
  rows: readonly {
    customerId: string | null;
    status: string;
    proposalId: string | null;
    paymentTerms?: string | null;
  }[],
  now: Date = new Date()
): Promise<Array<BlockedCustomerDocumentAlert | null>> {
  const ids = [...new Set(rows.map((row) => row.customerId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return rows.map(() => null);

  const customers = await db.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, taxId: true, nomusExternalPersonId: true },
  });
  const withRisk = await attachCustomerCnpjRisk(db, customers, now);
  const credit = await loadPortfolioCredit(db, withRisk, now);

  return rows.map((row) => {
    const decision = row.customerId ? credit.get(row.customerId)?.decision : undefined;
    const terms = row.paymentTerms?.trim() ? row.paymentTerms : null;
    return blockedCustomerDocumentAlert({
      customerStatus: decision?.customerStatus,
      decisionTitle: decision?.decisionTitle,
      reasonLabel: decision?.reasonLabel,
      kind: "sales_order",
      documentStatus: row.status,
      paymentTerms: terms,
      paymentTermsKnown: terms != null,
      hasProposal: Boolean(row.proposalId),
    });
  });
}
