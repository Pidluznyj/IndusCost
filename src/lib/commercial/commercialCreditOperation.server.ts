/**
 * Histórico e filtro de crédito.
 * A consulta não grava pedido, não copia título e não dispara notificação.
 */

import { commercialCreditReasonMessage } from "./commercialCreditDecision.js";
import { readCommercialCreditDecision, type CommercialCreditDb } from "./commercialCreditDecision.server.js";
import {
  COMMERCIAL_CREDIT_PORTFOLIO_LIMIT,
  commercialCreditEvaluationDraft,
  matchesCommercialCreditPortfolioFilter,
  presentCommercialCreditEvaluation,
  type CommercialCreditEvaluationDraft,
  type CommercialCreditPortfolioFilter,
} from "./commercialCreditOperation.js";

type EvaluationRow = CommercialCreditEvaluationDraft & { id?: string };

export type CommercialCreditEvaluationStore = {
  commercialCreditEvaluation?: {
    create(args: { data: CommercialCreditEvaluationDraft }): Promise<unknown>;
    findMany(args: {
      where: { customerId: string };
      orderBy?: { evaluatedAt: "desc" };
      take?: number;
    }): Promise<EvaluationRow[]>;
  };
};

export async function recordCommercialCreditEvaluation(
  db: CommercialCreditEvaluationStore,
  draft: CommercialCreditEvaluationDraft
): Promise<{ recorded: boolean }> {
  if (!db.commercialCreditEvaluation) return { recorded: false };
  await db.commercialCreditEvaluation.create({ data: draft });
  return { recorded: true };
}

export async function listCommercialCreditEvaluations(
  db: CommercialCreditEvaluationStore,
  customerId: string
): Promise<string[]> {
  const rows = await db.commercialCreditEvaluation?.findMany({
    where: { customerId },
    orderBy: { evaluatedAt: "desc" },
    take: 20,
  });
  return (rows ?? []).map((row) => presentCommercialCreditEvaluation(row));
}

export async function filterCustomersByCommercialCredit(
  db: CommercialCreditDb,
  input: { customerIds: readonly string[]; filter: CommercialCreditPortfolioFilter; now?: Date }
): Promise<{
  matches: Array<{ customerId: string; situationLabel: string; reason: string }>;
  evaluated: number;
  omitted: number;
  failed: number;
  writes: "NONE";
}> {
  const unique = [...new Set(input.customerIds.filter(Boolean))];
  const slice = unique.slice(0, COMMERCIAL_CREDIT_PORTFOLIO_LIMIT);
  const matches: Array<{ customerId: string; situationLabel: string; reason: string }> = [];
  let failed = 0;
  for (const customerId of slice) {
    try {
      const read = await readCommercialCreditDecision(db, {
        customerId,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        now: input.now,
      });
      const matched = matchesCommercialCreditPortfolioFilter({
        filter: input.filter,
        customerStatus: read.decision.customerStatus,
        confirmedPendingProtest: read.confirmedPendingProtest,
        externalProtestConfirmed: read.externalProtest === "CONFIRMED_CURRENT",
      });
      if (matched) {
        matches.push({
          customerId,
          situationLabel: read.decision.customerStatus,
          reason: commercialCreditReasonMessage(read.decision.reason),
        });
      }
    } catch {
      failed += 1;
    }
  }
  return {
    matches,
    evaluated: slice.length - failed,
    omitted: unique.length - slice.length,
    failed,
    writes: "NONE",
  };
}

export { commercialCreditEvaluationDraft };
